const { after, test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')
require('tsconfig-paths/register')

const mediaRoot = mkdtempSync(path.join(tmpdir(), 'ad-render-options-suite-'))
process.env.AD_MEDIA_DIR = mediaRoot
process.env.AD_STORAGE_DRIVER = 'local'
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'

const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')

after(async () => {
  await rm(mediaRoot, { recursive: true, force: true })
})

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, result.stderr || `${program} failed`)
  return result.stdout
}

function bufferCommand(program, args) {
  const result = spawnSync(program, args, { encoding: null, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr?.toString() || `${program} failed`)
  return result.stdout
}

function config(overrides = {}) {
  return AdProjectConfigSchema.parse({
    variationCount: 1,
    texts: ['OPTION TEST'],
    selectedClipIds: [11],
    clipEdits: {},
    musicAssetId: null,
    musicVolume: 0.8,
    musicTracks: [],
    timing: { mode: 'fixed', seconds: 1 },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
    framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018' },
    colorPreset: 'none',
    visualEffects: {
      preset: 'custom', brightness: 0, contrast: 1, saturation: 1,
      sharpness: 0, temperature: 0, vignette: 0, grain: 0, glow: 0,
    },
    transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'none', sfxVolume: 0.18 },
    hook: { enabled: false, clipAssetId: null, durationSeconds: 1.5, text: '' },
    textStyle: {
      fontSize: 36, positionY: 50, fontColor: '#FFFFFF', borderColor: '#000000', borderWidth: 0,
    },
    ...overrides,
  })
}

function makeVideo(filePath, source, duration = 2) {
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `${source}:duration=${duration}`,
    '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', filePath,
  ])
}

function makeTone(filePath, frequency, duration = 2) {
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`,
    '-c:a', 'aac', filePath,
  ])
}

function makeVariableTone(filePath, duration = 2) {
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i',
    `aevalsrc=exprs=if(lt(t\\,1)\\,sin(2*PI*440*t)\\,sin(2*PI*880*t)):duration=${duration}:sample_rate=48000`,
    '-c:a', 'aac', filePath,
  ])
}

function makeSequenceVideo(filePath, colors, duration = 3) {
  const segmentDuration = duration / colors.length
  const inputs = []
  colors.forEach((color) => {
    inputs.push('-f', 'lavfi', '-i', `color=c=${color}:size=160x160:rate=24:duration=${segmentDuration}`)
  })
  const concatInputs = colors.map((_, index) => `[${index}:v]`).join('')
  command('ffmpeg', [
    '-v', 'error', '-y', ...inputs,
    '-filter_complex', `${concatInputs}concat=n=${colors.length}:v=1:a=0,fps=24,format=yuv420p[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', filePath,
  ])
}

async function render(name, projectConfig, clips, music = []) {
  const parsed = config(projectConfig)
  const outputs = await new AdVideoRenderer().render(
    { id: Math.floor(Math.random() * 1e9), projectId: Math.floor(Math.random() * 1e9), configSnapshot: parsed },
    clips,
    music,
    async () => undefined,
  )
  assert.ok(outputs.length > 0, `${name}: renderer returned no outputs`)
  return { config: parsed, output: outputs[0], outputs }
}

function frame(filePath, second = 0.5, crop = null) {
  const filter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : 'null'
  const width = crop?.width ?? 360
  const height = crop?.height ?? 640
  return bufferCommand('ffmpeg', [
    '-v', 'error', '-ss', String(second), '-i', filePath, '-frames:v', '1',
    '-vf', filter, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ])
}

function averageChannel(pixels, channel) {
  let total = 0
  for (let index = channel; index < pixels.length; index += 3) total += pixels[index]
  return total / Math.max(1, pixels.length / 3)
}

function frameDifference(a, b) {
  assert.equal(a.length, b.length)
  let changed = 0
  let total = 0
  for (let index = 0; index < a.length; index += 1) {
    const delta = Math.abs(a[index] - b[index])
    total += delta
    if (delta > 3) changed += 1
  }
  return { changed, total }
}

function brightBounds(pixels, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 480) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY, area: Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1) }
}

function audioRms(filePath, start, duration) {
  let pcm
  try {
    pcm = bufferCommand('ffmpeg', [
      '-v', 'error', '-ss', String(start), '-i', filePath, '-t', String(duration),
      '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1',
    ])
  } catch {
    return 0
  }
  let sum = 0
  for (let index = 0; index + 1 < pcm.length; index += 2) {
    const sample = pcm.readInt16LE(index) / 32768
    sum += sample * sample
  }
  return Math.sqrt(sum / Math.max(1, pcm.length / 2))
}

function audioZeroCrossings(filePath, start, duration) {
  const pcm = bufferCommand('ffmpeg', [
    '-v', 'error', '-ss', String(start), '-i', filePath, '-t', String(duration),
    '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1',
  ])
  let crossings = 0
  let previous = 0
  for (let index = 0; index + 1 < pcm.length; index += 2) {
    const sample = pcm.readInt16LE(index)
    if (sample === 0) continue
    if (previous !== 0 && ((sample > 0) !== (previous > 0))) crossings += 1
    previous = sample
  }
  return crossings
}

test('renderer changes generated pixels for text geometry and visual effect controls', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixture = await mkdtemp(path.join(mediaRoot, 'pixels-'))
  const clipPath = path.join(fixture, 'source.mp4')
  const textClipPath = path.join(fixture, 'text-black.mp4')
  makeVideo(clipPath, 'testsrc2=size=160x160:rate=24', 2)
  makeVideo(textClipPath, 'color=c=black:size=160x160:rate=24', 2)
  const clip = { id: 11, durationSeconds: 2, storagePath: clipPath }

  const plain = await render('plain', {}, [clip])
  const bright = await render('brightness', { visualEffects: { preset: 'custom', brightness: 0.6 } }, [clip])
  const contrast = await render('contrast', { visualEffects: { preset: 'custom', contrast: 1.8 } }, [clip])
  const saturation = await render('saturation', { visualEffects: { preset: 'custom', saturation: 0.2 } }, [clip])
  const temperature = await render('temperature', { visualEffects: { preset: 'custom', temperature: -0.8 } }, [clip])
  const sharp = await render('sharpness', { visualEffects: { preset: 'custom', sharpness: 1.5 } }, [clip])
  const vignette = await render('vignette', { visualEffects: { preset: 'custom', vignette: 0.9 } }, [clip])
  const grain = await render('grain', { visualEffects: { preset: 'custom', grain: 0.9 } }, [clip])
  const glow = await render('glow', { visualEffects: { preset: 'custom', glow: 0.9 } }, [clip])
  const basePixels = frame(plain.output.storagePath)
  const topLeft = { width: 60, height: 60, x: 0, y: 0 }
  assert.ok(frameDifference(basePixels, frame(bright.output.storagePath)).changed > 100, 'brightness had no pixel effect')
  assert.ok(frameDifference(basePixels, frame(contrast.output.storagePath)).changed > 100, 'contrast had no pixel effect')
  assert.ok(frameDifference(basePixels, frame(saturation.output.storagePath)).changed > 100, 'saturation had no pixel effect')
  assert.ok(frameDifference(basePixels, frame(temperature.output.storagePath)).changed > 100, 'temperature had no pixel effect')
  assert.ok(frameDifference(frame(plain.output.storagePath, 0.5, topLeft), frame(sharp.output.storagePath, 0.5, topLeft)).changed > 25, 'sharpness had no pixel effect')
  assert.ok(frameDifference(frame(plain.output.storagePath, 0.5, topLeft), frame(vignette.output.storagePath, 0.5, topLeft)).changed > 25, 'vignette had no corner effect')
  assert.ok(frameDifference(basePixels, frame(grain.output.storagePath)).changed > 100, 'grain had no pixel effect')
  assert.ok(frameDifference(basePixels, frame(glow.output.storagePath)).changed > 100, 'glow had no pixel effect')

  const textAsset = { id: 11, durationSeconds: 2, storagePath: textClipPath }
  const smallText = await render('small-text', { textStyle: { fontSize: 36, positionY: 30, fontColor: '#FFFFFF', borderColor: '#000000', borderWidth: 0 } }, [textAsset])
  const largeText = await render('large-text', { textStyle: { fontSize: 72, positionY: 70, fontColor: '#FFFFFF', borderColor: '#000000', borderWidth: 5 } }, [textAsset])
  const smallBounds = brightBounds(frame(smallText.output.storagePath), 360, 640)
  const largeBounds = brightBounds(frame(largeText.output.storagePath), 360, 640)
  assert.ok(largeBounds.area > smallBounds.area, `font size did not expand caption bounds: ${JSON.stringify({ smallBounds, largeBounds })}`)
  assert.ok(largeBounds.minY > smallBounds.minY, `positionY did not move caption down: ${JSON.stringify({ smallBounds, largeBounds })}`)
  const redText = await render('red-text', { textStyle: { fontSize: 48, positionY: 50, fontColor: '#FF0000', borderColor: '#000000', borderWidth: 0 } }, [textAsset])
  const red = frame(redText.output.storagePath)
  assert.ok(averageChannel(red, 0) > averageChannel(red, 1) * 1.5, 'fontColor was not reflected in generated pixels')

  const contained = await render('contain-blur', {
    framing: { mode: 'contain-blur', focusX: 50, focusY: 50, backgroundColor: '#101018' },
  }, [clip])
  const focused = await render('focus-zoom', {
    clipEdits: { 11: { trimStart: 0, trimEnd: null, speed: 1, framingOverride: true, focusX: 5, focusY: 85, zoom: 1.8 } },
  }, [clip])
  assert.ok(frameDifference(basePixels, frame(contained.output.storagePath)).changed > 100, 'contain-blur did not change rendered geometry/background')
  assert.ok(frameDifference(basePixels, frame(focused.output.storagePath)).changed > 100, 'per-clip focus/zoom did not change rendered geometry')
})

test('renderer materializes framing, clip order, trim/speed, hook and variation metadata', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixture = await mkdtemp(path.join(mediaRoot, 'timeline-'))
  const firstPath = path.join(fixture, 'first.mp4')
  const secondPath = path.join(fixture, 'second.mp4')
  makeVideo(firstPath, 'color=c=0xCC2211:size=320x160:rate=24', 2)
  makeVideo(secondPath, 'color=c=0x11AAEE:size=160x320:rate=24', 2)
  const clips = [
    { id: 11, durationSeconds: 2, storagePath: firstPath },
    { id: 22, durationSeconds: 2, storagePath: secondPath },
  ]
  const result = await render('timeline', {
    variationCount: 2,
    texts: ['A', 'B'],
    selectedClipIds: [22, 11],
    clipEdits: { 22: { trimStart: 0.25, trimEnd: 1.25, speed: 2, framingOverride: true, focusX: 20, focusY: 70, zoom: 1.35 } },
    timing: { mode: 'fixed', seconds: 0.75 },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
    framing: { mode: 'contain-solid', focusX: 50, focusY: 50, backgroundColor: '#123456' },
    hook: { enabled: true, clipAssetId: 22, durationSeconds: 0.5, text: 'HOOK' },
  }, clips)
  assert.deepEqual(result.output.clipAssetIds, [22, 11], 'first variation lost selected clip order')
  assert.deepEqual(result.output.cutTimes, [0, 0.5, 0.75, 1.5, 2.25, 3], 'hook/fixed timing cut plan was not materialized')
  assert.equal(result.output.durationSeconds, 3)
  assert.equal(result.output.textOrder.length, 2)
  const probe = JSON.parse(command('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', result.output.storagePath,
  ]))
  assert.ok(probe.streams.some((item) => item.codec_type === 'video' && item.width === 360 && item.height === 640))
  const corner = frame(result.output.storagePath, 1.75, { width: 8, height: 8, x: 0, y: 0 })
  assert.ok(Math.abs(corner[0] - 0x12) < 35 && Math.abs(corner[1] - 0x34) < 35 && Math.abs(corner[2] - 0x56) < 35, `contain-solid background was not rendered: ${corner.toString('hex')}`)
  const hookFrame = frame(result.output.storagePath, 0.25)
  const laterFrame = frame(result.output.storagePath, 0.6)
  assert.ok(averageChannel(hookFrame, 2) > averageChannel(hookFrame, 0), 'hook/first selected clip was not rendered at the start')
  assert.ok(averageChannel(laterFrame, 0) > averageChannel(laterFrame, 2), 'ordered second clip was not rendered after the hook')

  const varied = await render('variation-order', {
    variationCount: 2,
    texts: ['A', 'B'],
    selectedClipIds: [11, 22],
    hook: { enabled: false, clipAssetId: null, durationSeconds: 1.5, text: '' },
  }, clips)
  assert.equal(varied.outputs.length, 2, 'variationCount did not produce both requested outputs')
  assert.deepEqual(varied.outputs.map((item) => item.clipAssetIds), [[11, 22], [22, 11]], 'variation outputs did not rotate clip order')

  const sequencePath = path.join(fixture, 'sequence.mp4')
  makeSequenceVideo(sequencePath, ['red', 'green', 'blue'])
  const sequenceClip = { id: 11, durationSeconds: 3, storagePath: sequencePath }
  const sequenceBase = await render('sequence-base', {
    selectedClipIds: [11],
    timing: { mode: 'fixed', seconds: 3 },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
  }, [sequenceClip])
  const sequenceTrimmed = await render('sequence-trimmed', {
    selectedClipIds: [11],
    timing: { mode: 'fixed', seconds: 3 },
    clipEdits: { 11: { trimStart: 1, trimEnd: 3, speed: 1, framingOverride: false, focusX: 50, focusY: 50, zoom: 1 } },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
  }, [sequenceClip])
  const sequenceFast = await render('sequence-fast', {
    selectedClipIds: [11],
    timing: { mode: 'fixed', seconds: 3 },
    clipEdits: { 11: { trimStart: 0, trimEnd: 3, speed: 2, framingOverride: false, focusX: 50, focusY: 50, zoom: 1 } },
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
  }, [sequenceClip])
  const sample = { width: 8, height: 8, x: 8, y: 8 }
  const baseAtStart = frame(sequenceBase.output.storagePath, 0.35, sample)
  const trimAtStart = frame(sequenceTrimmed.output.storagePath, 0.35, sample)
  const baseLater = frame(sequenceBase.output.storagePath, 1.2, sample)
  const fastLater = frame(sequenceFast.output.storagePath, 1.2, sample)
  assert.ok(averageChannel(trimAtStart, 1) > averageChannel(trimAtStart, 0) * 1.35, 'trimStart did not begin on the trimmed source frames')
  assert.ok(averageChannel(baseAtStart, 0) > averageChannel(baseAtStart, 1) * 1.35, 'baseline sequence did not begin on the first source frames')
  assert.ok(averageChannel(fastLater, 2) > averageChannel(fastLater, 1) * 1.25, 'speed did not advance through source frames faster')
  assert.ok(averageChannel(baseLater, 1) > averageChannel(baseLater, 2) * 1.25, 'baseline sequence was not still on the middle source frames')

  const transitionClipA = { id: 31, durationSeconds: 2, storagePath: firstPath }
  const transitionClipB = { id: 32, durationSeconds: 2, storagePath: secondPath }
  for (const preset of ['cut', 'fade', 'dissolve', 'slide-left', 'slide-up', 'zoom']) {
    const transitionResult = await render(`transition-${preset}`, {
      selectedClipIds: [31, 32],
      transition: { preset, durationSeconds: 0.25, sfx: 'none', sfxVolume: 0 },
      output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
    }, [transitionClipA, transitionClipB])
    assert.deepEqual(transitionResult.output.cutTimes, [0, 1, 2, 3], `${preset} changed the cut plan unexpectedly`)
    assert.equal(transitionResult.output.durationSeconds, 3, `${preset} changed output duration metadata`)
    assert.ok(frame(transitionResult.output.storagePath, 1.1).some((value) => value > 8), `${preset} rendered a black transition frame`)
  }
})

test('renderer mixes multi-track audio by timeline and applies SFX preset volume', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixture = await mkdtemp(path.join(mediaRoot, 'audio-'))
  const clipPath = path.join(fixture, 'clip.mp4')
  const musicAPath = path.join(fixture, 'a.m4a')
  const musicBPath = path.join(fixture, 'b.m4a')
  const variableTonePath = path.join(fixture, 'variable.m4a')
  makeVideo(clipPath, 'color=c=0x202020:size=160x160:rate=24', 2)
  makeTone(musicAPath, 440, 2)
  makeTone(musicBPath, 880, 2)
  makeVariableTone(variableTonePath, 2)
  const clips = [{ id: 11, durationSeconds: 2, storagePath: clipPath }]
  const music = [
    { id: 31, durationSeconds: 2, storagePath: musicAPath },
    { id: 32, durationSeconds: 2, storagePath: musicBPath },
  ]
  const result = await render('audio', {
    output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
    musicTracks: [
      { assetId: 31, volume: 0.85, startSeconds: 0, endSeconds: 1, sourceStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0 },
      { assetId: 32, volume: 0.55, startSeconds: 1, endSeconds: 2, sourceStartSeconds: 0.25, fadeInSeconds: 0, fadeOutSeconds: 0 },
    ],
  }, clips, music)
  assert.ok(audioRms(result.output.storagePath, 0.2, 0.5) > 0.02, 'first music track was not audible')
  assert.ok(audioRms(result.output.storagePath, 1.2, 0.5) > 0.01, 'second music track was not audible')
  assert.ok(audioRms(result.output.storagePath, 1.95, 0.05) < audioRms(result.output.storagePath, 1.2, 0.5) * 1.2, 'track end was ignored')
  assert.ok(audioRms(result.output.storagePath, 2.2, 0.4) < 0.005, 'music remained audible after all configured endSeconds')

  const flat = await render('flat-fade', {
    musicTracks: [{ assetId: 31, volume: 0.8, startSeconds: 0, endSeconds: 2, sourceStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0 }],
  }, clips, [{ id: 31, durationSeconds: 2, storagePath: musicAPath }])
  const faded = await render('faded', {
    musicTracks: [{ assetId: 31, volume: 0.8, startSeconds: 0, endSeconds: 2, sourceStartSeconds: 0, fadeInSeconds: 0.8, fadeOutSeconds: 0.8 }],
  }, clips, [{ id: 31, durationSeconds: 2, storagePath: musicAPath }])
  const flatStartRms = audioRms(flat.output.storagePath, 0.08, 0.16)
  const fadedStartRms = audioRms(faded.output.storagePath, 0.08, 0.16)
  const flatEndRms = audioRms(flat.output.storagePath, 1.78, 0.16)
  const fadedEndRms = audioRms(faded.output.storagePath, 1.78, 0.16)
  assert.ok(fadedStartRms < flatStartRms * 0.75, `fadeIn did not reduce beginning RMS (${flatStartRms} -> ${fadedStartRms})`)
  assert.ok(fadedEndRms < flatEndRms * 0.75, `fadeOut did not reduce ending RMS (${flatEndRms} -> ${fadedEndRms})`)

  const sourceZero = await render('source-zero', {
    musicTracks: [{ assetId: 33, volume: 0.8, startSeconds: 0, endSeconds: 1, sourceStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0 }],
  }, clips, [{ id: 33, durationSeconds: 2, storagePath: variableTonePath }])
  const sourceShifted = await render('source-shifted', {
    musicTracks: [{ assetId: 33, volume: 0.8, startSeconds: 0, endSeconds: 1, sourceStartSeconds: 1.25, fadeInSeconds: 0, fadeOutSeconds: 0 }],
  }, clips, [{ id: 33, durationSeconds: 2, storagePath: variableTonePath }])
  const zeroCrossings = audioZeroCrossings(sourceZero.output.storagePath, 0.2, 0.5)
  const shiftedCrossings = audioZeroCrossings(sourceShifted.output.storagePath, 0.2, 0.5)
  assert.ok(zeroCrossings > 300 && zeroCrossings < 600, `sourceStart=0 did not retain the 440 Hz section (${zeroCrossings} crossings)`)
  assert.ok(shiftedCrossings > zeroCrossings * 1.45, `sourceStartSeconds did not seek into the 880 Hz section (${zeroCrossings} -> ${shiftedCrossings})`)

  const secondClip = { id: 22, durationSeconds: 2, storagePath: clipPath }
  const transitionConfig = { selectedClipIds: [11, 22], timing: { mode: 'fixed', seconds: 1 } }
  const noSfx = await render('no-sfx', { ...transitionConfig, transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'none', sfxVolume: 0 } }, [clips[0], secondClip])
  const lowPop = await render('low-pop', { ...transitionConfig, transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'pop', sfxVolume: 0.1 } }, [clips[0], secondClip])
  const highPop = await render('high-pop', { ...transitionConfig, transition: { preset: 'cut', durationSeconds: 0.25, sfx: 'pop', sfxVolume: 0.5 } }, [clips[0], secondClip])
  const noSfxRms = audioRms(noSfx.output.storagePath, 0.95, 0.1)
  const lowRms = audioRms(lowPop.output.storagePath, 0.95, 0.1)
  const highRms = audioRms(highPop.output.storagePath, 0.95, 0.1)
  assert.ok(noSfxRms < 0.005, `none SFX unexpectedly produced audio (${noSfxRms})`)
  assert.ok(lowRms > noSfxRms + 0.005, `pop SFX was not audible (${lowRms})`)
  assert.ok(highRms > lowRms * 1.25, `SFX volume did not increase output (${lowRms} -> ${highRms})`)
})
