const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { createApp } = require('../dist/app.js')
const { generateToken } = require('../dist/middleware/auth.js')
const { AdRenderJob } = require('../dist/database/models/AdRenderJob.js')
const {
  cancelAdRender,
  startAdRenderQueue,
  stopAdRenderQueue,
} = require('../dist/services/AdRenderQueue.js')

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

test('ad library stores media, renders a beat-synced variation and serves ranges', async () => {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(databaseHost),
    'Integration test requires local Postgres',
  )
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'Integration test requires FFmpeg')

  await sequelize.authenticate()
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'ad-library-test-'))
  const clip1 = path.join(fixtureDir, 'clip-one.mp4')
  const clip2 = path.join(fixtureDir, 'clip-two.mp4')
  const music = path.join(fixtureDir, 'music.m4a')
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0xE85D3F:s=360x640:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    'drawbox=x=40:y=200:w=280:h=240:color=white:t=fill',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-pix_fmt',
    'yuv420p',
    '-shortest',
    clip1,
  ])
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x3478F6:s=360x640:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:duration=2',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    'drawbox=x=80:y=240:w=200:h=160:color=yellow:t=fill',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-pix_fmt',
    'yuv420p',
    '-shortest',
    clip2,
  ])
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(lt(mod(t\\,0.75)\\,0.1)\\,0.9*sin(2*PI*880*t)\\,0):s=48000:d=3',
    '-c:a',
    'aac',
    music,
  ])

  const user = await User.create({
    name: 'Ad library test',
    email: `ad-library-${randomUUID()}@example.invalid`,
    passwordHash: 'not-used-by-this-test',
    role: USER_ROLE_ENUM.MEMBER,
  })
  const otherUser = await User.create({
    name: 'Ad library isolation test',
    email: `ad-library-other-${randomUUID()}@example.invalid`,
    passwordHash: 'not-used-by-this-test',
    role: USER_ROLE_ENUM.MEMBER,
  })
  const token = generateToken(user)
  let server
  let projectId
  try {
    server = createApp().listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/v1/ad-projects`
    const jsonRequest = async (url, init = {}) => {
      const response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      })
      return { response, body: await response.json() }
    }
    const config = {
      variationCount: 1,
      texts: ['OFERTA DO DIA 🔥', 'APROVEITE 50% %{localtime}'],
      selectedClipIds: [],
      musicAssetId: null,
      timing: { mode: 'beat' },
      output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
      colorPreset: 'vibrant',
      textStyle: {
        fontSize: 42,
        positionY: 52,
        fontColor: '#FFFFFF',
        borderColor: '#000000',
        borderWidth: 4,
      },
    }
    const created = await jsonRequest(base, {
      method: 'POST',
      body: JSON.stringify({ name: 'Teste de criativos', config }),
    })
    assert.equal(created.response.status, 201)
    projectId = created.body.data.id

    const upload = async (kind, files) => {
      const body = new FormData()
      body.append('kind', kind)
      for (const [filePath, mime] of files)
        body.append(
          'files',
          new Blob([await readFile(filePath)], { type: mime }),
          path.basename(filePath),
        )
      const response = await fetch(`${base}/${projectId}/assets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body,
      })
      return { response, body: await response.json() }
    }
    const clips = await upload('clip', [
      [clip1, 'video/mp4'],
      [clip2, 'video/mp4'],
    ])
    assert.equal(clips.response.status, 201)
    assert.equal(clips.body.data.length, 2)
    const uploadedMusic = await upload('music', [[music, 'audio/x-m4a']])
    assert.equal(uploadedMusic.response.status, 201)

    const noSelection = await jsonRequest(`${base}/${projectId}/render-jobs`, {
      method: 'POST',
      body: '{}',
    })
    assert.equal(noSelection.response.status, 422)
    const isolatedAsset = await fetch(
      `http://127.0.0.1:${server.address().port}${clips.body.data[0].contentUrl}`,
      { headers: { authorization: `Bearer ${generateToken(otherUser)}` } },
    )
    assert.equal(isolatedAsset.status, 404)

    config.selectedClipIds = clips.body.data.map((item) => item.id)
    config.musicAssetId = uploadedMusic.body.data[0].id
    const updated = await jsonRequest(`${base}/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ config }),
    })
    assert.equal(updated.response.status, 200)

    const started = await jsonRequest(`${base}/${projectId}/render-jobs`, {
      method: 'POST',
      body: '{}',
    })
    assert.equal(started.response.status, 202)
    const jobId = started.body.data.id
    let claimed
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      claimed = await AdRenderJob.findByPk(jobId)
      if (claimed.status === 'running') break
    }
    assert.equal(claimed.status, 'running')
    await stopAdRenderQueue()
    await claimed.reload()
    assert.equal(claimed.status, 'queued', 'shutdown must requeue only after the renderer unwinds')
    await startAdRenderQueue()

    let job
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      job = (await jsonRequest(`${base}/${projectId}/render-jobs/${jobId}`)).body.data
      if (['completed', 'failed'].includes(job.status)) break
    }
    assert.equal(job.status, 'completed', job.error)
    assert.equal(job.outputs.length, 1)
    assert.ok(job.outputs[0].cutTimes.length >= 2)
    assert.ok(
      job.outputs[0].cutTimes.some((cut) => cut > 0 && Math.abs(cut - 2.5) > 0.1),
      'beat mode should use a detected pulse',
    )

    const outputResponse = await fetch(
      `http://127.0.0.1:${server.address().port}${job.outputs[0].downloadUrl}`,
      {
        headers: { authorization: `Bearer ${token}`, range: 'bytes=0-99' },
      },
    )
    assert.equal(outputResponse.status, 206)
    assert.equal((await outputResponse.arrayBuffer()).byteLength, 100)
    assert.match(outputResponse.headers.get('content-range'), /^bytes 0-99\/\d+$/)

    const suffixResponse = await fetch(
      `http://127.0.0.1:${server.address().port}${job.outputs[0].downloadUrl}`,
      {
        headers: { authorization: `Bearer ${token}`, range: 'bytes=-50' },
      },
    )
    assert.equal(suffixResponse.status, 206)
    assert.equal((await suffixResponse.arrayBuffer()).byteLength, 50)

    const invalidRange = await fetch(
      `http://127.0.0.1:${server.address().port}${job.outputs[0].downloadUrl}`,
      {
        headers: { authorization: `Bearer ${token}`, range: 'bytes=999999999-' },
      },
    )
    assert.equal(invalidRange.status, 416)
    assert.match(invalidRange.headers.get('content-range'), /^bytes \*\/\d+$/)

    const outputPath = path.join(fixtureDir, 'rendered.mp4')
    const fullOutput = await fetch(
      `http://127.0.0.1:${server.address().port}${job.outputs[0].downloadUrl}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    const bytes = Buffer.from(await fullOutput.arrayBuffer())
    require('node:fs').writeFileSync(outputPath, bytes)
    if (process.env.AD_TEST_PREVIEW_PATH)
      require('node:fs').copyFileSync(outputPath, process.env.AD_TEST_PREVIEW_PATH)
    const probe = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', outputPath],
      { encoding: 'utf8' },
    )
    assert.equal(probe.status, 0, probe.stderr)
    const streams = JSON.parse(probe.stdout).streams
    assert.ok(
      streams.some(
        (stream) => stream.codec_type === 'video' && stream.width === 360 && stream.height === 640,
      ),
    )
    assert.ok(streams.some((stream) => stream.codec_type === 'audio'))

    const staleJob = await AdRenderJob.findByPk(jobId)
    staleJob.setDataValue('status', 'running')
    await cancelAdRender(staleJob)
    await staleJob.reload()
    assert.equal(staleJob.status, 'completed', 'a stale cancel must not replace completed state')
  } finally {
    await stopAdRenderQueue()
    if (server) {
      server.close()
      server.closeAllConnections()
    }
    if (projectId) {
      const { AdProject } = require('../dist/database/models/AdProject.js')
      await AdProject.destroy({ where: { id: projectId } })
      await rm(path.join(path.resolve(env.AD_MEDIA_DIR), 'projects', String(projectId)), {
        recursive: true,
        force: true,
      })
    }
    await user.destroy()
    await otherUser.destroy()
    await rm(fixtureDir, { recursive: true, force: true })
    await sequelize.close()
  }
})
