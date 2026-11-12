const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dailyCollectionObservation, dailyCollectionSummary, dailySendReason } = require('../dist/utils/dailyObservability')

test('collection summary is numeric, per audience, and replaying a round replaces its observation', () => {
  const payload = { targetAudienceSlug: 'domestica', json: {
    cards: [{ title: 'PRIVATE', commissionedUrl: 'https://private.invalid' }, {}],
    search: { keywords: ['PRIVATE', 'PRIVATE2'] }, collectionDurationMs: 1234,
    excludedPreviouslyUsed: 3,
    dailyCollection: { rejectedByReason: { offAudience: 4, price: 5, freshness: 2, quality: -1, other: 'PRIVATE' } },
  } }
  const observation = dailyCollectionObservation(payload, 1)
  const metrics = { observations: { 'initial:0:domestica': observation }, durationMs: 1500 }
  metrics.observations['initial:0:domestica'] = dailyCollectionObservation(payload, 1)
  const items = [
    { audienceSlug: 'domestica', state: 'SELECTED' },
    { audienceSlug: 'domestica', state: 'SELECTED', repeatFallback: true },
    { audienceSlug: 'domestica', state: 'RESERVE' },
    { audienceSlug: 'domestica', state: 'RESERVE', warnings: ['DAILY_ITEM_DUPLICATE'] },
    { audienceSlug: 'masculino', state: 'REJECTED', reason: 'Preço acima do máximo; Afinidade insuficiente para a seleção diária; Evidência da oferta está antiga' },
    { audienceSlug: 'masculino', state: 'RESERVE', warnings: ['DAILY_ITEM_FRESHNESS'] },
    { audienceSlug: 'masculino', state: 'RESERVE', warnings: ['DAILY_ITEM_REPEAT_NOT_READY'] },
  ]
  const summary = dailyCollectionSummary(metrics, items, 30)
  assert.equal(summary.schemaVersion, 1)
  assert.equal(summary.collectionDurationMs, 1500)
  assert.deepEqual(Object.keys(summary.audiences), ['domestica', 'masculino'])
  const d = summary.audiences.domestica
  assert.equal(d.keywordsTried, 2)
  assert.equal(d.candidatesReturned, 2)
  assert.equal(d.qualified, 4)
  assert.equal(d.freshSelected, 1)
  assert.equal(d.repeatSelected, 1)
  assert.equal(d.reservesKept, 2)
  assert.equal(d.rejectedByReason.historyUnclassified, 3)
  assert.equal(d.rejectedByReason.novelty, 1)
  assert.equal(d.rejectedByReason.variant, 1)
  assert.equal(d.rejectedByReason.price, 5)
  assert.equal(d.rejectedByReason.quality, 0)
  assert.equal(summary.audiences.masculino.qualified, 0)
  assert.equal(summary.audiences.masculino.rejectedByReason.freshness, 2)
  assert.equal(summary.audiences.masculino.rejectedByReason.offAudience, 1)
  assert.equal(summary.audiences.masculino.rejectedByReason.repeatNotReady, 1)
  assert.equal(summary.audiences.masculino.rejectedByReason.cooldown, 0)
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|private.invalid|keywords"|commissionedUrl/)
})

test('legacy payloads produce a stable zero-filled shape and retain ambiguous history as ambiguous', () => {
  const observation = dailyCollectionObservation({ json: { cards: [], excludedPreviouslyUsed: 7 } })
  const summary = dailyCollectionSummary({ observations: { 'initial:0:masculino': observation } }, [])
  assert.equal(summary.audiences.masculino.rejectedByReason.historyUnclassified, 7)
  assert.equal(summary.audiences.masculino.rejectedByReason.cooldown, 0)
  assert.equal(summary.audiences.domestica.collectionDurationMs, 0)
})

test('send reason codes never copy provider errors or arbitrary text', () => {
  for (const [status, reason, expected] of [
    ['SENT', null, 'PROVIDER_CONFIRMED'], ['UNKNOWN', 'PRIVATE', 'PROVIDER_CONFIRMATION_UNKNOWN'],
    ['FAILED', null, 'ATTEMPTS_EXHAUSTED'],
    ['SKIPPED', 'O intervalo seguro ultrapassa a janela diária.', 'GAP_EXCEEDS_WINDOW'],
    ['SKIPPED', 'Produto reservado ou entregue por outro plano após a coleta diária.', 'DAILY_PRODUCT_CONFLICT'],
    ['PENDING', 'Intervalo de segurança compartilhado ainda ativo.', 'SHARED_CADENCE'],
    ['PENDING', 'PRIVATE https://private.invalid', 'STATE_CHANGED'],
  ]) assert.equal(dailySendReason(status, reason), expected)
})
