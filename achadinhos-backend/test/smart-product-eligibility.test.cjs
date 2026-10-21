const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const {
  evaluateSmartProductEligibility: evaluate,
  hasExplicitPoliticalMention: political,
  collectedSmartCommissionRate,
} = require('../dist/utils/smartProductEligibility.js')
const {
  SmartAudiencePolicySchema, UpdateSmartAudienceSchema, CreateSmartPlanSchema,
} = require('../dist/dtos/smartCampaign.js')
const { SmartCampaignService, isEvidenceFresh } = require('../dist/services/SmartCampaignService.js')
const { SmartAudience } = require('../dist/database/models/SmartAudience.js')
const { sequelize } = require('../dist/database/index.js')

const policy = SmartAudiencePolicySchema.parse({ maxStandouts: 0 })
const offer = {
  title: 'Coleira para gatos', discountedPrice: 100, currency: 'BRL',
  commissionRate: 10, affiliateUrl: 'https://example.invalid/product',
  commissioned: true, commissionedUrlStatus: 'generated_from_page_state',
}

test('eligibility DTOs preserve zero, false and update null-clears without coercing blanks', () => {
  assert.equal(SmartAudiencePolicySchema.parse({}).excludePolitical, false)
  for (const key of ['minPrice', 'maxPrice', 'minCommissionPercent', 'minEstimatedCommission']) {
    for (const value of [0, null]) {
      assert.equal(UpdateSmartAudienceSchema.parse({ [key]: value })[key], value)
      assert.equal(UpdateSmartAudienceSchema.parse({ policy: { [key]: value } }).policy[key], value)
    }
    for (const value of ['', '0', -1, Infinity, NaN]) {
      assert.equal(UpdateSmartAudienceSchema.safeParse({ [key]: value }).success, false, `${key}: ${value}`)
      assert.equal(UpdateSmartAudienceSchema.safeParse({ policy: { [key]: value } }).success, false)
    }
  }
  assert.equal(UpdateSmartAudienceSchema.parse({ excludePolitical: false }).excludePolitical, false)
  assert.equal(UpdateSmartAudienceSchema.safeParse({ excludePolitical: 'false' }).success, false)
  assert.equal(SmartAudiencePolicySchema.safeParse({ minPrice: 100, maxPrice: 99 }).success, false)
  assert.equal(SmartAudiencePolicySchema.safeParse({ minCommissionPercent: 101 }).success, false)
  const created = CreateSmartPlanSchema.parse({
    requestId: 'a918a3cb-504b-4a9b-95fb-e0e1c0eb7129', date: '2026-10-21',
    audienceSlugs: ['pet'], rawJson: '[]', settings: {
      excludePolitical: true, minPrice: 0, maxPrice: 100, minCommissionPercent: 0,
      minEstimatedCommission: 0,
    },
  })
  assert.equal(created.settings.minPrice, 0)
  assert.equal(created.settings.excludePolitical, true)
})

test('political filter uses explicit independent product fields and conservative word boundaries', () => {
  for (const title of [
    'Camiseta BOLSONARO', 'Livro sobre POLÍTICA', 'Guia das eleições brasileiras',
    'Biografia Luiz Inácio Lula da Silva', 'Adesivo Lula presidente', 'Caneca FORA LULA',
    'Livro Dilma Rousseff', 'História do Partido dos Trabalhadores', 'Lula 13',
  ]) assert.equal(political({ title }), true, title)
  for (const title of [
    'Isca de lula', 'Lula empanada', 'Receita de lula à dorê', 'Boneca Lula',
    'Livro do professor Lula', 'Anzol para lula', 'Bússola políticaX',
    'Bolsonarossauro', 'Moro em casa', 'Camisa PT tamanho PL',
  ]) assert.equal(political({ title }), false, title)
  assert.equal(political({ title: 'Lula', description: 'Presidente do clube de pesca' }), false)
  assert.equal(political({ title: 'Livro', description: 'Análise de política eleitoral' }), true)
  assert.equal(evaluate({ ...offer, category: 'política', affiliateUrl: 'https://example.invalid/bolsonaro' }, { excludePolitical: true }).eligible, true)
  assert.equal(evaluate({ ...offer, title: 'Lula presidente' }, { excludePolitical: false }).eligible, true)
})

test('all price and commission bounds are inclusive and multiple policies cannot relax each other', () => {
  const limits = { minPrice: 100, maxPrice: 100, minCommissionPercent: 10, minEstimatedCommission: 10 }
  assert.equal(evaluate(offer, limits).eligible, true)
  for (const changed of [
    { minPrice: 100.01 }, { maxPrice: 99.99 },
    { minCommissionPercent: 10.01 }, { minEstimatedCommission: 10.01 },
  ]) assert.equal(evaluate(offer, { ...limits, ...changed }).eligible, false)
  assert.equal(evaluate(offer, { maxPrice: 99 }, { maxPrice: 200 }).eligible, false)
  assert.equal(evaluate({ ...offer, currency: 'USD' }, { minPrice: 0 }).eligible, false)
  assert.equal(evaluate({ ...offer, discountedPrice: 0 }, { maxPrice: 0 }).eligible, true)
  assert.equal(evaluate(offer, { maxPrice: 0 }).eligible, false)
})

test('commission unknown is not zero and estimates never trust cached amounts', () => {
  const unknown = { ...offer, commissionRate: undefined, commissionPercent: undefined }
  assert.equal(collectedSmartCommissionRate(unknown), null)
  assert.equal(evaluate(unknown, { minCommissionPercent: 0 }).eligible, false)
  assert.equal(evaluate(unknown, { minEstimatedCommission: 0 }).estimatedCommission, null)
  assert.equal(evaluate({ ...unknown, commissionPercent: '0%' }, { minCommissionPercent: 0, minEstimatedCommission: 0 }).eligible, true)
  assert.equal(evaluate({ ...unknown, commissionPercent: '10,5%' }, { minCommissionPercent: 10.5 }).eligible, true)
  assert.equal(evaluate({ ...unknown, commissionPercent: 'unknown' }, { minCommissionPercent: 0 }).eligible, false)
  const evidenceOnly = { ...unknown, extensionEvidence: { commission: { percent: 0, estimatedBrl: 999 } } }
  assert.equal(evaluate(evidenceOnly, { minEstimatedCommission: 0 }).eligible, true)
  assert.equal(evaluate(evidenceOnly, { minEstimatedCommission: 1 }).eligible, false)
})

test('audience partial updates validate merged bounds and support both clear aliases', async (t) => {
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  let saves = 0
  const audience = {
    id: 1, slug: 'pet', policy: { ...policy, minPrice: 50, maxPrice: 100 }, destinations: [],
    profile: {}, save: async () => { saves++ },
  }
  service.audienceRows = async () => [audience]
  t.mock.method(sequelize, 'query', async () => [])
  await assert.rejects(service.updateAudience(1, 'pet', UpdateSmartAudienceSchema.parse({ minPrice: 101 })), /preço máximo/)
  await assert.rejects(service.updateAudience(1, 'pet', UpdateSmartAudienceSchema.parse({ policy: { maxPrice: 49 } })), /preço máximo/)
  assert.equal(saves, 0)
  const updated = await service.updateAudience(1, 'pet', UpdateSmartAudienceSchema.parse({
    minPrice: 0, maxPrice: null, excludePolitical: true,
  }))
  assert.equal(updated.minPrice, 0)
  assert.equal(updated.maxPrice, undefined)
  assert.equal(updated.policy.excludePolitical, true)
  const cleared = await service.updateAudience(1, 'pet', UpdateSmartAudienceSchema.parse({ policy: { minPrice: null } }))
  assert.equal(cleared.policy.minPrice, undefined)
})

test('review selection cannot bypass snapshot or current eligibility gates', async (t) => {
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const item = {
    id: '0:pet', audienceSlug: 'pet', date: '2026-10-21', state: 'REJECTED', product: offer,
    fitScore: 95, observedAt: '2026-10-21T11:00:00Z',
  }
  const plan = {
    status: 'REVIEW', revision: 1, audienceSlugs: ['pet'], startDate: item.date, days: 1,
    settings: { audiences: { pet: { ...policy, minPrice: 101 } } }, items: [item],
  }
  service.requirePlan = async () => plan
  t.mock.method(sequelize, 'transaction', async (fn) => fn({}))
  t.mock.method(SmartAudience, 'findAll', async () => [{ slug: 'pet', policy }])
  const patch = { revision: 1, items: [{ id: item.id, state: 'SELECTED' }] }
  await assert.rejects(service.updatePlan(1, 'plan', patch), /Preço abaixo/)
  plan.settings.audiences.pet = policy
  SmartAudience.findAll = async () => [{ slug: 'pet', policy: { ...policy, maxPrice: 99 } }]
  await assert.rejects(service.updatePlan(1, 'plan', patch), /Preço acima/)
})

test('analysis evaluates freshness at each actual slot and retains excluded rows', async () => {
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const start = new Date(Date.now() + 86_400_000)
  const date = start.toISOString().slice(0, 10)
  const observedAt = new Date(`${date}T09:00:00Z`).getTime() - 24 * 3_600_000 + 60_000
  const products = [offer, { ...offer, title: 'Outra coleira' }, { ...offer, title: 'Lula presidente' }]
  const analyses = Object.fromEntries(products.slice(0, 2).map((_, index) => [String(index), {
    fits: [{ slug: 'pet', score: 95, seasonalScore: 50, reason: 'Adequado', category: `category-${index}` }], warnings: [],
  }]))
  const testPolicy = { ...policy, timezone: 'UTC', excludePolitical: true }
  const items = await service.buildItems(
    { uuid: 'slot-test', startDate: date, days: 1, settings: { audiences: { pet: testPolicy } } },
    products, products.map(() => new Date(observedAt).toISOString()), analyses,
    [{ slug: 'pet', policy: testPolicy }], 'worker',
  )
  const selected = items.filter((item) => item.state === 'SELECTED')
  assert.equal(selected.length, 1, 'the second slot is more than 24h after observation')
  assert.ok(selected.every((item) => isEvidenceFresh(item.observedAt, new Date(item.scheduledAt), 24)))
  assert.equal(items[1].state, 'RESERVE')
  assert.equal(items[2].state, 'REJECTED')
  assert.match(items[2].reason, /política/)
  assert.equal(items[2].fitScore, undefined)
})

test('keyword packs export every eligibility field including zero', async () => {
  const service = new SmartCampaignService({}, {}, {
    keywordPacks: async () => [{ slug: 'pet', keywords: ['coleira'], reason: 'Rotina' }],
  }, {}, {})
  service.audienceRows = async () => [{ slug: 'pet', name: 'PET', profile: {}, policy: {
    ...policy, excludePolitical: true, minPrice: 0, maxPrice: 200,
    minCommissionPercent: 0, minEstimatedCommission: 0,
  } }]
  const { packs: [pack] } = await service.keywordPacks(1, '2026-10-21', ['pet'])
  assert.equal(pack.excludePolitical, true)
  assert.equal(pack.minPrice, 0)
  assert.equal(pack.maxPrice, 200)
  assert.equal(pack.minCommissionPercent, 0)
  assert.equal(pack.minEstimatedCommission, 0)
})
