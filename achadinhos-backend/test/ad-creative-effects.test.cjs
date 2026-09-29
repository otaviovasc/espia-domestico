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

test('renderer applies hook, visual effects and a multi-track music timeline', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'ad-creative-effects-'))
  process.env.AD_MEDIA_DIR = fixtureRoot
  process.env.AD_STORAGE_DRIVER = 'local'
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
  process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'

  const paths = {
    clipA: path.join(fixtureRoot, 'clip-a.mp4'),
    clipB: path.join(fixtureRoot, 'clip-b.mp4'),
    musicA: path.join(fixtureRoot, 'music-a.m4a'),
    musicB: path.join(fixtureRoot, 'music-b.m4a'),
  }
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=size=360x640:rate=24:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', paths.clipA,
  ])
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i',
    'color=c=0x8855dd:size=360x640:rate=24:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', paths.clipB,
  ])
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:a', 'aac', paths.musicA,
  ])
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-c:a', 'aac', paths.musicB,
  ])

  const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
  const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
  const config = AdProjectConfigSchema.parse({
    variationCount: 1,
    texts: ['OFERTA DE HOJE'],
    selectedClipIds: [11, 22],
    musicAssetId: null,
    musicTracks: [
      {
        assetId: 31,
        volume: 0.45,
        startSeconds: 0,
        endSeconds: 2,
        sourceStartSeconds: 0.1,
        fadeInSeconds: 0.15,
        fadeOutSeconds: 0.2,
      },
      {
        assetId: 32,
        volume: 0.35,
        startSeconds: 2,
        endSeconds: 4,
        sourceStartSeconds: 0,
        fadeInSeconds: 0.2,
        fadeOutSeconds: 0.2,
      },
    ],
    hook: { enabled: true, clipAssetId: 22, durationSeconds: 1.25, text: 'OLHA ISSO' },
    timing: { mode: 'fixed', seconds: 2 },
    output: { width: 360, height: 640, durationSeconds: 4, fps: 24 },
    framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018' },
    colorPreset: 'none',
    visualEffects: {
      preset: 'custom',
      brightness: 0.04,
      contrast: 1.08,
      saturation: 1.12,
      sharpness: 0.4,
      temperature: 0.15,
      vignette: 0.15,
      grain: 0.05,
      glow: 0.12,
    },
    transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'none', sfxVolume: 0.18 },
    textStyle: {
      fontSize: 42,
      positionY: 52,
      fontColor: '#FFFFFF',
      borderColor: '#000000',
      borderWidth: 4,
    },
  })
  const job = { id: 991002, projectId: 991002, configSnapshot: config }
  const clips = [
    { id: 11, durationSeconds: 3, storagePath: paths.clipA },
    { id: 22, durationSeconds: 3, storagePath: paths.clipB },
  ]
  const music = [
    { id: 31, durationSeconds: 3, storagePath: paths.musicA },
    { id: 32, durationSeconds: 3, storagePath: paths.musicB },
  ]

  try {
    const [output] = await new AdVideoRenderer().render(job, clips, music, async () => undefined)
    assert.deepEqual(output.cutTimes, [0, 1.25, 2, 4])
    assert.deepEqual(output.clipAssetIds, [22, 11])
    const probe = JSON.parse(command('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
      '-of', 'json', output.storagePath,
    ]))
    assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.08, probe.format.duration)
    assert.ok(probe.streams.some((stream) => stream.codec_type === 'audio'))
    assert.ok(probe.streams.some(
      (stream) => stream.codec_type === 'video' && stream.width === 360 && stream.height === 640,
    ))
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
