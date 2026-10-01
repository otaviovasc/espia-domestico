const { test } = require('node:test')
const assert = require('node:assert/strict')

const { buildTasks } = require('../dist/services/SafeSender.js')

const offers = Array.from({ length: 8 }, (_, i) => ({
  title: `Produto ${i + 1}`,
  discountedPrice: 10 + i,
  affiliateUrl: `https://example.invalid/p${i + 1}`,
}))
const groups = [
  { id: '1@g.us', name: 'Grupo 1' },
  { id: '2@g.us', name: 'Grupo 2' },
]
const baseSafety = {
  minDelaySeconds: 1,
  maxDelaySeconds: 2,
  shuffleGroups: false,
  maxPerHour: 0,
  warmupBatchSize: 0,
  warmupPauseFactor: 1,
}

test('buildTasks keeps offer order when shuffleOffers is false', () => {
  const tasks = buildTasks(offers, groups, { ...baseSafety, shuffleOffers: false })
  assert.equal(tasks.length, offers.length * groups.length)
  assert.deepEqual(
    tasks.map((t) => t.offer.title),
    offers.flatMap((offer) => groups.map(() => offer.title)),
  )
})

test('buildTasks mixes offer order when shuffleOffers is on but keeps every pair', () => {
  const safety = { ...baseSafety, shuffleOffers: true }
  const pairKeys = (tasks) =>
    tasks.map((t) => `${t.offer.title}\u0000${t.group.id}`).sort()
  const expected = pairKeys(buildTasks(offers, groups, { ...baseSafety, shuffleOffers: false }))

  let sawDifferentOrder = false
  for (let attempt = 0; attempt < 10; attempt++) {
    const tasks = buildTasks(offers, groups, safety)
    assert.deepEqual(pairKeys(tasks), expected)
    const order = tasks.map((t) => t.offer.title).join('|')
    const ordered = offers.flatMap((offer) => groups.map(() => offer.title)).join('|')
    if (order !== ordered) sawDifferentOrder = true
  }
  assert.ok(sawDifferentOrder, 'expected shuffled offer order to differ at least once in 10 runs')
})

test('buildTasks mixes offers for campaigns saved before the flag existed', () => {
  const { shuffleOffers: _dropped, ...legacySafety } = baseSafety
  const tasks = buildTasks(offers, groups, legacySafety)
  assert.equal(tasks.length, offers.length * groups.length)
})
