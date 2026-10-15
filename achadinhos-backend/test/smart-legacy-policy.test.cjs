const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'
const { assertLegacySmartPolicy, localClock, destinationLockKey } = require('../dist/services/SmartLegacyPolicy.js')
const { SmartAudience } = require('../dist/database/models/SmartAudience.js')
const { SmartSend } = require('../dist/database/models/SmartSend.js')
const { sequelize } = require('../dist/database/index.js')

const scope = 'test-instance'
const groupId = '100@g.us'
const now = new Date('2026-10-15T15:00:00Z')
const audience = {
  name: 'DOMESTICA', destinations: [{ groupId }],
  policy: { timezone: 'America/Sao_Paulo', startTime: '09:00', endTime: '21:00', dailyCap: 50, minGapSeconds: 720 },
}
function setup(t, { pending = 0, audiences = [audience], total = 0, last = null } = {}) {
  t.mock.method(SmartSend, 'count', async () => pending)
  t.mock.method(SmartAudience, 'findAll', async () => audiences)
  t.mock.method(sequelize, 'query', async () => [{ total, last_send: last }])
}
test('São Paulo local date follows midnight rather than the UTC day', () => {
  assert.deepEqual(localClock(new Date('2026-10-16T02:59:00Z'), 'America/Sao_Paulo'), { date: '2026-10-15', time: '23:59' })
  assert.deepEqual(localClock(new Date('2026-10-16T03:00:00Z'), 'America/Sao_Paulo'), { date: '2026-10-16', time: '00:00' })
  assert.notEqual(destinationLockKey(1, scope, groupId), destinationLockKey(2, scope, groupId))
})
test('manual campaign cannot consume a destination reserved by smart tasks', async t => {
  setup(t, { pending: 1 })
  await assert.rejects(assertLegacySmartPolicy(1, scope, groupId, {}, now), error => error.code === 'SMART_POLICY_BLOCKED')
  assert.equal(sequelize.query.mock.callCount(), 0)
})
test('manual sends respect shared daily cap and cadence for configured destinations', async t => {
  setup(t, { total: 50 })
  await assert.rejects(assertLegacySmartPolicy(1, scope, groupId, {}, now), /Limite diário/)
})
test('recent accepted sends pause manual campaigns instead of creating a burst', async t => {
  setup(t, { total: 3, last: new Date(now.getTime() - 719000) })
  await assert.rejects(assertLegacySmartPolicy(1, scope, groupId, {}, now), /intervalo mínimo/)
})
test('manual campaigns respect closing time and allow a feasible later send', async t => {
  setup(t, { total: 2, last: new Date(now.getTime() - 720000) })
  await assertLegacySmartPolicy(1, scope, groupId, {}, now)
  await assert.rejects(assertLegacySmartPolicy(1, scope, groupId, {}, new Date('2026-10-16T00:00:00Z')), /Fora do horário/)
})
test('unbound destinations preserve their existing manual behavior', async t => {
  setup(t, { audiences: [] })
  await assertLegacySmartPolicy(1, scope, groupId, {}, now)
  assert.equal(sequelize.query.mock.callCount(), 0)
})
