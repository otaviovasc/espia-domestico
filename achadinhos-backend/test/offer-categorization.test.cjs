const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'

const { MercadoLivreIngestor } = require('../dist/ingestors/MercadoLivreIngestor.js')
const { OfferImportService, MAX_IMPORT_ITEMS } = require('../dist/services/OfferImportService.js')
const {
  categorizeOffers,
  categoryForSignals,
  commercialSignals,
  buildRelevanceQuestion,
} = require('../dist/services/OfferCategorizationService.js')
const { ClassificationProfileInputSchema } = require('../dist/dtos/classificationProfile.js')
const { CampaignController } = require('../dist/controllers/CampaignController.js')

const offer = (title, extra = {}) => ({
  title,
  discountedPrice: 100,
  affiliateUrl: 'https://meli.la/example',
  commissioned: true,
  ...extra,
})

test('household relevance gates unrelated products even with strong commercial signals', () => {
  assert.equal(categoryForSignals(10, 60, 20), 'D')
  assert.equal(categoryForSignals(100, 50, 20), 'A')
  assert.equal(categoryForSignals(100, 50, 0), 'B')
  assert.equal(categoryForSignals(100, 0, 20), 'B')
  assert.equal(categoryForSignals(100, 0, 5), 'B')
  assert.equal(categoryForSignals(45, 50, 20), 'C')
})

test('discount and commission use the source values and reject an uncommissioned link', () => {
  assert.deepEqual(
    commercialSignals(
      offer('panela', {
        originalPrice: 200,
        discountPercent: 50,
        commissionPercent: '17,5%',
      }),
    ),
    { discountPercent: 50, commissionRate: 17.5 },
  )
  assert.equal(
    commercialSignals(offer('panela', { commissionPercent: '20%', commissioned: false }))
      .commissionRate,
    0,
  )
})

test('categorization preserves input order under concurrent Jev responses', async () => {
  const input = [offer('panela'), offer('protetor solar'), offer('climatizador')]
  const scores = { panela: 100, 'protetor solar': 1, climatizador: 90 }
  const result = await categorizeOffers(input, async (item) => {
    await new Promise((resolve) => setTimeout(resolve, item.title === 'panela' ? 10 : 1))
    return scores[item.title]
  })
  assert.deepEqual(
    result.offers.map((item) => item.title),
    input.map((item) => item.title),
  )
  assert.deepEqual(
    result.offers.map((item) => item.category),
    ['B', 'D', 'C'],
  )
  assert.deepEqual(result.counts, { A: 0, B: 1, C: 1, D: 1 })
})

test('a failed Jev response is reported after the parallel batch starts', async () => {
  const seen = []
  const input = Array.from({ length: 8 }, (_, index) => offer(`item ${index}`))
  await assert.rejects(
    categorizeOffers(input, async (item) => {
      seen.push(item.title)
      if (item.title === 'item 0') throw new Error('provider unavailable')
      await new Promise((resolve) => setTimeout(resolve, 5))
      return 80
    }),
    /provider unavailable/,
  )
  assert.equal(seen.length, input.length)
})

test('the full 100-product import can evaluate concurrently', async () => {
  const input = Array.from({ length: MAX_IMPORT_ITEMS }, (_, index) => offer(`item ${index}`))
  let started = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const running = categorizeOffers(input, async () => {
    started++
    await gate
    return 80
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(started, MAX_IMPORT_ITEMS)
  release()
  assert.equal((await running).offers.length, MAX_IMPORT_ITEMS)
})

test('Mercado Livre complete payload signals survive normalization', () => {
  const payload = {
    schemaVersion: 1,
    sourceUrl: 'https://www.mercadolivre.com.br/afiliados',
    cards: [
      {
        productId: 'MLB123',
        title: 'Panela',
        commissionedUrl: 'https://meli.la/example',
        visible: {
          pricing: { currentAmount: 80, originalAmount: 100, discountPercent: 20 },
          commissionPercent: '12%',
        },
      },
    ],
  }
  const result = new MercadoLivreIngestor().ingest(payload)
  assert.equal(result.offers.length, 1)
  assert.equal(result.offers[0].discountPercent, 20)
  assert.equal(result.offers[0].commissionPercent, '12%')
  assert.equal(result.offers[0].commissioned, true)
})

test('generic import preserves the uncommissioned flag before scoring', () => {
  const result = new OfferImportService().parse([
    {
      title: 'Panela',
      price: 100,
      url: 'https://example.com/panela',
      commissionPercent: '20%',
      commissioned: false,
    },
  ])
  assert.equal(result.offers[0].commissioned, false)
  assert.equal(commercialSignals(result.offers[0]).commissionRate, 0)
})

test('imports above the paid evaluation limit are rejected before categorization', () => {
  const cards = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, index) => ({
    title: `Produto ${index}`,
    price: 100,
    url: 'https://example.com/product',
  }))
  assert.throws(() => new OfferImportService().parse(cards), /no máximo 100 produtos/)
})

const sportsProfile = {
  id: '42',
  name: 'Corrida',
  nicheDescription: 'Corredores de rua e pessoas treinando para provas de longa distância.',
  relevanceInstructions: 'Tênis, hidratação e relógios esportivos têm alta relevância.',
  weights: { relevance: 80, discount: 10, commission: 10 },
  discountCap: 40,
  commissionCap: 15,
  thresholds: {
    aScore: 95,
    aRelevance: 98,
    aDiscount: 10,
    aCommission: 5,
    bScore: 60,
    bRelevance: 60,
    cScore: 40,
    dRelevance: 20,
  },
  builtIn: false,
}

test('a custom niche changes both the Jev prompt and deterministic category math', () => {
  const question = buildRelevanceQuestion(sportsProfile)
  assert.match(question.instructions, /Corredores de rua/)
  assert.match(question.instructions, /Tênis, hidratação/)

  assert.equal(categoryForSignals(95, 20, 12), 'A')
  assert.equal(categoryForSignals(95, 20, 12, sportsProfile), 'B')
})

test('profile validation rejects invalid weights, threshold order, and caps', () => {
  const invalid = {
    ...sportsProfile,
    weights: { relevance: 50, discount: 10, commission: 10 },
    thresholds: { ...sportsProfile.thresholds, aScore: 50, aDiscount: 50 },
  }
  const parsed = ClassificationProfileInputSchema.safeParse(invalid)
  assert.equal(parsed.success, false)
  const messages = parsed.error.issues.map((issue) => issue.message).join(' | ')
  assert.match(messages, /somar 100/)
  assert.match(messages, /A > B > C/)
  assert.match(messages, /teto de desconto/)
})

test('import resolves the selected user profile and snapshots it on categorized offers', async () => {
  let resolved
  let usedProfile
  const controller = new CampaignController(
    {},
    {
      parse() {
        return { source: 'generic', totalSeen: 1, offers: [offer('Tênis')], errors: [] }
      },
    },
    {
      async getForUser(userId, profileId) {
        resolved = { userId, profileId }
        return sportsProfile
      },
    },
    {
      async categorize(offers, profile) {
        usedProfile = profile
        return {
          offers: offers.map((item) => ({
            ...item,
            category: 'A',
            relevanceScore: 95,
            classificationProfileId: profile.id,
            classificationProfileName: profile.name,
          })),
          counts: { A: 1, B: 0, C: 0, D: 0 },
        }
      },
    },
  )
  let response
  await controller.importOffers(
    {
      user: { userId: 7 },
      body: { json: [{}], classificationProfileId: '42' },
    },
    {
      json(value) {
        response = value
      },
    },
  )
  assert.deepEqual(resolved, { userId: 7, profileId: '42' })
  assert.equal(usedProfile, sportsProfile)
  assert.deepEqual(response.data.categorization.profile, { id: '42', name: 'Corrida' })
  assert.equal(response.data.offers[0].classificationProfileId, '42')
  assert.equal(response.data.offers[0].classificationProfileName, 'Corrida')
})
