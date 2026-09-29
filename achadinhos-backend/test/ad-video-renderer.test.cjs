const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')

function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('renderer applies ordered clip edits, crossfades, crop overrides and generated SFX', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'ad-video-renderer-'))
  process.env.AD_MEDIA_DIR = fixtureRoot
  process.env.AD_STORAGE_DRIVER = 'local'
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
  process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'

  const firstPath = path.join(fixtureRoot, 'first.mp4')
  const secondPath = path.join(fixtureRoot, 'second.mp4')
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', firstPath,
  ])
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x33aa66:size=360x640:rate=24:duration=2',
    '-vf', 'drawbox=x=35:y=100:w=100:h=300:color=white:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', secondPath,
  ])

  const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
  const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
  const config = AdProjectConfigSchema.parse({
    variationCount: 1,
    texts: ['OFERTA TESTE'],
    selectedClipIds: [22, 11],
    clipEdits: {
      22: {
        trimStart: 0.3,
        trimEnd: 1,
        speed: 2,
        framingOverride: true,
        focusX: 20,
        focusY: 35,
        zoom: 1.4,
      },
    },
    musicAssetId: null,
    musicVolume: 0.7,
    timing: { mode: 'fixed', seconds: 1 },
    output: { width: 360, height: 640, durationSeconds: 4, fps: 24 },
    framing: { mode: 'contain-blur', focusX: 70, focusY: 60, backgroundColor: '#101018' },
    colorPreset: 'vibrant',
    transition: {
      preset: 'slide-left',
      durationSeconds: 0.25,
      sfx: 'pop',
      sfxVolume: 0.18,
    },
    textStyle: {
      fontSize: 42,
      positionY: 52,
      fontColor: '#FFFFFF',
      borderColor: '#000000',
      borderWidth: 4,
    },
  })
  const job = { id: 991001, projectId: 991001, configSnapshot: config }
  const clips = [
    { id: 11, durationSeconds: 2, storagePath: firstPath },
    { id: 22, durationSeconds: 2, storagePath: secondPath },
  ]

  try {
    const outputs = await new AdVideoRenderer().render(job, clips, [], async () => undefined)
    assert.equal(outputs.length, 1)
    assert.deepEqual(outputs[0].clipAssetIds, [22, 11])
    const probe = JSON.parse(
      command('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
        '-of', 'json', outputs[0].storagePath,
      ]),
    )
    assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.08, probe.format.duration)
    assert.ok(
      probe.streams.some(
        (stream) => stream.codec_type === 'video' && stream.width === 360 && stream.height === 640,
      ),
    )
    assert.ok(probe.streams.some((stream) => stream.codec_type === 'audio'))
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
