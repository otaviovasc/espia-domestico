const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { dailyDemandScore, dailySelectionReasons } = require('../dist/utils/dailyProductSelection')
const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
const policy = { minRating: 4.5, minSoldCount: 100, minFitScore: 80, minCommercialScore: 70 }
const offer = (signals, extra = {}) => ({ title: 'Panela de pressão', discountedPrice: 100, originalPrice: 130, commissionRate: 10,
  extensionEvidence: { extractedAt: new Date().toISOString(), visibleSignals: signals }, ...extra })

test('visible popularity is useful, but absent evidence is never a high demand score', () => {
  assert.equal(dailyDemandScore(offer(undefined)), 0)
  assert.ok(dailyDemandScore(offer({ rating: 4.8, soldCount: 50000, bestSeller: true })) > dailyDemandScore(offer({ rating: 4.8, soldCount: 100 })))
  assert.ok(dailyDemandScore(offer({ rating: 4.8, soldCount: 100 })) > dailyDemandScore(offer({ rating: 4.8, soldCount: 0 })))
})

test('missing/weak sales evidence and poor audience fit cannot qualify on commission alone', () => {
  assert.ok(dailySelectionReasons(offer(undefined, { commissionRate: 90 }), 95, 90, policy).some(reason => /Vendas/.test(reason)))
  assert.ok(dailySelectionReasons(offer({ rating: 4.0, soldCount: 50000 }), 95, 90, policy).some(reason => /Avaliação abaixo/.test(reason)))
  assert.ok(dailySelectionReasons(offer({ rating: 4.9, soldCount: 50000 }), 60, 90, policy).some(reason => /Afinidade/.test(reason)))
  assert.deepEqual(dailySelectionReasons(offer({ rating: 4.8, soldCount: 50000 }), 95, 85, policy), [])
})

test('daily scoring ranks strong audience/demand evidence over a larger affiliate payout', () => {
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const now = new Date().toISOString()
  const winner = service.commercialScore(offer({ rating: 4.9, soldCount: 50000, bestSeller: true }, { commissionRate: 5 }), 95, 50, now, { dailySelection: policy })
  const payout = service.commercialScore(offer({ rating: 4.5, soldCount: 100 }, { commissionRate: 50 }), 80, 50, now, { dailySelection: policy })
  assert.ok(winner.total > payout.total)
  assert.ok(winner.components.observedDemand > payout.components.observedDemand)
})

test('good non-discounted products can qualify; time-limited deals do not enter an all-day queue', () => {
  const { DailyAutomationConfigSchema } = require('../dist/config/dailyAutomation')
  const config = DailyAutomationConfigSchema.parse({ userId: 1 })
  const offerPolicy = { ...policy, minCommercialScore: config.minCommercialScore }
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const product = offer({ rating: 4.7, soldCount: 500 }, { originalPrice: undefined })
  const result = service.commercialScore(product, 85, 50, new Date().toISOString(), { dailySelection: offerPolicy })
  assert.deepEqual(dailySelectionReasons(product, 85, result.total, offerPolicy), [])
  assert.ok(dailySelectionReasons(offer({ rating: 4.9, soldCount: 50000, timeLimited: true }), 95, 95, offerPolicy).some(reason => /temporária/.test(reason)))
})

const { dailyCommercialValue, dailyMixedPriceOrder, dailyPriceBand } = require('../dist/utils/dailyCommercialValue')
test('daily commission uses actual BRL price and discounts expensive goods sellability', () => {
  const signals = { rating: 4.9, soldCount: 50000, bestSeller: true }
  const expensive = dailyCommercialValue(offer(signals, { discountedPrice: 1000, commissionRate: 3 }), 95)
  const cheap = dailyCommercialValue(offer(signals, { discountedPrice: 20, commissionRate: 20 }), 95)
  assert.equal(expensive.grossCommissionBrl, 30)
  assert.equal(cheap.grossCommissionBrl, 4)
  assert.ok(expensive.saleEaseIndex < cheap.saleEaseIndex)
  assert.ok(expensive.adjustedCommissionBrl > cheap.adjustedCommissionBrl)
  const sameGross = dailyCommercialValue(offer(signals, { discountedPrice: 100, commissionRate: 30 }), 95)
  assert.equal(sameGross.grossCommissionBrl, expensive.grossCommissionBrl)
  assert.ok(sameGross.adjustedCommissionBrl > expensive.adjustedCommissionBrl)
})

test('mixed daily selection preserves affordable/premium ends and fills all 30 slots', () => {
  const item = (id, price, score) => ({ id, product: { discountedPrice: price }, score, category: 'same' })
  const pool = Array.from({ length: 50 }, (_, i) => item(i, 200, 100 - i / 100))
    .concat(Array.from({ length: 8 }, (_, i) => item(100 + i, 20, 70)))
    .concat(Array.from({ length: 8 }, (_, i) => item(200 + i, 1000, 69)))
  const original = [...pool]
  const ordered = dailyMixedPriceOrder(pool, 30)
  const selected = ordered.slice(0, 30)
  assert.equal(selected.length, 30)
  assert.equal(selected.filter(i => dailyPriceBand(i.product.discountedPrice) === 'affordable').length, 6)
  assert.equal(selected.filter(i => dailyPriceBand(i.product.discountedPrice) === 'premium').length, 6)
  assert.ok(selected.slice(0, 10).some(i => i.product.discountedPrice > 500))
  assert.ok(selected.slice(20).some(i => i.product.discountedPrice <= 100))
  assert.deepEqual(pool, original)
  assert.equal(new Set(ordered.map(i => i.id)).size, pool.length)
  const sparse = pool.filter(i => i.product.discountedPrice !== 1000).concat(item(999, 1000, 1))
  const filled = dailyMixedPriceOrder(sparse, 30).slice(0, 30)
  assert.equal(filled.length, 30)
  assert.ok(filled.some(i => i.id === 999))
  assert.equal(dailyMixedPriceOrder(pool.filter(i => i.product.discountedPrice === 200), 30).slice(0, 30).length, 30)
})

test('daily assortment keeps one Boombox colour variant and promotes another qualified product', () => {
  const row = (id, title, score) => ({ id, product: { title, discountedPrice: 600 }, category: 'Eletrônicos', score })
  const values = [row('blue', 'Caixa de Som JBL Boombox 4 Bluetooth Portátil 210W Bivolt Azul', 95),
    row('orange', 'Jbl Boombox 4 Caixa De Som Com Bluetooth Cor Laranja', 94),
    row('black', 'Caixa de Som Bluetooth Portátil JBL Boombox 4 JBL Pro Sound 210W até 34h de Bateria Preta', 93),
    row('other', 'Projetor HY320 Hardline Smart TV', 80)]
  assert.deepEqual(new Set(dailyMixedPriceOrder(values, 2).slice(0, 2).map(i => i.id)), new Set(['blue', 'other']))
  const distinct = [...values.slice(0, 1), row('older', 'JBL Boombox 3 Preto', 93),
    row('accessory', 'Capa para JBL Boombox 4 Preto', 92), row('kit', 'Kit JBL Boombox 4 e microfone', 91)]
  assert.equal(dailyMixedPriceOrder(distinct, 4).slice(0, 4).length, 4)
})

test('daily diversity counts spelling variants together and defers excess when other categories qualify', () => {
  const categories = ['Eletrônicos', 'ELETRONICOS', 'eletrônicos', 'Eletronicos']
  const values = Array.from({ length: 12 }, (_, id) => ({ id, product: { discountedPrice: 200 }, category: categories[id % 4], score: 98 }))
    .concat(['Ferramentas', 'Moda masculina', 'Perfume masculino'].flatMap((category, n) => Array.from({ length: 4 }, (_, i) => ({ id: 100+n*10+i, product: { discountedPrice: 200 }, category, score: 70 }))))
  const selected = dailyMixedPriceOrder(values, 12).slice(0, 12)
  assert.equal(selected.filter(i => i.id < 100).length, 3)
  assert.equal(selected.length, 12)
})
