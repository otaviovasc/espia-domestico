const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildAudioFinishingFilter, resolveAdAudioFinishing } = require('../dist/services/adAudioFinishing.js')

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr?.toString())
  return result
}

function audioStats(file) {
  const pcm = ffmpeg(['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']).stdout
  let peak = 0
  let sum = 0
  for (let offset = 0; offset + 3 < pcm.length; offset += 4) {
    const sample = pcm.readFloatLE(offset)
    assert.ok(Number.isFinite(sample), 'Decoded samples must be finite')
    peak = Math.max(peak, Math.abs(sample))
    sum += sample * sample
  }
  assert.ok(pcm.length > 0, 'Output must contain audio samples')
  return { peak, rms: Math.sqrt(sum / (pcm.length / 4)), seconds: pcm.length / 4 / 48000 }
}

function measuredLoudness(file) {
  const result = ffmpeg(['-i', file, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'])
  const report = result.stderr.toString().match(/\{\s*"input_i"[\s\S]*?\}/)
  assert.ok(report, 'FFmpeg must return measured loudness')
  const parsed = JSON.parse(report[0])
  return { lufs: Number(parsed.input_i), truePeakDb: Number(parsed.input_tp) }
}

test('audio finishing stays opt-in for old projects and only admits bounded filter parameters', () => {
  assert.deepEqual(resolveAdAudioFinishing(), { normalizeLoudness: false, targetLufs: -14 })
  assert.equal(buildAudioFinishingFilter(), null)
  assert.equal(buildAudioFinishingFilter({ targetLufs: -12 }), null)
  for (const targetLufs of [-16, -14, -12]) {
    assert.equal(buildAudioFinishingFilter({ normalizeLoudness: true, targetLufs }), `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11,aresample=48000`)
  }
  for (const value of [null, [], 'true', { normalizeLoudness: 'true' }, { normalizeLoudness: null }, { targetLufs: null }, { targetLufs: -15 }, { targetLufs: NaN }, { targetLufs: '-14,volume=100' }]) {
    assert.throws(() => buildAudioFinishingFilter(value), TypeError)
  }
})

test('real FFmpeg raises a quiet input toward the selected LUFS without clipping or changing duration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ad-audio-finishing-'))
  try {
    const input = path.join(directory, 'quiet.wav')
    const output = path.join(directory, 'finished.wav')
    const aacOutput = path.join(directory, 'finished.m4a')
    ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-af', 'volume=0.05', '-c:a', 'pcm_f32le', input])
    const finishing = buildAudioFinishingFilter({ normalizeLoudness: true, targetLufs: -14 })
    ffmpeg(['-v', 'error', '-i', input, '-af', finishing, '-c:a', 'pcm_f32le', output])
    ffmpeg(['-v', 'error', '-i', input, '-af', finishing, '-c:a', 'aac', '-b:a', '192k', aacOutput])
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'json', aacOutput], { encoding: 'utf8', timeout: 30000 })
    assert.equal(probe.status, 0, probe.stderr)
    assert.equal(JSON.parse(probe.stdout).streams[0].sample_rate, '48000')
    const measuredAac = measuredLoudness(aacOutput)
    assert.ok(Math.abs(measuredAac.lufs + 14) < 0.75, `AAC LUFS measured ${measuredAac.lufs}`)
    assert.ok(measuredAac.truePeakDb <= -1.4, `AAC true peak measured ${measuredAac.truePeakDb} dBTP`)
    const before = audioStats(input)
    const after = audioStats(output)
    const measuredBefore = measuredLoudness(input)
    const measuredAfter = measuredLoudness(output)
    assert.ok(after.rms > before.rms * 10, `RMS must increase: ${before.rms} -> ${after.rms}`)
    assert.ok(measuredAfter.lufs > measuredBefore.lufs + 20)
    assert.ok(Math.abs(measuredAfter.lufs + 14) < 0.75, `LUFS measured ${measuredAfter.lufs}`)
    assert.ok(after.peak < 1, `Peak ${after.peak} must not clip`)
    assert.ok(measuredAfter.truePeakDb <= -1.4, `True peak measured ${measuredAfter.truePeakDb} dBTP`)
    assert.ok(Math.abs(after.seconds - before.seconds) < 0.025)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('real FFmpeg keeps silence valid and silent when finishing is enabled', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ad-audio-silence-'))
  try {
    const output = path.join(directory, 'silent.wav')
    ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '3', '-af', buildAudioFinishingFilter({ normalizeLoudness: true }), '-c:a', 'pcm_f32le', output])
    const stats = audioStats(output)
    assert.equal(stats.peak, 0)
    assert.equal(stats.rms, 0)
    assert.ok(Math.abs(stats.seconds - 3) < 0.025)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
