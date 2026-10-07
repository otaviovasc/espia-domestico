const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ||= 'test-secret-that-is-at-least-thirty-two-characters'

const { CampaignService } = require('../dist/services/CampaignService.js')
const { Campaign } = require('../dist/database/models/Campaign.js')
const { SavedProduct } = require('../dist/database/models/SavedProduct.js')
const { CreateCampaignSchema } = require('../dist/dtos/campaign.js')

// PostgreSQL JSONB returns object keys in its storage order, including inside arrays.
function reorderObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reorderObjectKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderObjectKeys(item)]))
  }
  return value
}

const offer = {
  title: 'Panela doméstica',
  discountedPrice: 80,
  currency: 'BRL',
  affiliateUrl: 'https://meli.la/campaign-catalog-test',
  source: 'mercadolivre',
  productId: 'MLB620',
  extensionEvidence: {
    commission: {
      percent: 12, priceBrl: 80, estimatedBrl: 9.6,
      basis: 'visible_current_price_times_displayed_percent', guaranteed: false,
    },
    searchMatch: {
      keywords: ['panela', 'doméstico'], matchMode: 'any',
      commission: { minPercent: 10, maxPercent: null, minEstimatedBrl: 5 },
    },
    reviewVideos: {
      source: 'mercado_livre_product_page', status: 'complete', found: 2,
      videos: [
        { url: 'https://example.com/first.mp4', status: 'complete', format: 'mp4' },
        { url: 'https://example.com/second.mp4', status: 'complete', format: 'mp4' },
      ],
    },
  },
}

test('campaign catalog validation compares nested evidence by value and preserves change protection', async (t) => {
  const storedOffer = reorderObjectKeys(offer)
  const classifications = {
    default: { category: 'A', relevanceScore: 95, discountPercent: 20, commissionRate: 12, profileName: 'Doméstico' },
  }
  const product = { id: 620, offer: storedOffer, classifications }
  t.mock.method(SavedProduct, 'findAll', async () => [product])
  t.mock.method(Campaign, 'create', async (values) => ({ id: 1, ...values }))
  const service = new CampaignService({}, {}, {})
  const create = (snapshot) => service.create(1, CreateCampaignSchema.parse({
    name: '07/10 domestico', offers: [snapshot],
    groups: [{ id: '100@g.us', name: 'Grupo de teste' }], safety: {},
  }))
  const snapshot = { ...storedOffer, savedProductId: product.id }

  await t.test('accepts unchanged catalog evidence after request schema parsing', async () => {
    const campaign = await create(snapshot)
    assert.deepEqual(campaign.offers[0].extensionEvidence, offer.extensionEvidence)
  })

  const ratedSnapshot = {
    ...snapshot, category: 'A', relevanceScore: 95, discountPercent: 20, commissionRate: 12,
    classificationProfileId: 'default', classificationProfileName: 'Doméstico',
  }
  await t.test('accepts selected niche classification with unchanged nested evidence', async () => {
    const campaign = await create(ratedSnapshot)
    assert.equal(campaign.offers[0].category, 'A')
  })

  await t.test('rejects real changes to content, classification, nested evidence and array order', async () => {
    const changedEvidence = structuredClone(snapshot.extensionEvidence)
    changedEvidence.commission.estimatedBrl = 100
    const reorderedVideos = structuredClone(snapshot.extensionEvidence)
    reorderedVideos.reviewVideos.videos.reverse()
    for (const changed of [
      { ...snapshot, discountedPrice: 79 },
      { ...snapshot, affiliateUrl: 'https://example.com/changed' },
      { ...ratedSnapshot, category: 'B' },
      { ...snapshot, extensionEvidence: changedEvidence },
      { ...snapshot, extensionEvidence: reorderedVideos },
    ]) {
      const callsBefore = Campaign.create.mock.callCount()
      await assert.rejects(create(changed), /O produto salvo #620 foi alterado/)
      assert.equal(Campaign.create.mock.callCount(), callsBefore)
    }
  })

  await t.test('rejects catalog IDs unavailable to the current user', async () => {
    await assert.rejects(create({ ...snapshot, savedProductId: 621 }), /não pertence ao usuário/)
  })
})
