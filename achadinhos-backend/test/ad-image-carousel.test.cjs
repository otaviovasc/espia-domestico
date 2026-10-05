const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')

const root = mkdtempSync(path.join(tmpdir(), 'ad-carousel-render-'))
process.env.AD_MEDIA_DIR = root
process.env.AD_STORAGE_DRIVER = 'local'
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'
const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
after(() => rm(root, { recursive: true, force: true }))

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
function config(overrides = {}) {
  return AdProjectConfigSchema.parse({
    texts: ['IMAGE TEST'],
    timing: { mode: 'fixed', seconds: 1 },
    colorPreset: 'none',
    ...overrides,
  })
}
function probe(file) {
  return JSON.parse(
    command('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height,codec_name',
      '-of',
      'json',
      file,
    ]),
  )
}
const image = path.join(root, 'red.png')
const video = path.join(root, 'blue.mp4')
command('ffmpeg', [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=red:s=320x240',
  '-frames:v',
  '1',
  image,
])
command('ffmpeg', [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=blue:s=320x240:d=1',
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
  video,
])
const assets = [
  { id: 1, kind: 'image', storagePath: image, durationSeconds: 0 },
  { id: 2, kind: 'clip', storagePath: video, durationSeconds: 1 },
]

test('legacy projects default to video and carousel constraints reject invalid formats/counts', () => {
  assert.equal(config().kind, 'video')
  assert.deepEqual(config().carousel.slides, [])
  assert.throws(() => config({ kind: 'carousel' }))
  assert.throws(() => config({ output: { width: 361, height: 640 } }))
  assert.throws(() =>
    config({
      kind: 'carousel',
      output: { width: 1080, height: 1350 },
      carousel: { slides: Array.from({ length: 21 }, () => ({ assetId: 1 })) },
    }),
  )
})

test('image-only and mixed videos render continuous MP4s at the requested duration', async () => {
  for (const selectedClipIds of [[1], [1, 2]]) {
    const outputs = await new AdVideoRenderer().render(
      {
        id: selectedClipIds.length,
        projectId: 99,
        configSnapshot: config({
          variationCount: 1,
          selectedClipIds,
          output: { width: 360, height: 640, durationSeconds: 3, fps: 24 },
          transition: { preset: 'fade', durationSeconds: 0.25 },
        }),
      },
      assets,
      [],
      async () => {},
    )
    const data = probe(outputs[0].storagePath)
    assert.ok(Math.abs(Number(data.format.duration) - 3) < 0.1)
    assert.deepEqual(outputs[0].clipAssetIds, selectedClipIds)
    assert.equal(data.streams[0].width, 360)
    const timestamps = command('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=best_effort_timestamp_time',
      '-of',
      'csv=p=0',
      outputs[0].storagePath,
    ])
      .trim()
      .split(/\s+/)
      .map(Number.parseFloat)
    assert.equal(timestamps.length, 72)
    assert.ok(Math.max(...timestamps.slice(1).map((time, i) => time - timestamps[i])) < 0.043)
  }
})

test('carousel exports ordered JPG/MP4 slides with matching dimensions and video audio', async () => {
  const progress = []
  const outputs = await new AdVideoRenderer().render(
    {
      id: 10,
      projectId: 99,
      configSnapshot: config({
        kind: 'carousel',
        output: { width: 1080, height: 1350, fps: 24 },
        framing: { mode: 'contain-solid' },
        carousel: {
          caption: 'Test caption',
          slides: [
            { assetId: 2, text: 'VIDEO', durationSeconds: 3 },
            { assetId: 1, text: 'IMAGE' },
            { assetId: 1, text: '' },
          ],
        },
      }),
    },
    assets,
    [],
    async (value) => progress.push(value),
  )
  assert.deepEqual(
    outputs.map((output) => output.fileName),
    ['slide-01.mp4', 'slide-02.jpg', 'slide-03.jpg'],
  )
  assert.deepEqual(
    outputs.map((output) => output.mimeType),
    ['video/mp4', 'image/jpeg', 'image/jpeg'],
  )
  assert.deepEqual(
    outputs.map((output) => output.clipAssetIds),
    [[2], [1], [1]],
  )
  for (const output of outputs) {
    const data = probe(output.storagePath)
    const stream = data.streams.find((item) => item.codec_type === 'video')
    assert.equal(stream.width, 1080)
    assert.equal(stream.height, 1350)
    if (output.mimeType === 'video/mp4') {
      assert.ok(data.streams.some((item) => item.codec_type === 'audio'))
      assert.ok(Math.abs(Number(data.format.duration) - 3) < 0.1)
    } else assert.equal(stream.codec_name, 'mjpeg')
  }
  assert.equal(progress.at(-1), 100)
})

test('persisted carousel images use JPEG object metadata and legacy videos remain MP4', async (context) => {
  const { mkdir, writeFile, access } = require('node:fs/promises')
  const { AdMediaService } = require('../dist/services/AdMediaService.js')
  const { adObjectStorage } = require('../dist/services/AdObjectStorage.js')
  const source = path.join(root, 'storage-attempt')
  await mkdir(source)
  const outputs = [
    { index: 0, fileName: 'slide-01.jpg', storagePath: path.join(source, 'slide-01.jpg'), mimeType: 'image/jpeg' },
    { index: 1, fileName: 'variacao-1.mp4', storagePath: path.join(source, 'variacao-1.mp4') },
  ]
  for (const output of outputs) await writeFile(output.storagePath, 'test')
  const put = context.mock.method(adObjectStorage, 'putFile', async (key) => key)
  const stored = await new AdMediaService().persistRenderOutputs(99, 100, outputs)
  assert.deepEqual(put.mock.calls.map((call) => call.arguments[2]), ['image/jpeg', 'video/mp4'])
  assert.ok(stored.every((output) => output.storagePath.startsWith('projects/99/renders/100/')))
  await assert.rejects(access(source))
})
