#!/usr/bin/env node
// Real local upload/storage/worker/download checks. --serve keeps isolated QA
// data and API on port 3100 for browser acceptance; Ctrl+C removes both.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const backend = path.resolve(__dirname, '../achadinhos-backend')
const fromBackend = (name) => require(path.join(backend, name))
const { Client } = fromBackend('node_modules/pg')
fromBackend('node_modules/dotenv').config({
  path: path.join(backend, '.env'),
  quiet: true,
})
fromBackend('node_modules/reflect-metadata')
const database = `achadinhos_media_qa_${Date.now()}`
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'achadinhos-media-qa-'))
const serve = process.argv.includes('--serve')
let server, sequelize, stopQueue, adminUrl
let cleaned = false

async function cleanup() {
  if (cleaned) return
  cleaned = true
  if (stopQueue) await stopQueue()
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  if (sequelize) await sequelize.close()
  if (adminUrl) {
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.end()
  }
  fs.rmSync(directory, { recursive: true, force: true })
}
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}
async function main() {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname),
    'Requires local PostgreSQL',
  )
  const admin = new URL(url)
  admin.pathname = '/postgres'
  adminUrl = admin.href
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  await client.query(`CREATE DATABASE "${database}"`)
  await client.end()
  url.pathname = `/${database}`
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    AD_MEDIA_QA_DATABASE_URL: url.href,
    NODE_ENV: 'test',
    COOKIE_SECURE: 'false',
    RUN_SCHEDULER: 'false',
    LOG_LEVEL: 'error',
    JWT_SECRET: 'media-validation-only-secret-at-least-32-characters',
    AD_STORAGE_DRIVER: 'local',
    AD_MEDIA_DIR: path.join(directory, 'media'),
  })
  const migrations = path.join(directory, 'sequelize.cjs')
  fs.writeFileSync(
    migrations,
    "module.exports={test:{use_env_variable:'AD_MEDIA_QA_DATABASE_URL',dialect:'postgres',logging:false}}",
  )
  command(
    process.execPath,
    [
      path.join(backend, 'node_modules/sequelize-cli/lib/sequelize'),
      'db:migrate',
      '--env',
      'test',
      '--config',
      migrations,
    ],
    { cwd: backend, env: process.env },
  )
  sequelize = fromBackend('dist/database/index.js').sequelize
  const { User } = fromBackend('dist/database/models/User.js')
  const { generateToken } = fromBackend('dist/middleware/auth.js')
  const { createApp } = fromBackend('dist/app.js')
  const { ensureAdMediaDirectories } = fromBackend(
    'dist/services/AdMediaService.js',
  )
  const queue = fromBackend('dist/services/AdRenderQueue.js')
  stopQueue = queue.stopAdRenderQueue
  await ensureAdMediaDirectories()
  const user = await User.create({
    name: 'Media QA',
    email: 'media-qa@example.invalid',
    passwordHash: await fromBackend('node_modules/bcrypt').hash(
      'Media-QA-local-2026',
      10,
    ),
    role: 'ADMIN',
  })
  const other = await User.create({
    name: 'Other QA',
    email: 'other-media-qa@example.invalid',
    passwordHash: 'unused',
    role: 'MEMBER',
  })
  const token = generateToken(user),
    otherToken = generateToken(other)
  server = createApp().listen(serve ? 3100 : 0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v1/ad-projects`
  async function json(
    suffix,
    method = 'GET',
    data,
    expected = 200,
    auth = token,
  ) {
    const response = await fetch(base + suffix, {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        'content-type': 'application/json',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    })
    const body = await response.json()
    assert.equal(response.status, expected, JSON.stringify(body))
    return body.data
  }
  async function upload(id, kind, file, mime, expected = 201) {
    const form = new FormData()
    form.set('kind', kind)
    form.append(
      'files',
      new Blob([fs.readFileSync(file)], { type: mime }),
      path.basename(file),
    )
    const response = await fetch(`${base}/${id}/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })
    const body = await response.json()
    assert.equal(response.status, expected, JSON.stringify(body))
    return body.data?.[0]
  }
  const { AdProjectConfigSchema } = fromBackend('dist/dtos/adProject.js')
  const config = AdProjectConfigSchema.parse({
    kind: 'carousel',
    texts: ['QA'],
    timing: { mode: 'fixed', seconds: 1 },
    output: { width: 1080, height: 1350, durationSeconds: 3, fps: 24 },
    colorPreset: 'none',
  })
  const carousel = await json(
    '',
    'POST',
    { name: 'Carrossel de imagens e vídeos', config },
    201,
  )
  const images = []
  for (const [extension, mime] of [
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ]) {
    const image = path.join(directory, `produto.${extension}`)
    command('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=0xE85D3F:s=540x675',
      '-vf',
      'drawbox=x=100:y=150:w=340:h=380:color=white:t=fill',
      '-frames:v',
      '1',
      image,
    ])
    images.push(await upload(carousel.id, 'image', image, mime))
  }
  const clip = path.join(directory, 'produto.mp4')
  command('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=0x3478F6:s=360x640:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-pix_fmt',
    'yuv420p',
    clip,
  ])
  const video = await upload(carousel.id, 'clip', clip, 'video/mp4')
  await upload(carousel.id, 'image', clip, 'image/png', 400)
  await upload(
    carousel.id,
    'image',
    path.join(directory, 'produto.png'),
    'image/jpeg',
    400,
  )
  await json(`/${carousel.id}/render-jobs`, 'POST', {}, 422)
  await json(`/${carousel.id}`, 'GET', undefined, 404, otherToken)
  config.carousel = {
    caption: 'Achadinhos para sua casa. #espia',
    slides: [
      {
        assetId: images[1].id,
        text: 'Sua casa merece esse achadinho',
        durationSeconds: 5,
      },
      { assetId: video.id, text: 'Veja em ação', durationSeconds: 3 },
      { assetId: images[0].id, text: '', durationSeconds: 5 },
    ],
  }
  await json(`/${carousel.id}`, 'PATCH', { config })
  const invalid = structuredClone(config)
  invalid.carousel.slides[0].assetId = 999999
  await json(`/${carousel.id}`, 'PATCH', { config: invalid }, 422)
  const job = await json(`/${carousel.id}/render-jobs`, 'POST', {}, 202)
  // Saved edits after submission must not alter a queued job's slide order.
  await json(`/${carousel.id}`, 'PATCH', {
    config: {
      ...config,
      carousel: {
        ...config.carousel,
        slides: [...config.carousel.slides].reverse(),
      },
    },
  })
  await queue.startAdRenderQueue()
  async function completed(projectId, jobId) {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const result = await json(`/${projectId}/render-jobs/${jobId}`)
      if (result.status === 'failed') throw new Error(result.error)
      if (result.status === 'completed') return result
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    throw new Error('Renderer timeout')
  }
  const result = await completed(carousel.id, job.id)
  assert.deepEqual(
    result.outputs.map((output) => output.mimeType),
    ['image/jpeg', 'video/mp4', 'image/jpeg'],
  )
  assert.deepEqual(
    result.outputs.map((output) => output.clipAssetIds[0]),
    config.carousel.slides.map((slide) => slide.assetId),
  )
  for (const output of result.outputs) {
    const response = await fetch(
      `${base}/${carousel.id}/render-jobs/${job.id}/outputs/${output.index}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    assert.equal(response.status, 200)
    assert.ok(response.headers.get('content-type').startsWith(output.mimeType))
    const file = path.join(directory, output.fileName)
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    const probe = JSON.parse(
      command('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height',
        '-of',
        'json',
        file,
      ]),
    )
    assert.equal(probe.streams[0].width, 1080)
    assert.equal(probe.streams[0].height, 1350)
    const range = await fetch(
      `${base}/${carousel.id}/render-jobs/${job.id}/outputs/${output.index}`,
      { headers: { authorization: `Bearer ${token}`, range: 'bytes=0-15' } },
    )
    assert.equal(range.status, 206)
    assert.equal((await range.arrayBuffer()).byteLength, 16)
    const denied = await fetch(
      `${base}/${carousel.id}/render-jobs/${job.id}/outputs/${output.index}`,
      { headers: { authorization: `Bearer ${otherToken}` } },
    )
    assert.equal(denied.status, 404)
  }
  const duplicate = await json(`/${carousel.id}/duplicate`, 'POST', {}, 201)
  assert.equal(duplicate.config.carousel.caption, config.carousel.caption)
  assert.equal(duplicate.config.carousel.slides.length, 3)
  assert.ok(
    duplicate.config.carousel.slides.every((slide) =>
      duplicate.assets.some((asset) => asset.id === slide.assetId),
    ),
  )
  assert.ok(
    duplicate.config.carousel.slides.every(
      (slide) =>
        ![...images, video].some((asset) => asset.id === slide.assetId),
    ),
  )
  const videoConfig = {
    ...config,
    kind: 'video',
    carousel: { slides: [], caption: '' },
    variationCount: 1,
    selectedClipIds: [],
    output: { ...config.output, width: 360, height: 640 },
  }
  const videoProject = await json(
    '',
    'POST',
    { name: 'Vídeo com imagem inserida', config: videoConfig },
    201,
  )
  const still = await upload(
    videoProject.id,
    'image',
    path.join(directory, 'produto.webp'),
    'image/webp',
  )
  await json(`/${videoProject.id}`, 'PATCH', {
    config: { ...videoConfig, selectedClipIds: [still.id] },
  })
  const imageJob = await json(
    `/${videoProject.id}/render-jobs`,
    'POST',
    {},
    202,
  )
  assert.equal(
    (await completed(videoProject.id, imageJob.id)).outputs.length,
    1,
  )
  const motion = await upload(videoProject.id, 'clip', clip, 'video/mp4')
  await json(`/${videoProject.id}`, 'PATCH', {
    config: { ...videoConfig, selectedClipIds: [still.id, motion.id] },
  })
  const videoJob = await json(
    `/${videoProject.id}/render-jobs`,
    'POST',
    {},
    202,
  )
  assert.equal(
    (await completed(videoProject.id, videoJob.id)).outputs.length,
    1,
  )
  console.log(
    'PASS: migrations, JPG/PNG/WebP uploads, signatures, ownership, slide validation, snapshot order, JPG/MP4 rendering, range downloads, duplication, mixed video rendering.',
  )
  if (serve) {
    console.log(
      `Browser QA: http://localhost:5273/painel/ads\nLogin: media-qa@example.invalid / Media-QA-local-2026\nFixtures: ${directory}\nIsolated API: ${base}\nCtrl+C removes the QA database and files.`,
    )
    return
  }
  await cleanup()
}
process.once('SIGINT', () => {
  void cleanup().then(() => process.exit(0))
})
process.once('SIGTERM', () => {
  void cleanup().then(() => process.exit(0))
})
main().catch(async (error) => {
  console.error(error)
  await cleanup()
  process.exitCode = 1
})
