import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSmartSearchPreset } from '../src/lib/smartSearchPreset.ts'

test('smart search presets use ANY whole-word matching and preserve zero thresholds', () => {
  const preset = buildSmartSearchPreset({ audienceSlug: 'PET', keywords: ['ração', 'pet'], minCommissionPercent: 0, minEstimatedCommission: 2 }, '2026-10-15')
  assert.equal(preset.matchMode, 'any')
  assert.equal(preset.matchStyle, 'word')
  assert.deepEqual(preset.commission, { minPercent: 0, minEstimatedBrl: 2 })
})
test('presets normalize duplicate accents/case and respect the extension pack limit', () => {
  const preset = buildSmartSearchPreset({ audienceSlug: 'PET', keywords: [' Ração ', 'racao', ...Array.from({ length: 30 }, (_, i) => `item${i}`)] }, '2026-10-15')
  assert.equal(preset.keywords.length, 20)
  assert.deepEqual(preset.keywords.slice(0, 2), ['Ração', 'item0'])
  assert.deepEqual(preset.commission, {})
})
test('presets reject invalid dates and empty or separator-only keyword packs', () => {
  assert.throws(() => buildSmartSearchPreset({ audienceSlug: 'PET', keywords: ['pet'] }, '2026-02-30'), /data válida/)
  assert.throws(() => buildSmartSearchPreset({ audienceSlug: 'PET', keywords: ['cat,dog', ''] }, '2026-10-15'), /palavras-chave/)
})

test('v1 presets preserve commission compatibility while carrying optional price and political filters', () => {
  const preset = buildSmartSearchPreset({ audienceSlug: 'PET', keywords: ['pet'], minPrice: 0, maxPrice: 100, excludePolitical: true, minCommissionPercent: 0, minEstimatedCommission: 0 }, '2026-10-21')
  assert.equal(preset.version, 1)
  assert.equal(preset.type, 'achadinhos-smart-search')
  assert.equal(preset.excludePolitical, true)
  assert.equal(preset.minPrice, 0)
  assert.equal(preset.maxPrice, 100)
  assert.deepEqual(preset.commission, { minPercent: 0, minEstimatedBrl: 0 })
  const legacy = buildSmartSearchPreset({ audienceSlug: 'PET', keywords: ['pet'] }, '2026-10-21')
  assert.equal(legacy.excludePolitical, false)
  assert.equal(Object.hasOwn(legacy, 'minPrice'), false)
  assert.equal(Object.hasOwn(legacy, 'maxPrice'), false)
  for (const filters of [{ minPrice: 1, maxPrice: 0 }, { maxPrice: -1 }, { minCommissionPercent: 101 }, { minEstimatedCommission: Infinity }]) assert.throws(() => buildSmartSearchPreset({ audienceSlug: 'PET', keywords: ['pet'], ...filters }, '2026-10-21'), /filtros/)
})
