import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceInput, audienceValidation, splitAudienceTerms, validPlanDate, inferFileAudience, countFileOffers } from '../src/lib/smartCampaignUi.ts'

const audience = { enabled: true, destinationGroupIds: ['group-b', 'group-a'], profile: { instructions: 'Ofertas de cozinha e organização para casa.', keywords: ['cozinha'], negativeKeywords: [] }, dailyCap: 50, startTime: '09:00', endTime: '21:00', minIntervalMinutes: 12, maxIntervalMinutes: 16, maxStandoutMessages: 3 }
const input = (overrides = {}) => audienceInput({ ...audience, ...overrides }, 'cozinha, casa', '')

test('audience drafts compare editable values and clear commission floors explicitly', () => {
  assert.deepEqual(input(), audienceInput({ ...audience, destinationGroupIds: ['group-a', 'group-b'], updatedAt: 'later' }, 'cozinha, casa', ''))
  assert.equal(JSON.parse(JSON.stringify(input())).minCommissionPercent, null)
  assert.equal(JSON.parse(JSON.stringify(input())).minEstimatedCommission, null)
  assert.equal(input({ minCommissionPercent: 0 }).minCommissionPercent, 0)
  assert.deepEqual(splitAudienceTerms('casa, cozinha, '), ['casa', 'cozinha'])
})

test('audience validation catches invalid limits and missing destinations before saving', () => {
  assert.equal(audienceValidation(input()), null)
  for (const overrides of [{ dailyCap: 51 }, { dailyCap: 1.5 }, { minIntervalMinutes: 16, maxIntervalMinutes: 12 }, { endTime: '09:00' }, { endTime: '22:00' }, { maxStandoutMessages: -1 }, { minCommissionPercent: 101 }, { destinationGroupIds: [] }]) assert.equal(typeof audienceValidation(input(overrides)), 'string')
  assert.equal(audienceValidation(input({ enabled: false, destinationGroupIds: [] })), null)
  assert.match(audienceValidation(audienceInput(audience, 'a', '')), /termos/)
})

test('plan dates reject past, malformed and impossible calendar dates', () => {
  assert.equal(validPlanDate('2026-10-15', '2026-10-15'), true)
  assert.equal(validPlanDate('2026-10-16', '2026-10-15'), true)
  for (const date of ['2026-02-30', '', '2026-13-01', '16/10/2026']) assert.equal(validPlanDate(date, '2026-01-01'), false)
  assert.equal(validPlanDate('2026-10-14', '2026-10-15'), false)
})

test('file audience suggestions handle ambiguity and do not classify tapete as pet', () => {
  const audiences = ['DOMESTICA', 'MASCULINO', 'PESCA', 'PET'].map((slug) => ({ slug, name: slug }))
  const selected = new Set(audiences.map((item) => item.slug))
  assert.equal(inferFileAudience('ofertas-pesca.json', selected, audiences), 'PESCA')
  assert.equal(inferFileAudience('doméstica-15.json', selected, audiences), 'DOMESTICA')
  assert.equal(inferFileAudience('pesca-masculino.json', selected, audiences), undefined)
  assert.equal(inferFileAudience('tapete.json', selected, audiences), undefined)
  assert.equal(inferFileAudience('coleta.json', new Set(['DOMESTICA']), audiences), 'DOMESTICA')
  assert.equal(inferFileAudience('pesca.json', new Set(['DOMESTICA', 'MASCULINO']), audiences), undefined)
})

test('file summaries recognize supported envelopes without inventing an offer count', () => {
  assert.equal(countFileOffers([{}, {}]), 2)
  for (const key of ['offers', 'products', 'items', 'produtos', 'ofertas', 'data', 'cards']) assert.equal(countFileOffers({ [key]: [{}] }), 1)
  assert.equal(countFileOffers({ offers: [] }), 0)
  assert.equal(countFileOffers({ metadata: 'not a product list' }), null)
  assert.equal(countFileOffers(null), null)
})
