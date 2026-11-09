const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { SafeSender } = require('../dist/services/SafeSender')
const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')

const safety = { minDelaySeconds: 0, maxDelaySeconds: 0, maxPerHour: 0, shuffleGroups: false, shuffleOffers: false, warmupBatchSize: 0, warmupPauseFactor: 1 }

test('transport guard runs after slow image preparation and makes no late provider call', async () => {
  let now = new Date('2026-11-09T21:59:00Z')
  let calls = 0
  const sender = new SafeSender({ async sendMedia() { calls++; return { id: 'must-not-send' } }, async sendText() { calls++; return { id: 'must-not-send' } } }, {}, safety, null, true,
    () => now < new Date('2026-11-09T22:00:00Z'))
  sender.resolveUsableImageUrl = async () => { now = new Date('2026-11-09T22:01:00Z'); return 'https://public.invalid/image.png' }
  const [result] = await sender.run([{ group: { id: 'test@g.us', name: 'Test' }, offer: { title: 'Panela', discountedPrice: 100, affiliateUrl: 'https://meli.la/test' } }])
  assert.equal(calls, 0)
  assert.equal(result.cancelledBeforeProvider, true)
})

for (const scenario of ['cutoff', 'evidence-expiry']) {
  test(`slow connection preparation cannot dispatch past ${scenario}`, async () => {
    let now = new Date(scenario === 'cutoff' ? '2026-11-09T21:59:00Z' : '2026-11-09T15:00:00Z')
    const observedAt = scenario === 'cutoff' ? new Date('2026-11-09T09:00:00Z') : new Date('2026-11-08T15:01:00Z')
    const row = { id: 1, userId: 1, audienceSlug: 'domestica', connectionScope: 'scope', localDate: '2026-11-09', timezone: 'America/Sao_Paulo', evidenceObservedAt: observedAt }
    const plan = { id: 1, settings: { dailyAutomation: { localDate: '2026-11-09', startTime: '08:00', endTime: '19:00' }, audiences: { domestica: { startTime: '08:00', endTime: '19:00', freshnessHours: 24 } } }, timezone: row.timezone }
    const sender = new SmartCampaignSender({}, { async requireConnectedContext() { now = new Date(now.getTime() + 120000); return { scope: 'scope' } } }, {}, { now: () => now })
    sender.enforceCurrentAudience = async () => null
    sender.normalizeCatchupDate = async () => {}
    sender.requireCurrentGroup = async () => ({ id: 'test@g.us', name: 'Test' })
    sender.prepareDelivery = async () => ({ kind: 'ready', claim: { id: 1 } })
    let released = 0
    sender.abortPreparedDelivery = async (_plan, _send, _claim, _reason, skip) => { assert.equal(skip, true); released++; return true }
    sender.callProvider = async () => assert.fail('Provider must not be called')
    assert.equal(await sender.processClaim({ send: row, plan }), 'skipped')
    assert.equal(released, 1)
  })
}
