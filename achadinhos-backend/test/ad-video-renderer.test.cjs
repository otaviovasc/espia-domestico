const { after, test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')

const rendererRoot = mkdtempSync(path.join(tmpdir(), 'ad-video-renderer-suite-'))
process.env.AD_MEDIA_DIR = rendererRoot
process.env.AD_STORAGE_DRIVER = 'local'
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'

after(async () => {
  await rm(rendererRoot, { recursive: true, force: true })
})

function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function commandBuffer(program, args) {
  const result = spawnSync(program, args, { encoding: null, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr?.toString())
  return result.stdout
}

function lightPixelCount(frame) {
  let count = 0
  for (const value of frame) {
    if (value >= 192) count += 1
  }
  return count
}

test('renderer applies ordered clip edits, crossfades, crop overrides and generated SFX', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixtureRoot = await mkdtemp(path.join(rendererRoot, 'crossfade-'))

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
    const frameTimestamps = command('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'default=noprint_wrappers=1:nokey=1',
      outputs[0].storagePath,
    ]).trim().split(/\s+/).map((value) => Number.parseFloat(value))
    assert.equal(frameTimestamps.length, 4 * 24)
    const largestFrameGap = Math.max(
      ...frameTimestamps.slice(1).map((timestamp, index) => timestamp - frameTimestamps[index]),
    )
    assert.ok(largestFrameGap <= 1 / 24 + 0.001, `largest frame gap was ${largestFrameGap}s`)
    const transitionAudio = commandBuffer('ffmpeg', [
      '-v', 'error', '-ss', '1', '-i', outputs[0].storagePath, '-t', '0.14',
      '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1',
    ])
    let peak = 0
    for (let offset = 0; offset + 1 < transitionAudio.length; offset += 2) {
      peak = Math.max(peak, Math.abs(transitionAudio.readInt16LE(offset)))
    }
    assert.ok(peak >= 2_000, `transition SFX peak was only ${peak}`)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('renderer shows exactly one caption on the exact cut frame', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixtureRoot = await mkdtemp(path.join(rendererRoot, 'caption-boundary-'))

  const clipPath = path.join(fixtureRoot, 'black.mp4')
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=360x640:rate=24:duration=3',
    '-vf', 'setpts=PTS+if(gte(N\\,12)\\,0.35/TB\\,0)', '-fps_mode', 'vfr',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath,
  ])

  const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
  const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
  const config = AdProjectConfigSchema.parse({
    variationCount: 1,
    texts: ['FIRST', 'SECOND'],
    selectedClipIds: [11],
    musicAssetId: null,
    musicTracks: [],
    timing: { mode: 'fixed', seconds: 1 },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
    framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#000000' },
    colorPreset: 'none',
    visualEffects: {
      preset: 'custom',
      brightness: 0,
      contrast: 1,
      saturation: 1,
      sharpness: 0,
      temperature: 0,
      vignette: 0,
      grain: 0,
      glow: 0,
    },
    transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'none', sfxVolume: 0.18 },
    textStyle: {
      fontSize: 72,
      positionY: 52,
      fontColor: '#FFFFFF',
      borderColor: '#000000',
      borderWidth: 0,
    },
  })

  try {
    const [output] = await new AdVideoRenderer().render(
      { id: 991003, projectId: 991003, configSnapshot: config },
      [{ id: 11, durationSeconds: 3, storagePath: clipPath }],
      [],
      async () => undefined,
    )
    const boundaryFrame = commandBuffer('ffmpeg', [
      '-v', 'error', '-i', output.storagePath,
      '-vf', 'select=eq(n\\,24)', '-fps_mode', 'vfr', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ])
    const nextFrame = commandBuffer('ffmpeg', [
      '-v', 'error', '-i', output.storagePath,
      '-vf', 'select=eq(n\\,25)', '-fps_mode', 'vfr', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ])
    assert.equal(boundaryFrame.length, 360 * 640)
    assert.equal(nextFrame.length, 360 * 640)
    const boundaryPixels = lightPixelCount(boundaryFrame)
    const nextPixels = lightPixelCount(nextFrame)
    assert.ok(
      Math.abs(boundaryPixels - nextPixels) <= 100,
      `cut frame has overlapping captions (${boundaryPixels} light pixels vs ${nextPixels})`,
    )
    const timestamps = command('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'default=noprint_wrappers=1:nokey=1',
      output.storagePath,
    ]).trim().split(/\s+/).map((value) => Number.parseFloat(value))
    assert.equal(timestamps.length, 3 * 24)
    const largestGap = Math.max(
      ...timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]),
    )
    assert.ok(largestGap <= 1 / 24 + 0.001, `largest frame gap was ${largestGap}s`)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('renderer places emoji above the caption without overlap', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixtureRoot = await mkdtemp(path.join(rendererRoot, 'caption-emoji-'))
  const clipPath = path.join(fixtureRoot, 'black.mp4')
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=360x640:rate=24:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath,
  ])
  const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
  const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
  const config = AdProjectConfigSchema.parse({
    variationCount: 1,
    texts: ['😍 FIRST LINE\nSECOND LINE'],
    selectedClipIds: [11],
    timing: { mode: 'fixed', seconds: 3 },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
    framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#000000' },
    colorPreset: 'none',
    visualEffects: {
      preset: 'custom', brightness: 0, contrast: 1, saturation: 1, sharpness: 0,
      temperature: 0, vignette: 0, grain: 0, glow: 0,
    },
    transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'none', sfxVolume: 0.18 },
    textStyle: {
      fontSize: 72, positionY: 52, fontColor: '#FFFFFF', borderColor: '#000000', borderWidth: 0,
    },
  })
  try {
    const [output] = await new AdVideoRenderer().render(
      { id: 991004, projectId: 991004, configSnapshot: config },
      [{ id: 11, durationSeconds: 3, storagePath: clipPath }],
      [],
      async () => undefined,
    )
    const frame = commandBuffer('ffmpeg', [
      '-v', 'error', '-ss', '1', '-i', output.storagePath, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ])
    let emojiMaxY = -1
    let captionMinY = 640
    for (let y = 0; y < 640; y += 1) {
      for (let x = 0; x < 360; x += 1) {
        const offset = (y * 360 + x) * 3
        const red = frame[offset]
        const green = frame[offset + 1]
        const blue = frame[offset + 2]
        if (red > 110 && (red - blue > 35 || green - blue > 35)) emojiMaxY = Math.max(emojiMaxY, y)
        if (red > 190 && green > 190 && blue > 190 && Math.max(red, green, blue) - Math.min(red, green, blue) < 18) {
          captionMinY = Math.min(captionMinY, y)
        }
      }
    }
    assert.ok(emojiMaxY >= 0, 'emoji pixels were not found')
    assert.ok(captionMinY < 640, 'caption pixels were not found')
    assert.ok(emojiMaxY < captionMinY, `emoji ended at y=${emojiMaxY}, caption began at y=${captionMinY}`)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
