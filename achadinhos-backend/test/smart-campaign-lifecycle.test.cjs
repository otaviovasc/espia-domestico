const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { SmartCampaignService } = require('../dist/services/SmartCampaignService.js')
const { SmartAudiencePolicySchema } = require('../dist/dtos/smartCampaign.js')
const { SmartAudience } = require('../dist/database/models/SmartAudience.js')
const { SmartSend } = require('../dist/database/models/SmartSend.js')
const { sequelize } = require('../dist/database/index.js')

function lifecycle(t, status = 'PAUSED') {
  const events = []
  const row = {
    id: 1, userId: 1, planId: 2, status: 'PENDING',
    audienceSlug: 'pet', groupId: 'pet@g.us', connectionScope: 'original',
  }
  const plan = { id: 2, uuid: 'plan', userId: 1, status, revision: 4,
    save: async () => events.push('save-plan') }
  const state = {
    scope: 'original', scopeReads: 0, groupReads: 0,
    audience: { slug: 'pet', enabled: true, destinations: [{ groupId: row.groupId }] },
    currentGroups: new Map([[row.groupId, { id: row.groupId }]]),
  }
  const service = new SmartCampaignService({}, {}, {}, {
    requireCurrentGroups: async (_userId, ids) => {
      state.groupReads++
      assert.deepEqual(ids, [row.groupId])
      return state.currentGroups
    },
  }, {
    getConnectionScope: async () => { state.scopeReads++; return state.scope },
  })
  service.requirePlan = async (_userId, _uuid, transaction) => {
    if (transaction) events.push('lock-plan')
    return plan
  }
  service.getPlan = async () => plan
  t.mock.method(sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }))
  t.mock.method(sequelize, 'query', async (_sql, options) => {
    if (options.replacements?.key) events.push(options.replacements.key)
    return []
  })
  t.mock.method(SmartSend, 'findAll', async (options) => {
    if (options.lock) events.push('lock-sends')
    return [row]
  })
  t.mock.method(SmartSend, 'count', async () => ['FAILED', 'UNKNOWN', 'SENDING'].includes(row.status) ? 1 : 0)
  t.mock.method(SmartAudience, 'findAll', async () => [state.audience])
  return { service, events, plan, row, state }
}

test('cancel locks original delivery scopes, sends, then plan even when disconnected', async (t) => {
  const { service, events, plan, row, state } = lifecycle(t, 'SCHEDULED')
  state.scope = null
  t.mock.method(SmartSend, 'update', async (_values, options) => {
    assert.equal(options.where.status, 'PENDING')
    events.push('update-sends')
    return [1]
  })
  await service.cancel(1, 'plan', 4)
  assert.deepEqual(events.slice(0, 4), [
    'delivery-account:1:original',
    `delivery-destination:1:original:${row.groupId}`,
    'lock-sends', 'lock-plan',
  ])
  assert.equal(plan.status, 'CANCELLED')
  assert.equal(plan.revision, 5)
  const updates = events.filter((event) => event === 'update-sends').length
  await service.cancel(1, 'plan', 4)
  assert.equal(plan.revision, 5, 'retry does not mutate the cancelled plan')
  assert.equal(events.filter((event) => event === 'update-sends').length, updates)
})

test('resume rejects changed or absent original scope without changing the plan', async (t) => {
  const { service, plan, state } = lifecycle(t)
  for (const scope of ['replacement', null]) {
    state.scope = scope
    await assert.rejects(service.resume(1, 'plan', 4), /conexão original/i)
    assert.equal(plan.status, 'PAUSED')
    assert.equal(plan.revision, 4)
  }
  assert.ok(state.scopeReads > 0)
})

test('resume requires original audience bindings and current group membership', async (t) => {
  const { service, plan, row, state } = lifecycle(t)
  state.audience.destinations = [{ groupId: 'replacement@g.us' }]
  await assert.rejects(service.resume(1, 'plan', 4), /vínculo original/i)
  state.audience.destinations = [{ groupId: row.groupId }]
  state.currentGroups = new Map()
  await assert.rejects(service.resume(1, 'plan', 4), /grupo.*original/i)
  assert.equal(plan.status, 'PAUSED')
  assert.equal(plan.revision, 4)
  state.currentGroups.set(row.groupId, { id: row.groupId })
  const resumed = await service.resume(1, 'plan', 4)
  assert.equal(resumed.status, 'SCHEDULED')
  assert.equal(resumed.revision, 5)
  assert.equal(row.groupId, 'pet@g.us')
  assert.equal(row.connectionScope, 'original', 'resume never rebinds an existing send')
  assert.ok(state.scopeReads >= 2)
  assert.ok(state.groupReads >= 2)
})

test('resume cannot clear uncertain/in-flight sends or a disabled audience', async (t) => {
  const { service, plan, row, state } = lifecycle(t)
  for (const status of ['FAILED', 'UNKNOWN', 'SENDING']) {
    row.status = status
    await assert.rejects(service.resume(1, 'plan', 4), /incertos|andamento/i)
    assert.equal(plan.status, 'PAUSED')
  }
  row.status = 'PENDING'
  state.audience.enabled = false
  await assert.rejects(service.resume(1, 'plan', 4), /público.*ativo/i)
  assert.equal(plan.revision, 4)
})

test('initial startNow uses today actual slots for freshness without changing future windows', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T10:00:25Z') })
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const policy = SmartAudiencePolicySchema.parse({ maxStandouts: 0 })
  const product = {
    title: 'Coleira para gatos', discountedPrice: 100, currency: 'BRL', commissionRate: 10,
    affiliateUrl: 'https://example.invalid/product', commissioned: true,
    commissionedUrlStatus: 'generated_from_page_state',
  }
  const analyses = { 0: { fits: [{ slug: 'pet', score: 95, seasonalScore: 50,
    reason: 'Adequado', category: 'pet' }], warnings: [] } }
  const build = (startNow, date, observedAt) => service.buildItems(
    { uuid: 'initial-start', startDate: date, days: 1,
      settings: { audiences: { pet: policy }, global: { startNow } } },
    [product], [observedAt], analyses, [{ slug: 'pet', policy }], 'worker',
  )
  const observed = '2026-10-20T11:00:00Z' // Yesterday 08:00, still fresh at 07:00 today.
  const [immediate] = await build(true, '2026-10-21', observed)
  assert.equal(immediate.state, 'SELECTED')
  assert.equal(immediate.scheduledAt, '2026-10-21T10:01:00.000Z')
  const [configured] = await build(false, '2026-10-21', observed)
  assert.equal(configured.state, 'REJECTED')
  const [future] = await build(true, '2026-10-22', '2026-10-22T11:00:00Z')
  assert.equal(future.state, 'SELECTED')
  assert.equal(future.scheduledAt, '2026-10-22T12:00:00.000Z')
})
