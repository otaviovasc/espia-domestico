const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const {
  SmartCampaignSender,
  resolveSmartSendPolicy,
} = require('../dist/services/SmartCampaignSender.js')
const { SmartAudience } = require('../dist/database/models/SmartAudience.js')
const { SmartSend } = require('../dist/database/models/SmartSend.js')
const { SmartPlan } = require('../dist/database/models/SmartPlan.js')
const { ProductGroupDelivery } = require('../dist/database/models/ProductGroupDelivery.js')
const { sequelize } = require('../dist/database/index.js')

const now = new Date('2026-10-21T13:00:00Z')
const plan = {
  id: 2,
  timezone: 'America/Sao_Paulo',
  settings: { audiences: { pet: { startTime: '09:00', endTime: '21:00' } } },
}
function send() {
  return {
    id: 1,
    userId: 1,
    audienceSlug: 'pet',
    groupId: 'pet@g.us',
    connectionScope: 'scope',
    localDate: '2026-10-21',
    timezone: 'America/Sao_Paulo',
    evidenceObservedAt: now,
    offer: { title: 'Coleira', discountedPrice: 100, currency: 'BRL', commissionRate: 10 },
  }
}
function sender() {
  return new SmartCampaignSender(
    {},
    {
      requireConnectedContext: async () => ({ scope: 'scope' }),
    },
    { requireCurrentGroups: async () => new Map([['pet@g.us', { id: 'pet@g.us', name: 'PET' }]]) },
    {
      now: () => now,
      ownerId: 'test-owner',
    },
  )
}

test('worker skips newly filtered offers before reserving or contacting a provider', async (t) => {
  for (const policy of [
    { minPrice: 101 },
    { maxPrice: 99 },
    { minCommissionPercent: 11 },
    { minEstimatedCommission: 11 },
    { excludePolitical: true },
  ]) {
    const service = sender()
    const row = send()
    row.offer.title = 'Coleira Bolsonaro'
    t.mock.method(SmartAudience, 'findOne', async () => ({
      enabled: true,
      destinations: [{ groupId: row.groupId }],
      policy,
    }))
    const skips = []
    service.finishWithoutProvider = async (...args) => skips.push(args)
    service.prepareDelivery = async () => assert.fail('filtered offer must not reserve delivery')
    service.callProvider = async () => assert.fail('filtered offer must not call provider')
    assert.equal(await service.processClaim({ send: row, plan }), 'skipped')
    assert.equal(skips[0][1], 'SKIPPED')
    assert.match(skips[0][2], /filtros/)
    t.mock.restoreAll()
  }
})

test('policy changed during preparation is re-read before provider dispatch', async (t) => {
  const service = sender()
  let policy = {}
  t.mock.method(SmartAudience, 'findOne', async () => ({
    enabled: true,
    destinations: [{ groupId: 'pet@g.us' }],
    policy,
  }))
  service.normalizeCatchupDate = async () => {}
  const claim = { id: 10 }
  service.prepareDelivery = async () => {
    policy = { maxPrice: 50 }
    return { kind: 'ready', claim }
  }
  const aborts = []
  service.abortPreparedDelivery = async (...args) => aborts.push(args)
  service.callProvider = async () => assert.fail('new filter must block dispatch')
  assert.equal(await service.processClaim({ send: send(), plan }), 'blocked')
  assert.equal(aborts.length, 1)
  assert.equal(aborts[0][2], claim)
  assert.match(aborts[0][3], /Preço acima/)
})

test('an old early-start override cannot leak into next-day catch-up', async (t) => {
  const execution = new Date('2026-10-22T11:15:00Z') // 08:15 local
  const earlyPlan = {
    ...plan,
    settings: {
      ...plan.settings,
      global: {
        earlyStart: { date: '2026-10-21', time: '08:00' },
      },
    },
  }
  const row = { ...send(), evidenceObservedAt: new Date('2026-10-22T11:00:00Z') }
  assert.equal(resolveSmartSendPolicy(earlyPlan, row, execution).startTime, '09:00')
  const service = new SmartCampaignSender({}, {}, {}, { now: () => execution })
  t.mock.method(SmartAudience, 'findOne', async () => ({
    enabled: true,
    destinations: [{ groupId: row.groupId }],
    policy: {},
  }))
  const reschedules = []
  service.reschedule = async (...args) => reschedules.push(args)
  service.prepareDelivery = async () => assert.fail('08:15 next day is outside the default window')
  assert.equal(await service.processClaim({ send: row, plan: earlyPlan }), 'rescheduled')
  assert.equal(reschedules[0][1].toISOString(), '2026-10-22T12:00:00.000Z')
})

test('end-of-window rescheduling resolves the next date independently', async () => {
  const earlyPlan = {
    ...plan,
    settings: {
      ...plan.settings,
      global: {
        earlyStart: { date: '2026-10-21', time: '08:00' },
      },
    },
  }
  const execution = new Date('2026-10-22T00:00:00Z') // 21:00 local
  const row = { ...send(), evidenceObservedAt: new Date('2026-10-21T15:00:00Z') }
  const service = sender()
  const reschedules = []
  service.reschedule = async (...args) => reschedules.push(args)
  assert.equal(
    await service.enforceWindow(
      row,
      earlyPlan,
      resolveSmartSendPolicy(earlyPlan, row, execution),
      execution,
    ),
    'rescheduled',
  )
  assert.equal(reschedules[0][1].toISOString(), '2026-10-22T12:00:00.000Z')
})

test('blocking transitions acquire advisory locks, send then plan without reverse lock order', async (t) => {
  const events = []
  t.mock.method(sequelize, 'transaction', async (fn) => fn({}))
  t.mock.method(sequelize, 'query', async (_, options) => {
    events.push(options.replacements.key)
    return []
  })
  t.mock.method(SmartSend, 'update', async () => {
    events.push('send')
    return [1]
  })
  t.mock.method(SmartPlan, 'update', async () => {
    events.push('plan')
    return [1]
  })
  t.mock.method(ProductGroupDelivery, 'destroy', async () => {
    events.push('delivery')
    return 1
  })
  const service = sender()
  await service.pauseForBlock(plan, send(), 'test')
  assert.deepEqual(events, [
    'delivery-account:1:scope',
    'delivery-destination:1:scope:pet@g.us',
    'send',
    'plan',
  ])
  events.length = 0
  await service.abortPreparedDelivery(plan, send(), { id: 10, claimToken: 'test' }, 'test')
  assert.deepEqual(events, [
    'delivery-account:1:scope',
    'delivery-destination:1:scope:pet@g.us',
    'send',
    'delivery',
    'plan',
  ])
})

test('cadence and daily-cap rollover use next-day start and freshness, not the early override', async (t) => {
  const earlyPlan = {
    ...plan,
    status: 'SCHEDULED',
    settings: {
      ...plan.settings,
      global: {
        earlyStart: { date: '2026-10-21', time: '08:00' },
      },
    },
  }
  const execution = new Date('2026-10-22T00:00:00Z') // 21:00 local
  const row = { ...send(), status: 'PENDING', evidenceObservedAt: new Date('2026-10-21T15:00:00Z') }
  t.mock.method(sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }))
  t.mock.method(sequelize, 'query', async () => [{ exists: false }])
  t.mock.method(SmartSend, 'findOne', async () => row)
  t.mock.method(SmartPlan, 'findOne', async () => earlyPlan)
  for (const gate of ['cadence', 'dailyCap']) {
    const service = sender()
    service.lastDeliveryAt = async () => ({
      destination: gate === 'cadence' ? execution : null,
      account: null,
    })
    service.dailyDeliveryCount = async () => 50
    const reschedules = []
    service.rescheduleInTransaction = async (...args) => reschedules.push(args)
    assert.equal(
      (
        await service.prepareDelivery(
          row,
          earlyPlan,
          resolveSmartSendPolicy(earlyPlan, row, execution),
          {},
          execution,
        )
      ).kind,
      'rescheduled',
    )
    assert.equal(reschedules[0][1].toISOString(), '2026-10-22T12:00:00.000Z', gate)
  }
  row.evidenceObservedAt = new Date('2026-10-21T11:30:00Z') // expires next day at 08:30 local
  const service = sender()
  service.lastDeliveryAt = async () => ({ destination: null, account: null })
  service.dailyDeliveryCount = async () => 50
  service.rescheduleInTransaction = async () => assert.fail('offer expires before 09:00')
  service.finishInTransaction = async (_, status) => assert.equal(status, 'SKIPPED')
  assert.equal(
    (
      await service.prepareDelivery(
        row,
        earlyPlan,
        resolveSmartSendPolicy(earlyPlan, row, execution),
        {},
        execution,
      )
    ).kind,
    'skipped',
  )
})
