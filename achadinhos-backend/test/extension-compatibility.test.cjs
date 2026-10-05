const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ||= 'test-secret-that-is-at-least-thirty-two-characters'
const { OfferImportService } = require('../dist/services/OfferImportService.js')
const { categorizeOffers } = require('../dist/services/OfferCategorizationService.js')
const { OfferSchema } = require('../dist/dtos/campaign.js')

const card = {
  title: 'Câmera da extensão', productId: 'MLB12345678', productUrl: 'https://www.mercadolivre.com.br/p/MLB12345678',
  commissionedUrl: 'https://meli.la/review', commissionedUrlStatus: 'generated',
  visible: { pricing: { currency: 'BRL', currentAmount: 200, originalAmount: 300 }, commissionPercent: '12%', images: [] },
  commission: { percent: 12, priceBrl: 200, estimatedBrl: 24, basis: 'visible_current_price_times_displayed_percent', guaranteed: false },
  searchMatch: { keywords: ['câmera'], matchMode: 'any', commission: { minPercent: 10, maxPercent: null, minEstimatedBrl: 20 } },
  reviewVideos: { source: 'mercado_livre_product_page', requested: 3, found: 1, status: 'shortfall', videos: [{ url: 'https://video-vod-clips.mms.mlstatic.com/review/master.m3u8', kind: 'customer_review', status: 'complete', format: 'ts', filename: '/home/person/Downloads/mercado-livre-videos/MLB12345678/video-1.ts', downloadId: 42 }] },
}

test('full and compact extension exports preserve bounded evidence through parse, classification and save validation', async () => {
  const compact = { ...card, pricing: card.visible.pricing, commissionPercent: card.visible.commissionPercent, imageUrls: [] }; delete compact.visible
  for (const item of [card, compact]) {
    const parsed = new OfferImportService().parse({ schemaVersion: 1, sourceUrl: 'https://www.mercadolivre.com.br/afiliados/hub', cards: [item] })
    assert.equal(parsed.offers.length, 1)
    const result = await categorizeOffers(parsed.offers, async () => 90)
    const offer = OfferSchema.parse(result.offers[0])
    assert.equal(offer.extensionEvidence.commission.estimatedBrl, 24)
    assert.equal(offer.extensionEvidence.searchMatch.commission.minPercent, 10)
    assert.equal(offer.extensionEvidence.reviewVideos.videos[0].filename, 'video-1.ts')
    assert.equal(offer.extensionEvidence.reviewVideos.videos[0].downloadId, undefined)
    assert.equal(offer.commissionRate, 12)
    assert.equal(offer.discountedPrice, 200)
  }
})

test('invalid optional extension metadata emits a warning without dropping an otherwise valid product', () => {
  const result = new OfferImportService().parse({ schemaVersion: 1, cards: [{ ...card, reviewVideos: { ...card.reviewVideos, videos: Array(21).fill(card.reviewVideos.videos[0]) } }] })
  assert.equal(result.offers.length, 1)
  assert.equal(result.offers[0].extensionEvidence, undefined)
  assert.ok(result.errors.some(item => item.message.includes('Metadados da extensão inválidos')))
})

test('active and interrupted extension exports retain commission and partial video receipts', () => {
  for (const status of [undefined, 'interrupted']) {
    const video = { ...card.reviewVideos.videos[0], status }
    const result = new OfferImportService().parse({ schemaVersion: 1, cards: [{ ...card, reviewVideos: { ...card.reviewVideos, status: 'downloading', videos: [video] } }] })
    assert.equal(result.offers.length, 1)
    const evidence = result.offers[0].extensionEvidence
    assert.equal(evidence.commission.estimatedBrl, 24)
    assert.equal(evidence.reviewVideos.videos[0].status, status ?? 'pending')
    assert.equal(result.errors.length, 0)
  }
})
