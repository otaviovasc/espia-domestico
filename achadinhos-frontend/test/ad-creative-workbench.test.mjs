import test from 'node:test'
import assert from 'node:assert/strict'
import { exportCreativeRecipe, MAX_RECIPE_BYTES, parseCreativeRecipe, reviewCreativeRecipe, stageStoryboard } from '../src/lib/adCreativeWorkbench.ts'

const edit = { trimStart: 0.5, trimEnd: 4, speed: 1, framingOverride: true, focusX: 45, focusY: 55, zoom: 1.2, volume: 0.6, motion: 'none' }
const config = () => ({
  kind: 'video', productIds: [999], variationCount: 2,
  texts: ['Produto real\nR$ 49,90 · Cupom: REAL', 'Confira as dimensões no anúncio'],
  selectedClipIds: [41, 42], clipEdits: { '42': structuredClone(edit) }, musicAssetId: 43, musicVolume: 0.7,
  musicTracks: [{ assetId: 43, volume: 0.7, startSeconds: 0, endSeconds: null, sourceStartSeconds: 1, fadeInSeconds: 0.2, fadeOutSeconds: 0.5 }],
  carousel: { caption: 'Legenda original', slides: [] }, timing: { mode: 'fixed', seconds: 2.5 },
  transition: { preset: 'fade', durationSeconds: 0.3, sfx: 'whoosh', sfxVolume: 0.1 },
  output: { width: 1080, height: 1920, durationSeconds: 15, fps: 30 },
  framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018' }, colorPreset: 'natural',
  visualEffects: { preset: 'natural', brightness: 0, contrast: 1, saturation: 1, sharpness: 0, temperature: 0, vignette: 0, grain: 0, glow: 0 },
  hook: { enabled: false, clipAssetId: null, durationSeconds: 1.5, text: '' },
  textStyle: { fontSize: 72, positionY: 52, fontColor: '#FFFFFF', borderColor: '#000000', borderWidth: 6 },
  overlays: [], audioFinishing: { normalizeLoudness: false, targetLufs: -14 },
})
const assets = [
  { id: 41, kind: 'image', originalName: 'produto.png', width: 1080, height: 1920, durationSeconds: 0, contentUrl: '/private/image?token=SECRET', storagePath: '/private/disk' },
  { id: 42, kind: 'clip', originalName: 'produto.mp4', width: 1080, height: 1920, durationSeconds: 10, contentUrl: '/private/video' },
  { id: 43, kind: 'music', originalName: 'musica.mp3', width: null, height: null, durationSeconds: 45, contentUrl: '/private/music' },
]
const project = { name: 'Minha receita', assets }
const recipe = () => exportCreativeRecipe(project, config())

test('storyboard goals preserve source facts, refs, edits and audio without mutating the original', () => {
  for (const goal of ['showcase', 'comparison', 'offer']) {
    const original = config()
    const before = structuredClone(original)
    const staged = stageStoryboard(original, goal)
    assert.deepEqual(original, before)
    for (const key of ['texts', 'productIds', 'selectedClipIds', 'clipEdits', 'musicTracks', 'musicAssetId', 'musicVolume']) assert.deepEqual(staged[key], before[key])
    assert.equal(staged.carousel.caption, before.carousel.caption)
    assert.notEqual(staged.timing.seconds, goal === 'showcase' ? 4 : 2.5)
    if (goal === 'offer') assert.equal(staged.hook.text, original.texts[0])
  }
})

test('carousel layouts retain edits, factual overlays and caption; optional CTA appends without truncation', () => {
  const original = config()
  original.kind = 'carousel'
  original.output.height = 1350
  original.carousel.slides = [
    { assetId: 41, text: 'Produto real\nR$ 49,90', durationSeconds: 5 },
    { assetId: 42, text: 'Cupom: REAL', durationSeconds: 5, edit: structuredClone(edit) },
  ]
  const staged = stageStoryboard(original, 'comparison')
  assert.deepEqual(staged.carousel.slides.map(s => s.text), original.carousel.slides.map(s => s.text))
  assert.deepEqual(staged.carousel.slides[1].edit, edit)
  assert.equal(staged.carousel.slides[0].durationSeconds, 7)
  assert.equal(staged.carousel.caption, original.carousel.caption)
  const withCta = stageStoryboard(original, 'offer', true)
  assert.equal(withCta.carousel.slides[1].text, 'Cupom: REAL\nVeja os detalhes no link.')
  original.carousel.slides[1].text = 'x'.repeat(280)
  assert.throws(() => stageStoryboard(original, 'offer', true), /não tem espaço/)
  assert.equal(original.carousel.slides[1].text.length, 280)
})

test('export is versioned plain data with recipe-local keys and no product IDs or private media fields', () => {
  const exported = recipe()
  assert.equal(exported.version, 1)
  assert.equal(exported.format, 'espia-creative-recipe')
  assert.deepEqual(exported.media.map(m => m.key), [1, 2, 3])
  assert.deepEqual(exported.config.selectedClipIds, [1, 2])
  assert.equal(exported.config.musicTracks[0].assetId, 3)
  assert.deepEqual(Object.keys(exported.config.clipEdits), ['2'])
  const json = JSON.stringify(exported)
  for (const secret of ['productIds', 'contentUrl', 'storagePath', 'SECRET', '/private']) assert.equal(json.includes(secret), false)
  assert.deepEqual(parseCreativeRecipe(json), exported)
})

test('import maps every reference to current project assets and keeps current product links', () => {
  const currentAssets = assets.map(a => ({ ...a, id: a.id + 100 }))
  const current = { ...config(), productIds: [77] }
  const reviewed = reviewCreativeRecipe(recipe(), currentAssets, current)
  assert.deepEqual(reviewed.config.selectedClipIds, [141, 142])
  assert.deepEqual(Object.keys(reviewed.config.clipEdits), ['142'])
  assert.equal(reviewed.config.musicAssetId, 143)
  assert.equal(reviewed.config.musicTracks[0].assetId, 143)
  assert.deepEqual(reviewed.config.productIds, [77])
  assert.deepEqual(current.productIds, [77])
  assert.deepEqual(reviewed.config.texts, config().texts)
})

test('missing, changed and duplicate media names block import even when foreign IDs happen to match', () => {
  const exported = recipe()
  const missing = reviewCreativeRecipe(exported, assets.slice(1), config())
  assert.equal(missing.config, null)
  assert.equal(missing.matches[0].issue, 'missing')
  const changed = assets.map(a => ({ ...a, width: a.kind === 'clip' ? 720 : a.width }))
  assert.equal(reviewCreativeRecipe(exported, changed, config()).config, null)
  const duplicate = reviewCreativeRecipe(exported, [...assets, { ...assets[0], id: 901, width: 720 }], config())
  assert.equal(duplicate.config, null)
  assert.equal(duplicate.matches[0].issue, 'ambiguous')
  const impostor = assets.map(a => ({ ...a, id: a.id === 41 ? 1 : a.id, originalName: a.id === 41 ? 'foreign.png' : a.originalName }))
  assert.equal(reviewCreativeRecipe(exported, impostor, config()).config, null)
})

test('malformed, oversized, unsupported and polluted recipes are rejected', () => {
  assert.throws(() => parseCreativeRecipe('{broken'), /JSON inválido/)
  assert.throws(() => parseCreativeRecipe('x'.repeat(MAX_RECIPE_BYTES + 1)), /1 MB/)
  assert.throws(() => parseCreativeRecipe(JSON.stringify({ ...recipe(), version: 2 })), /versão/)
  const polluted = recipe()
  polluted.config.productIds = [888]
  assert.throws(() => parseCreativeRecipe(JSON.stringify(polluted)), /campo desconhecido/)
  const secret = recipe()
  secret.media[0].contentUrl = 'https://private/token'
  assert.throws(() => parseCreativeRecipe(JSON.stringify(secret)), /campo desconhecido/)
  const dangerous = JSON.parse(JSON.stringify(recipe()).replace('"fontSize":72', '"__proto__":{"polluted":true},"fontSize":72'))
  assert.throws(() => parseCreativeRecipe(JSON.stringify(dangerous)), /campo desconhecido/)
  assert.equal({}.polluted, undefined)
})

test('foreign references, wrong media kinds and invalid numeric or enum bounds are rejected', () => {
  const mutations = [
    r => { r.config.selectedClipIds[0] = 1234 },
    r => { r.config.clipEdits['999'] = structuredClone(edit) },
    r => { r.config.musicAssetId = 1 },
    r => { r.config.output.width = 1079 },
    r => { r.config.output.fps = 60 },
    r => { r.config.textStyle.fontSize = 999 },
    r => { r.config.visualEffects.contrast = -1 },
    r => { r.config.transition.preset = 'unknown' },
    r => { r.config.musicTracks[0].startSeconds = 20 },
    r => { r.config.clipEdits['2'].zoom = 0 },
    r => { r.media[0].filename = '/private/file.png' },
    r => { r.media[0].filename = 'https://example.com/file.png' },
  ]
  for (const mutate of mutations) {
    const invalid = recipe()
    mutate(invalid)
    assert.throws(() => parseCreativeRecipe(JSON.stringify(invalid)))
  }
})

test('review rejects crop and source music intervals beyond matched assets', () => {
  const recrop = recipe()
  recrop.config.clipEdits['2'].trimEnd = 12
  assert.throws(() => reviewCreativeRecipe(recrop, assets, config()), /recorte importado/)
  const audio = recipe()
  audio.config.musicTracks[0].sourceStartSeconds = 50
  assert.throws(() => reviewCreativeRecipe(audio, assets, config()), /música importada/)
})

test('carousel slides and opening clip remap independently and templates never change other projects', () => {
  const source = config()
  source.kind = 'carousel'
  source.output.height = 1350
  source.carousel.slides = [{ assetId: 41, text: 'R$ 49,90', durationSeconds: 5 }, { assetId: 42, text: 'Cupom REAL', durationSeconds: 5, edit: structuredClone(edit) }]
  source.hook.clipAssetId = 42
  const before = structuredClone(source)
  const exported = exportCreativeRecipe(project, source)
  const target = assets.map(a => ({ ...a, id: a.id + 200 }))
  const reviewed = reviewCreativeRecipe(exported, target, { ...config(), productIds: [8] })
  assert.deepEqual(reviewed.config.carousel.slides.map(s => s.assetId), [241, 242])
  assert.equal(reviewed.config.hook.clipAssetId, 242)
  assert.deepEqual(source, before)
  assert.deepEqual(reviewed.config.productIds, [8])
})

test('composition image-only assets are manifested and remapped; text layers and audio settings survive exchange', () => {
  const source = config()
  const common = { id: 'layer-1', name: 'Produto', x: 10, y: 20, width: 30, height: 40, opacity: 0.8, hidden: false }
  source.overlays = [
    { ...common, type: 'image', assetId: 44, fit: 'contain' },
    { ...common, id: 'layer-2', name: 'Preço real', type: 'text', text: 'R$ 49,90 · Cupom: REAL', color: '#FFFFFF', fontSize: 72, backgroundColor: '#000000' },
    { ...common, id: 'layer-3', name: 'Fundo', type: 'shape', shape: 'ellipse', color: '#000000' },
  ]
  source.audioFinishing = { normalizeLoudness: true, targetLufs: -16 }
  const withLogo = [...assets, { ...assets[0], id: 44, originalName: 'logo.png' }]
  const exported = exportCreativeRecipe({ ...project, assets: withLogo }, source)
  assert.equal(exported.media.length, 4)
  assert.equal(exported.config.overlays[0].assetId, 4)
  const target = withLogo.map(asset => ({ ...asset, id: asset.id + 100 }))
  const result = reviewCreativeRecipe(exported, target, config()).config
  assert.equal(result.overlays[0].assetId, 144)
  assert.deepEqual(result.overlays.slice(1), source.overlays.slice(1))
  assert.deepEqual(result.audioFinishing, source.audioFinishing)
  const staged = stageStoryboard(source, 'showcase')
  assert.deepEqual(staged.overlays, source.overlays)
  assert.deepEqual(staged.audioFinishing, source.audioFinishing)
  exported.config.overlays[0].assetId = 9876
  assert.throws(() => parseCreativeRecipe(JSON.stringify(exported)), /manifesto/)
})

test('new overlay/audio enum bounds and duplicate layer IDs are validated', () => {
  const mutations = [
    r => { r.config.audioFinishing.targetLufs = -99 },
    r => { r.config.audioFinishing.normalizeLoudness = 'true' },
    r => { r.config.overlays = [{ id: 'x', name: '', type: 'text', x: 10, y: 10, width: 30, height: 20, opacity: 1, hidden: false, text: 'R$ 49,90', color: '#ffffff', fontSize: 201, backgroundColor: '#000000' }] },
    r => { r.config.overlays = [{ id: 'x', name: '', type: 'image', x: 10, y: 10, width: 30, height: 20, opacity: 1, hidden: false, assetId: 2, fit: 'contain' }] },
  ]
  for (const mutate of mutations) {
    const invalid = recipe()
    mutate(invalid)
    assert.throws(() => parseCreativeRecipe(JSON.stringify(invalid)))
  }
})

test('carousel recipes support empty video texts while video recipes require at least one', () => {
  const source = config()
  source.kind = 'carousel'
  source.output.height = 1350
  source.texts = []
  source.carousel.slides = [{ assetId: 41, text: '', durationSeconds: 5 }, { assetId: 42, text: '', durationSeconds: 5 }]
  const exported = exportCreativeRecipe(project, source)
  assert.deepEqual(reviewCreativeRecipe(exported, assets, config()).config.texts, [])
  exported.config.kind = 'video'
  assert.throws(() => parseCreativeRecipe(JSON.stringify(exported)), /Textos/)
})

test('video CTA is a visible global layer independent of the rotating text pool length', () => {
  for (const count of [1, 7, 20]) {
    const source = config()
    source.texts = Array.from({ length: count }, (_, index) => `Fato real ${index + 1} · R$ 49,90`)
    const staged = stageStoryboard(source, 'showcase', true)
    assert.deepEqual(staged.texts, source.texts)
    assert.deepEqual(source.overlays, [])
    assert.equal(staged.overlays.length, 1)
    const cta = staged.overlays[0]
    assert.equal(cta.type, 'text')
    assert.equal(cta.text, 'Veja os detalhes no link.')
    assert.equal(cta.hidden, false)
    assert.equal(cta.opacity, 1)
    assert.equal(cta.name, 'Chamada em todas as cenas')
    assert.deepEqual([cta.x, cta.y, cta.width, cta.height, cta.fontSize], [8, 60, 76, 10, 48])
    assert.equal(exportCreativeRecipe(project, staged).config.overlays[0].text, cta.text)
  }
})

test('CTA avoids existing layer IDs and respects layer capacity without deleting facts or layers', () => {
  const source = config()
  const layer = { id: 'recipe-cta', name: 'Fato real', type: 'text', text: 'R$ 49,90', x: 10, y: 10, width: 30, height: 20, opacity: 1, hidden: false, color: '#FFFFFF', fontSize: 48, backgroundColor: '#000000' }
  source.overlays = [layer, { ...layer, id: ' recipe-cta-2 ' }]
  const staged = stageStoryboard(source, 'comparison', true)
  assert.equal(staged.overlays[2].id, 'recipe-cta-3')
  assert.deepEqual(staged.overlays.slice(0, 2), source.overlays)
  source.overlays = Array.from({ length: 8 }, (_, index) => ({ ...layer, id: `factual-${index}` }))
  const before = structuredClone(source)
  assert.throws(() => stageStoryboard(source, 'offer', true), /8 camadas/)
  assert.deepEqual(source, before)
})

test('import trims overlay IDs before checking uniqueness to match backend normalization', () => {
  const imported = recipe()
  const layer = { id: ' layer ', name: '', type: 'shape', shape: 'rectangle', color: '#FFFFFF', x: 10, y: 10, width: 30, height: 20, opacity: 1, hidden: false }
  imported.config.overlays = [layer]
  assert.equal(parseCreativeRecipe(JSON.stringify(imported)).config.overlays[0].id, 'layer')
  imported.config.overlays.push({ ...layer, id: 'layer' })
  assert.throws(() => parseCreativeRecipe(JSON.stringify(imported)), /Identificadores de camada repetidos/)
})
