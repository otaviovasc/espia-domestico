const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ||= 'test-secret-that-is-at-least-thirty-two-characters'
const { hasTransportStreamSignature, convertTransportStream, probeMedia } = require('../dist/services/AdMediaService.js')

test('real MPEG-TS converts to browser MP4 preserving video/audio; TypeScript and false signatures fail', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'review-ts-test-'))
  try {
    const file = path.join(root, 'review.ts')
    const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=160x240:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-f', 'mpegts', file], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await hasTransportStreamSignature(file), true)
    const output = await convertTransportStream(file, await probeMedia(file))
    const probe = await probeMedia(output)
    assert.equal(probe.streams.find(s => s.codec_type === 'video').codec_name, 'h264')
    assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac')
    assert.equal(probe.streams.find(s => s.codec_type === 'video').width, 160)
    const invalid = path.join(root, 'source.ts')
    await writeFile(invalid, 'export const fake = 1;'.repeat(30))
    assert.equal(await hasTransportStreamSignature(invalid), false)
    await writeFile(invalid, Buffer.alloc(377, 0x47))
    await assert.rejects(convertTransportStream(invalid, {}), /converter/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('TS with MPEG-2 and MP2 transcodes to browser-compatible H.264 and AAC', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'review-ts-transcode-'))
  try {
    const file = path.join(root, 'review.ts')
    const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=160x240:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpegts', file], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const output = await convertTransportStream(file, await probeMedia(file))
    const probe = await probeMedia(output)
    assert.equal(probe.streams.find(s => s.codec_type === 'video').codec_name, 'h264')
    assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac')
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-'], { encoding: 'utf8' })
    assert.equal(decoded.status, 0, decoded.stderr)
  } finally { await rm(root, { recursive: true, force: true }) }
})
