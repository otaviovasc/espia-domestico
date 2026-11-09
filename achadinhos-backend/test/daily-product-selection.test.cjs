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
