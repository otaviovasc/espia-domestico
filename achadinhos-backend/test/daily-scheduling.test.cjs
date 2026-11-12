const test = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://dailyqa:dailyqa-local-only@127.0.0.1:55439/dailyqa'
process.env.JWT_SECRET ??= 'scheduling-test-secret-at-least-thirty-two-characters'
const { buildDailySmartSchedule } = require('../dist/services/SmartCampaignService')
const { reconcileDailyApproval } = require('../dist/services/dailyApprovalReconciliation')
const date = '2026-11-09'
const policy = { dailyCap: 30, startTime: '08:00', endTime: '19:00', minGapSeconds: 1200,
  maxGapSeconds: 1500, timezone: 'America/Sao_Paulo', spreadAcrossWindow: true, windowEndBufferSeconds: 120 }

test('daily schedules fit unequal audiences, late windows and fixed-gap policies without account collisions', () => {
  for (const min of [1200, 1440, 1500]) {
    for (const firstCount of [1, 5, 28, 30]) {
      for (const secondCount of [1, 6, 29, 30]) {
        for (const time of ['10:00', '12:26', '21:45', '21:58', '22:00']) {
          const p = { ...policy, minGapSeconds: min }
          const earliest = new Date(`${date}T${time}:17Z`)
          const first = buildDailySmartSchedule(date, firstCount, p, 'a', earliest, [], 1)
          const second = buildDailySmartSchedule(date, secondCount, p, 'b', earliest, first)
          assert.deepEqual(first, buildDailySmartSchedule(date, firstCount, p, 'a', earliest, [], 1))
          for (const slots of [first, second]) {
            assert.ok(slots.every(slot => slot >= earliest && slot <= new Date(`${date}T21:58:00Z`)))
            for (let i = 1; i < slots.length; i++) {
              const gap = (slots[i] - slots[i - 1]) / 1000
              assert.ok(gap >= min && gap <= p.maxGapSeconds, `${time}: ${gap}`)
            }
          }
          const all = [...first, ...second].sort((a, b) => a - b)
          for (let i = 1; i < all.length; i++) assert.ok(all[i] - all[i - 1] >= 60000)
        }
      }
    }
  }
})

test('reconciliation retains schedule overflow as reserves without assigning undefined slots', async () => {
  const items = Array.from({ length: 3 }, (_, index) => ({ id: String(index), state: 'SELECTED', score: 90 - index,
    product: { discountedPrice: 100 }, warnings: [] }))
  const retained = await reconcileDailyApproval({ items, capacity: 3, invalid: () => false, conflict: () => false,
    repeatsReady: false, aliases: item => [item.id], occupied: new Set(),
    schedule: count => Array.from({ length: Math.min(count, 2) }, (_, index) => new Date(`${date}T12:${index}0:00Z`)),
    fresh: (_item, slot) => { assert.ok(slot instanceof Date); return true }, maxStandouts: 0 })
  assert.equal(retained.length, 2)
  assert.equal(items.filter(item => item.state === 'RESERVE').length, 1)
  assert.ok(items.find(item => item.state === 'RESERVE').warnings.includes('DAILY_ITEM_CAPACITY'))
})
