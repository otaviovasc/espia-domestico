import assert from 'node:assert/strict'
import test from 'node:test'
import { getAdExportReadiness } from '../src/lib/adExportReadiness.ts'

function media(id, kind = 'image', overrides = {}) {
  return { id, kind, originalName: `media-${id}`, mimeType: kind === 'image' ? 'image/png' : kind === 'music' ? 'audio/mpeg' : 'video/mp4', sizeBytes: 1000, durationSeconds: kind === 'image' ? 0 : 10, width: 1080, height: 1920, contentUrl: `/media/${id}`, createdAt: '2026-10-14T12:00:00Z', ...overrides }
}
function config(overrides = {}) {
  return { variationCount: 1, texts: ['Oferta'], selectedClipIds: [1], timing: { mode: 'fixed', seconds: 2.5 }, output: { width: 1080, height: 1920, durationSeconds: 10, fps: 30 }, ...overrides }
}
function readiness(overrides = {}) {
  return getAdExportReadiness({ assets: [media(1), media(2)], config: config(), name: 'Campanha', ...overrides })
}
function job(id, snapshot, overrides = {}) {
  return { id, projectId: 1, status: 'completed', config: snapshot, outputs: [{ index: 0 }], createdAt: '2026-10-14T12:00:00Z', finishedAt: `2026-10-14T12:${String(id).padStart(2, '0')}:00Z`, ...overrides }
}
const blockerIds = (value) => value.blockers.map((issue) => issue.id)

test('legacy optional controls stay exportable; hook null uses the renderer fallback', () => {
  assert.equal(readiness().ready, true)
  const value = readiness({ config: config({ hook: { enabled: true, clipAssetId: null, durationSeconds: 1.5, text: '' } }) })
  assert.equal(value.ready, true)
  assert.equal(readiness({ config: config({ hook: { enabled: true, clipAssetId: 99 } }) }).ready, false)
})

test('carousel image-only projects need slides, not unrelated global text', () => {
  const carousel = config({ kind: 'carousel', texts: [], selectedClipIds: [], output: { width: 1080, height: 1350, durationSeconds: 10, fps: 30 }, carousel: { slides: [{ assetId: 1, text: '', durationSeconds: 5 }, { assetId: 2, text: '', durationSeconds: 5 }], caption: '' } })
  assert.equal(readiness({ config: carousel }).ready, true)
  carousel.carousel.slides.pop()
  assert.ok(blockerIds(readiness({ config: carousel })).includes('media-empty'))
  carousel.carousel.slides.push({ assetId: 99, text: '', durationSeconds: 5 })
  assert.ok(blockerIds(readiness({ config: carousel })).includes('media-selection'))
})

test('preflight identifies missing text, media, names and operations before generation', () => {
  const value = readiness({ config: config({ texts: ['  '], selectedClipIds: [] }), name: '', saveBlocked: 'Recarregue o projeto.', saving: true, activeJob: true })
  assert.deepEqual(blockerIds(value), ['name', 'save-blocked', 'saving', 'active-job', 'media-empty', 'text-empty'])
  assert.equal(value.blockers[1].message, 'Recarregue o projeto.')
  assert.equal(value.ready, false)
})

test('invalid trim, nonfinite edits, music source offsets and fades are blockers', () => {
  assert.ok(blockerIds(readiness({ assets: [media(1, 'clip')], config: config({ clipEdits: { 1: { trimStart: 9.9, trimEnd: 10 } } }) })).includes('media-selection'))
  assert.ok(blockerIds(readiness({ config: config({ clipEdits: { 1: { zoom: NaN } } }) })).includes('media-edits'))
  const track = { assetId: 3, startSeconds: 0, endSeconds: 2, sourceStartSeconds: 0, volume: 1, fadeInSeconds: 1.5, fadeOutSeconds: 1.5 }
  const input = { assets: [media(1), media(3, 'music')], config: config({ musicTracks: [track] }) }
  assert.ok(blockerIds(readiness(input)).includes('music-interval'))
  track.fadeInSeconds = 0
  track.fadeOutSeconds = 0
  track.sourceStartSeconds = 10
  assert.ok(blockerIds(readiness(input)).includes('music-interval'))
  input.assets.pop()
  assert.ok(blockerIds(readiness(input)).includes('music-missing'))
})

test('low resolution, cropped media and unsafe text warn without disabling exports', () => {
  const value = readiness({ assets: [media(1, 'image', { width: 640, height: 360 })], config: config({ textStyle: { positionY: 80 } }) })
  assert.equal(value.ready, true)
  assert.deepEqual(value.advisories.map((issue) => issue.id), ['media-resolution', 'media-crop', 'text-safe-area'])
})

test('invalid export counts, timing and text geometry explain disabled generation', () => {
  const value = readiness({ config: config({ variationCount: NaN, timing: { mode: 'fixed', seconds: 0 }, textStyle: { fontSize: Infinity } }) })
  assert.deepEqual(blockerIds(value), ['variations', 'text-style', 'timing'])
  assert.equal(value.ready, false)
})

test('hidden overlays still require valid image references and finite geometry', () => {
  const overlay = { id: 'logo', name: 'Logo', type: 'image', assetId: 3, fit: 'contain', x: 0, y: 0, width: 20, height: 20, opacity: 1, hidden: true }
  const input = { assets: [media(1), media(3, 'music')], config: config({ overlays: [overlay] }) }
  assert.ok(blockerIds(readiness(input)).includes('overlay-image-0'))
  overlay.assetId = 1
  overlay.x = Infinity
  assert.ok(blockerIds(readiness(input)).includes('overlay-layout-0'))
  overlay.x = 95
  overlay.hidden = false
  const cropped = readiness(input)
  assert.equal(cropped.ready, true)
  assert.ok(cropped.advisories.some((issue) => issue.id === 'overlay-crop-0'))
})

test('completed export matching normalizes defaults and object order but preserves scene order and audio edits', () => {
  const current = config({ selectedClipIds: [1, 2], clipEdits: { 1: { trimStart: 0, trimEnd: null, speed: 1, framingOverride: false, focusX: 50, focusY: 50, zoom: 1 } } })
  const parsed = structuredClone(current)
  parsed.kind = 'video'
  parsed.carousel = { slides: [], caption: '' }
  parsed.overlays = []
  parsed.audioFinishing = { targetLufs: -14, normalizeLoudness: false }
  parsed.clipEdits[1] = { volume: 1, motion: 'none', ...parsed.clipEdits[1] }
  const latest = job(2, parsed)
  const earlier = job(1, parsed)
  const mismatched = job(3, { ...parsed, selectedClipIds: [2, 1] })
  const pending = job(4, parsed, { status: 'running' })
  const jobs = [earlier, mismatched, latest, pending]
  const before = structuredClone(jobs)
  assert.equal(readiness({ config: current, jobs }).latestMatchingJob.id, 2)
  assert.deepEqual(jobs, before, 'preflight must not reorder or mutate supplied jobs')
  assert.equal(readiness({ config: { ...current, audioFinishing: { normalizeLoudness: true, targetLufs: -14 } }, jobs }).latestMatchingJob, null)
  assert.equal(readiness({ config: { ...current, variationCount: 2 }, jobs }).latestMatchingJob, null)
  assert.ok(blockerIds(readiness({ config: { ...current, audioFinishing: { normalizeLoudness: true, targetLufs: -9 } } })).includes('audio-finishing'))
})

test('snapshot matching includes overlay content and excludes failed or empty exports', () => {
  const overlay = { id: 'copy', name: 'Copy', type: 'text', text: 'Oferta', color: '#FFFFFF', fontSize: 48, backgroundColor: '#101018', x: 10, y: 10, width: 40, height: 20, opacity: 1, hidden: false }
  const current = config({ overlays: [overlay] })
  const original = job(1, current)
  assert.equal(readiness({ config: current, jobs: [original] }).latestMatchingJob.id, 1)
  assert.equal(readiness({ config: { ...current, overlays: [{ ...overlay, text: 'Outra oferta' }] }, jobs: [original] }).latestMatchingJob, null)
  assert.equal(readiness({ config: current, jobs: [{ ...original, status: 'failed' }, { ...original, outputs: [] }] }).latestMatchingJob, null)
})
