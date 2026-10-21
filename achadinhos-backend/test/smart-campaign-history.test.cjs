const test = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')

// Unit tests never connect. The optional SQL test uses only its explicit local URL.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'
process.env.JWT_SECRET ??= 'smart-history-unit-test-secret-at-least-32-characters'

const { SmartPlanHistoryQuerySchema, listSmartPlanHistory } = require('../dist/services/smartCampaignHistory.js')
const { SmartCampaignService } = require('../dist/services/SmartCampaignService.js')
const { SmartCampaignController } = require('../dist/controllers/SmartCampaignController.js')
const { SmartPlan } = require('../dist/database/models/SmartPlan.js')
const { sequelize } = require('../dist/database/index.js')

test('history is opt-in and query values are strict, bounded and calendar-valid', () => {
  assert.equal(SmartPlanHistoryQuerySchema.parse({}), undefined)
  assert.equal(SmartPlanHistoryQuerySchema.parse({ summary: 'false' }), undefined)
  assert.deepEqual(SmartPlanHistoryQuerySchema.parse({ summary: 'true' }), {
    summary: true, page: 1, pageSize: 20, status: undefined, dateFrom: undefined, dateTo: undefined,
  })
  for (const invalid of [
    { summary: '1' }, { summary: ['true'] }, { summary: { value: 'true' } },
    { page: '1' }, { summary: 'false', status: 'PAUSED' },
    { summary: 'true', page: '0' }, { summary: 'true', page: '1.5' },
    { summary: 'true', page: '1e3' }, { summary: 'true', page: ['1', '2'] },
    { summary: 'true', page: '9007199254740991', pageSize: '100' },
    { summary: 'true', pageSize: '101' }, { summary: 'true', pageSize: '-1' },
    { summary: 'true', status: 'active' }, { summary: 'true', status: "SCHEDULED' OR true--" },
    { summary: 'true', dateFrom: '2026-02-29' }, { summary: 'true', dateTo: '2026-02-30' },
    { summary: 'true', dateFrom: '2026-10-02', dateTo: '2026-10-01' },
  ]) assert.equal(SmartPlanHistoryQuerySchema.safeParse(invalid).success, false, JSON.stringify(invalid))
  assert.equal(SmartPlanHistoryQuerySchema.safeParse({
    summary: 'true', pageSize: '100', status: 'PAUSED', dateFrom: '2024-02-29', dateTo: '2024-02-29',
  }).success, true)
})

test('no-query service keeps latest-100 serialization and controller envelope', async (t) => {
  const plan = {
    uuid: 'legacy-id', input: { offers: [{}], totalSeen: 1, errors: [], duplicateCount: 0, source: 'json' },
    items: [{ offer: { title: 'kept' } }], settings: { retained: true }, startDate: '2026-10-01',
  }
  const find = t.mock.method(SmartPlan, 'findAll', async () => [plan])
  t.mock.method(sequelize, 'query', async () => assert.fail('legacy must not run history SQL'))
  const service = Object.create(SmartCampaignService.prototype)
  const controller = new SmartCampaignController(service)
  let body
  await controller.listPlans({ user: { userId: 7 }, query: {} }, { json: (value) => { body = value } })
  assert.deepEqual(find.mock.calls[0].arguments, [{ where: { userId: 7 }, order: [['createdAt', 'DESC']], limit: 100 }])
  assert.equal(body.success, true)
  assert.ok(Array.isArray(body.data))
  assert.equal(body.data[0].id, 'legacy-id')
  assert.deepEqual(body.data[0].items, plan.items)
  assert.deepEqual(body.data[0].settings, plan.settings)
  assert.equal(body.data[0].inputSummary.imported, 1)
})

test('summary controller forwards normalized query and rejects invalid query before service', async () => {
  const calls = []
  const service = { listPlans: async (...args) => { calls.push(args); return { plans: [], total: 0 } } }
  const controller = new SmartCampaignController(service)
  let body
  await controller.listPlans({ user: { userId: 9 }, query: { summary: 'true', page: '6', status: 'SCHEDULED' } }, {
    json: (value) => { body = value },
  })
  assert.equal(calls[0][0], 9)
  assert.equal(calls[0][1].page, 6)
  assert.equal(calls[0][1].status, 'SCHEDULED')
  assert.deepEqual(body, { success: true, data: { plans: [], total: 0 } })
  await assert.rejects(() => controller.listPlans({ user: { userId: 9 }, query: { summary: 'true', pageSize: '101' } }, {}))
  await assert.rejects(() => controller.listPlans({ query: {} }, {}), /Não autenticado/)
  assert.equal(calls.length, 1)
})

test('summary service uses one tenant-scoped aggregate query and returns empty page metadata', async (t) => {
  t.mock.method(SmartPlan, 'findAll', async () => assert.fail('summary must not load full models'))
  const sql = t.mock.method(sequelize, 'query', async () => [{ total: '125', uuid: null }])
  const query = SmartPlanHistoryQuerySchema.parse({
    summary: 'true', page: '8', pageSize: '20', status: 'PAUSED', dateFrom: '2026-10-01', dateTo: '2026-10-31',
  })
  const result = await Object.create(SmartCampaignService.prototype).listPlans(7, query)
  assert.deepEqual(result, { plans: [], page: 8, pageSize: 20, total: 125, hasMore: false })
  assert.equal(sql.mock.calls.length, 1)
  const [statement, options] = sql.mock.calls[0].arguments
  assert.match(statement, /JOIN page ON page.plan_id = s.plan_id/)
  assert.match(statement, /s.user_id = :userId/)
  assert.doesNotMatch(statement, /p\.input|p\.settings|s\.offer|SELECT \*/i)
  assert.deepEqual(options.replacements, { userId: 7, status: 'PAUSED', dateFrom: '2026-10-01', dateTo: '2026-10-31', limit: 20, offset: 140 })
})

test('history PostgreSQL: older active plans, tie ordering, date/status/tenant filters and exact counts', {
  skip: !process.env.SMART_HISTORY_TEST_DATABASE_URL,
}, async () => {
  const connection = new URL(process.env.SMART_HISTORY_TEST_DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname), 'Requires disposable local PostgreSQL')
  const { Sequelize } = require('sequelize')
  const database = new Sequelize(connection.toString(), { logging: false })
  const transaction = await database.transaction()
  const execute = (sql, options = {}) => database.query(sql, { ...options, transaction })
  try {
    // Temporary tables shadow real names on this connection; rollback drops all fixtures.
    await execute(`CREATE TEMP TABLE smart_plans (
      id integer, uuid text, user_id integer, status text, revision integer DEFAULT 1,
      start_date date, days integer DEFAULT 1, timezone text DEFAULT 'America/Sao_Paulo',
      audience_slugs jsonb DEFAULT '["pet"]', items jsonb DEFAULT '[{},{}]',
      approved_at timestamptz, completed_at timestamptz, created_at timestamptz, updated_at timestamptz
    ) ON COMMIT DROP`)
    await execute(`CREATE TEMP TABLE smart_sends (plan_id integer, user_id integer, status text) ON COMMIT DROP`)
    await execute(`INSERT INTO smart_plans (id, uuid, user_id, status, start_date, created_at, updated_at)
      SELECT i, 'plan-' || i, 7, CASE WHEN i = 1 THEN 'SCHEDULED' ELSE 'COMPLETED' END,
        CASE WHEN i = 1 THEN DATE '2026-10-01' ELSE DATE '2026-10-02' END,
        '2026-10-01 12:00:00Z'::timestamptz, '2026-10-01 12:00:00Z'::timestamptz
      FROM generate_series(1, 125) i`)
    await execute(`INSERT INTO smart_plans (id, uuid, user_id, status, start_date, created_at, updated_at)
      VALUES (126, 'other-user', 8, 'SCHEDULED', '2026-10-01', now(), now())`)
    await execute(`INSERT INTO smart_sends VALUES (1,7,'PENDING'), (1,7,'SENDING'), (1,7,'SENT'),
      (1,7,'SENT'), (1,7,'SKIPPED'), (1,7,'FAILED'), (1,7,'UNKNOWN'), (1,8,'SENT'), (126,8,'SENT')`)
    const history = (query, userId = 7) => listSmartPlanHistory({ query: execute }, userId,
      SmartPlanHistoryQuerySchema.parse({ summary: 'true', ...query }))
    const first = await history({})
    assert.equal(first.total, 125)
    assert.equal(first.plans.length, 20)
    assert.equal(first.plans[0].id, 'plan-125')
    assert.equal(first.hasMore, true)
    assert.deepEqual(first.plans[0].sendSummary, { PENDING: 0, SENDING: 0, SENT: 0, SKIPPED: 0, FAILED: 0, UNKNOWN: 0 })
    const last = await history({ page: '7' })
    assert.equal(last.plans.length, 5)
    assert.equal(last.plans.at(-1).id, 'plan-1')
    assert.equal(last.hasMore, false)
    const active = await history({ status: 'SCHEDULED', dateFrom: '2026-10-01', dateTo: '2026-10-01' })
    assert.equal(active.total, 1)
    assert.equal(active.plans[0].uuid, 'plan-1')
    assert.equal(active.plans[0].startDate, '2026-10-01')
    assert.equal(active.plans[0].itemCount, 2)
    assert.deepEqual(active.plans[0].sendSummary, { PENDING: 1, SENDING: 1, SENT: 2, SKIPPED: 1, FAILED: 1, UNKNOWN: 1 })
    for (const key of ['total', 'plan_id', 'items', 'input', 'settings', 'sends', 'offer']) assert.equal(key in active.plans[0], false)
    assert.deepEqual(await history({ page: '99' }), { plans: [], total: 125, page: 99, pageSize: 20, hasMore: false })
    assert.equal((await history({ dateFrom: '2026-10-02' })).total, 124)
    assert.deepEqual(await history({ status: 'PAUSED' }), { plans: [], total: 0, page: 1, pageSize: 20, hasMore: false })
    assert.equal((await history({}, 8)).total, 1)
    assert.equal((await history({}, 9)).total, 0)
  } finally {
    await transaction.rollback()
    await database.close()
  }
})
