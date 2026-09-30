const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'
const { spawnSync } = require('node:child_process')
const { previewTransitionSfx, sfxFilter } = require('../dist/services/adTransitionSfx.js')

function pcm(args, input) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-ac', '1', '-f', 'f32le', 'pipe:1'], { input })
  assert.equal(result.status, 0, result.stderr.toString())
  return new Float32Array(result.stdout.buffer.slice(result.stdout.byteOffset, result.stdout.byteOffset + result.stdout.length))
}

for (const preset of ['whoosh', 'pop', 'click']) {
  test(`${preset} preview PCM matches renderer amplitude and envelope`, async () => {
    const wav = await previewTransitionSfx(preset)
    const preview = pcm(['-i', 'pipe:0'], wav)
    const rendered = pcm(['-filter_complex', sfxFilter(preset, 0.18, 0, 'sfx'), '-map', '[sfx]'])
    assert.equal(preview.length, rendered.length)
    let energy = 0
    for (let i = 0; i < preview.length; i++) {
      assert.ok(Math.abs(preview[i] * 0.36 - rendered[i]) < 0.000001, `sample ${i}`)
      energy += rendered[i] ** 2
    }
    assert.ok(Math.sqrt(energy / rendered.length) > 0.008, 'SFX must be audible')
    assert.equal(await previewTransitionSfx(preset), wav, 'reuse cached audio')
  })
}
