// Local disposable database only. Build and migrate before running this file.
const { test, after, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://dailyqa:dailyqa-local-only@127.0.0.1:55439/dailyqa'
process.env.JWT_SECRET ??= 'daily-integration-secret-at-least-thirty-two-characters'
const url = new URL(process.env.DATABASE_URL)
assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.port === '55439' && url.pathname === '/dailyqa', 'Dedicated local dailyqa database required')
const { sequelize } = require('../dist/database')
const { User } = require('../dist/database/models/User')
const { DailyAutomationAlerts } = require('../dist/services/DailyAutomationAlerts')
const { DailyAutomationConfigSchema } = require('../dist/config/dailyAutomation')
const users = []
afterEach(async () => { if (users.length) await User.destroy({ where: { id: users.splice(0) } }) })
after(async () => sequelize.close())
async function setup() {
  const user = await User.create({ name: 'Alert QA', email: `${randomUUID()}@alerts.invalid`, passwordHash: 'unused' })
  users.push(user.id)
  const config = DailyAutomationConfigSchema.parse({ userId: user.id, alertGroupId: '123456789012345678@g.us' })
  const calls = []
  const connection = { async requireConnectedCreds() { return {} } }
  const groups = { async requireCurrentGroups() {} }
  const provider = { async sendText(creds, payload) { calls.push(payload); return { messageid: 'accepted-1' } } }
  const service = new DailyAutomationAlerts(connection, groups, provider)
  const rows = () => sequelize.query('SELECT * FROM daily_automation_alerts WHERE user_id=:id ORDER BY created_at', { replacements: { id: user.id }, type: 'SELECT' })
  return { user, config, calls, connection, provider, service, rows }
}
test('concurrent duplicate enqueue and dispatch send once; arbitrary detail is suppressed', async () => {
  const f = await setup()
  await Promise.all(Array.from({ length: 12 }, () => f.service.enqueue(f.config, '2026-11-10', 'run1', 'COLLECTION_AUTH', 'cookie=SECRET https://private.invalid exception SECRET selected=12')))
  assert.equal((await f.rows()).length, 1)
  await Promise.all([f.service.dispatch(f.config), f.service.dispatch(f.config)])
  assert.equal(f.calls.length, 1)
  assert.doesNotMatch(f.calls[0].text, /SECRET|private.invalid|cookie|exception/)
  assert.match(f.calls[0].text, /selected=12/)
  assert.equal((await f.rows())[0].status, 'SENT')
})
test('pre-provider failure backs off; unknown response and crash never replay', async () => {
  const f = await setup()
  await f.service.enqueue(f.config, '2026-11-10', 'retry', 'COLLECTION_FAILED')
  f.connection.requireConnectedCreds = async () => { throw Error('SECRET') }
  await f.service.dispatch(f.config)
  let row = (await f.rows())[0]
  assert.equal(row.status, 'PENDING'); assert.equal(row.preflight_attempts, 1)
  assert.ok(new Date(row.next_attempt_at) > new Date())
  assert.equal(f.calls.length, 0)
  await sequelize.query('UPDATE daily_automation_alerts SET next_attempt_at=NOW() WHERE user_id=:id', { replacements: { id: f.user.id } })
  f.connection.requireConnectedCreds = async () => ({})
  f.provider.sendText = async () => { f.calls.push('unknown'); return {} }
  await f.service.dispatch(f.config)
  assert.equal((await f.rows())[0].status, 'UNKNOWN')
  await f.service.dispatch(f.config); assert.equal(f.calls.length, 1)
  await f.service.enqueue(f.config, '2026-11-10', 'crash', 'COLLECTION_FAILED')
  await sequelize.query("UPDATE daily_automation_alerts SET status='SENDING',updated_at=NOW()-INTERVAL '6 minutes' WHERE user_id=:id AND status='PENDING'", { replacements: { id: f.user.id } })
  await f.service.dispatch(f.config)
  assert.ok((await f.rows()).every(r => r.status === 'UNKNOWN'))
  assert.equal(f.calls.length, 1)
})
test('current-day sender issues alert separately and readiness gives counts and deadline', async () => {
  const f = await setup()
  const { SmartPlan } = require('../dist/database/models/SmartPlan')
  const plan = await SmartPlan.create({ userId: f.user.id, status: 'PAUSED', startDate: '2026-11-10', days: 1,
    timezone: 'America/Sao_Paulo', audienceSlugs: ['domestica', 'masculino'], input: {}, settings: { dailyAutomation: {} }, items: [] })
  const { SmartSend } = require('../dist/database/models/SmartSend')
  for (const status of ['UNKNOWN', 'FAILED', 'SKIPPED']) {
    await SmartSend.create({ userId: f.user.id, planId: plan.id, audienceSlug: 'domestica', groupId: '123@g.us',
      groupName: 'QA', connectionScope: 'qa', offerIdentity: randomUUID(), offer: {},
      scheduledAt: new Date('2026-11-10T11:00:00Z'), localDate: '2026-11-10', timezone: 'America/Sao_Paulo',
      evidenceObservedAt: new Date(), status, lastError: 'cookie=SECRET https://private.invalid' })
  }
  await f.service.monitor(f.config, new Date('2026-11-10T10:30:00Z'))
  await f.service.monitor(f.config, new Date('2026-11-10T10:31:00Z'))
  const rows = await f.rows()
  assert.equal(rows.length, 5)
  assert.ok(rows.some(r => r.body.includes('PLAN_PAUSED') && r.body.includes(plan.uuid)))
  for (const code of ['SEND_UNKNOWN', 'SEND_FAILED', 'DELIVERY_GAPS']) assert.ok(rows.some(r => r.body.includes(code)))
  assert.ok(rows.every(r => !/SECRET|private.invalid/.test(r.body)))
  const readiness = rows.find(r => r.body.includes('PRE_SEND_PLAN_INCOMPLETE'))
  assert.match(readiness.body, /selected=0 required=\d+ missing=\d+/)
  assert.match(readiness.body, /deadline=2026-11-10T08:00:00-03:00/)
  assert.equal(f.calls.length, 0, 'monitoring persists only; scheduler separately dispatches')
})
