const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-render-'))
process.env.AD_MEDIA_DIR = directory
process.env.AD_STORAGE_DRIVER = 'local'
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'
const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
const { MetricsSchema, PublicationSchema } = require('../dist/dtos/adStudio.js')
const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
after(() => fs.rmSync(directory, { recursive: true, force: true }))
function run(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 10 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr.toString())
  return result.stdout
}
test('publication records require export evidence and sales attribution is explicit', () => {
  const metric = {
    impressions: 100,
    clicks: 2,
    saves: 3,
    likes: 4,
    comments: 5,
    observedAt: new Date().toISOString(),
  }
  assert.equal(MetricsSchema.parse(metric).sales, null)
  assert.equal(MetricsSchema.safeParse({ ...metric, sales: 1 }).success, false)
  assert.equal(
    MetricsSchema.parse({ ...metric, sales: 1, attribution: 'Affiliate report' }).sales,
    1,
  )
  const publication = { name: 'Example', projectId: 1 }
  assert.equal(PublicationSchema.safeParse({ ...publication, status: 'scheduled' }).success, false)
  assert.equal(PublicationSchema.safeParse({ ...publication, status: 'published' }).success, false)
})
test('image motion changes rendered frames and trimmed carousel audio honors volume', async () => {
  const still = path.join(directory, 'pattern.png')
  run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640', '-frames:v', '1', still])
  const video = path.join(directory, 'audio.mp4')
  run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=360x640:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    video,
  ])
  const assets = [
    { id: 1, kind: 'image', storagePath: still, durationSeconds: 0 },
    { id: 2, kind: 'clip', storagePath: video, durationSeconds: 1 },
  ]
  const config = AdProjectConfigSchema.parse({
    kind: 'carousel',
    texts: ['test'],
    timing: { mode: 'fixed', seconds: 1 },
    colorPreset: 'none',
    output: { width: 1080, height: 1080, durationSeconds: 3, fps: 24 },
    carousel: {
      slides: [
        { assetId: 1, text: '', durationSeconds: 3, edit: { motion: 'pan-right' } },
        {
          assetId: 2,
          text: '',
          durationSeconds: 3,
          edit: { trimStart: 0.3, trimEnd: 0.8, volume: 0.25 },
        },
        {
          assetId: 2,
          text: '',
          durationSeconds: 3,
          edit: { trimStart: 0.3, trimEnd: 0.8, volume: 1 },
        },
      ],
    },
  })
  const output = await new AdVideoRenderer().render(
    { id: 10, projectId: 1, configSnapshot: config },
    assets,
    [],
    async () => {},
    AbortSignal.timeout(60000),
  )
  const start = run([
    '-ss',
    '0.1',
    '-i',
    output[0].storagePath,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ])
  const end = run([
    '-ss',
    '2.8',
    '-i',
    output[0].storagePath,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ])
  assert.notDeepEqual(start, end)
  function rms(file) {
    const pcm = run(['-i', file, '-vn', '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'])
    let sum = 0
    for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2
    return Math.sqrt(sum / (pcm.length / 4))
  }
  const ratio = rms(output[1].storagePath) / rms(output[2].storagePath)
  assert.ok(ratio > 0.2 && ratio < 0.3, `volume ratio ${ratio}`)
})
