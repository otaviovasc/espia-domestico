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
