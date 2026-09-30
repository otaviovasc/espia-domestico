const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'

function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function config(overrides) {
  const { AdProjectConfigSchema } = require('../dist/dtos/adProject.js')
  return AdProjectConfigSchema.parse({
    variationCount: 1,
    texts: ['CAPTION'],
    selectedClipIds: [1],
    timing: { mode: 'fixed', seconds: 2.5 },
    output: { width: 360, height: 640, durationSeconds: 6, fps: 24 },
    framing: {},
    transition: {},
    visualEffects: {},
    hook: {},
    textStyle: {},
    ...overrides,
  })
}

test('renderer timing inserts the hook cut into fixed timing', async () => {
  const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
  const timing = await new AdVideoRenderer().getTiming(config({
    hook: { enabled: true, clipAssetId: 1, durationSeconds: 1.2, text: 'HOOK' },
  }), [])
  assert.deepEqual(timing, {
    cuts: [0, 1.2, 2.5, 5, 6],
    timingSource: 'fixed',
  })
})

test('beat timing applies source analysis only inside the scheduled music interval', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'FFmpeg is required')
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'ad-video-timing-'))
  const musicPath = path.join(fixtureRoot, 'pulse.wav')
  command('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'aevalsrc=if(lt(mod(t\\,1)\\,0.025)\\,1\\,0):s=48000:d=1',
    '-c:a', 'pcm_s16le', musicPath,
  ])
  try {
    const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
    const timing = await new AdVideoRenderer().getTiming(config({
      timing: { mode: 'beat' },
      musicTracks: [{
        assetId: 2,
        volume: 0.8,
        startSeconds: 2,
        endSeconds: 5,
        sourceStartSeconds: 0,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
      }],
    }), [{ id: 2, storagePath: musicPath }])

    assert.equal(timing.timingSource, 'beat')
    assert.equal(timing.cuts[0], 0)
    assert.equal(timing.cuts[timing.cuts.length - 1], 6)
    assert.ok(timing.cuts.some((cut) => cut >= 2.9 && cut <= 3.1), `cuts were ${timing.cuts}`)
    assert.ok(!timing.cuts.some((cut) => cut > 0.1 && cut < 2), `cuts were ${timing.cuts}`)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
