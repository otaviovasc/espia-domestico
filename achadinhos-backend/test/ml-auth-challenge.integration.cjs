const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://authqa:authqa-local-only@127.0.0.1:55439/authqa'
process.env.JWT_SECRET = 'synthetic-auth-integration-secret-at-least-thirty-two'
assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL).hostname))
const { sequelize } = require('../dist/database')
const { User } = require('../dist/database/models/User')
const { GroupMessage } = require('../dist/database/models/GroupMessage')
const { GroupMessageService } = require('../dist/services/GroupMessageService')
const { MlAuthChallengeService, encryptMlCode, decryptMlCode } = require('../dist/services/MlAuthChallengeService')
const { DailyAutomationAlerts } = require('../dist/services/DailyAutomationAlerts')
const group = '120363000000000000@g.us', scope = 'synthetic-auth-scope'
let user, service
before(async () => { user = await User.create({ name: 'Auth QA', email: `${randomUUID()}@auth.invalid`, passwordHash: 'unused' }); service = new MlAuthChallengeService({ requireConnectedCreds: async () => ({}), getConnectionScope: async () => scope }, { requireCurrentGroups: async () => [] }, { enqueueLoginCode: async () => {} }) })
after(async () => { if (user) await User.destroy({ where: { id: user.id } }); await GroupMessage.destroy({ where: { connectionScope: scope } }); await sequelize.close() })
const config = () => ({ userId: user.id, alertGroupId: group, timezone: 'America/Sao_Paulo', collectTime: '19:00', startTime: '08:00', endTime: '19:00', planningDaysAhead: 1 })

test('encrypted code is account/group bound, accepted once, removed before browser submission and never stored as chat', async () => {
  const challenge = await service.begin(config())
  const incoming = { groupId: group, messageId: randomUUID(), sender: '5511999999999@s.whatsapp.net', fromMe: false, text: '123456', timestamp: new Date(), timestampVerified: true }
  assert.equal(await service.acceptIncoming('wrong-connection', incoming), false)
  assert.equal(await service.acceptIncoming(scope, { ...incoming, groupId: '120363999999999999@g.us' }), false)
  assert.equal(await service.acceptIncoming(scope, { ...incoming, timestampVerified: false }), true)
  const chats = new GroupMessageService({}, {}, service)
  assert.equal(await chats.ingestWebhook(scope, { message: { chatid: group, messageid: incoming.messageId, participant: incoming.sender, text: '123456', messageTimestamp: Date.now() } }), 0)
  assert.equal(await GroupMessage.count({ where: { connectionScope: scope } }), 0)
  let [rows] = await sequelize.query('SELECT status,code_ciphertext FROM ml_auth_challenges WHERE id=:id', { replacements: { id: challenge.id } })
  assert.equal(rows[0].status, 'CODE_READY')
  assert.ok(!rows[0].code_ciphertext.includes('123456'))
  assert.throws(() => decryptMlCode(rows[0].code_ciphertext, { ...challenge, groupId: 'wrong' }))
  assert.equal(await service.acceptIncoming(scope, { ...incoming, text: '654321' }), true)
  assert.equal(await service.take({ ...challenge, ownerId: randomUUID() }), null)
  assert.equal(await service.take(challenge), '123456')
  assert.equal(await service.take(challenge), null)
  ;[rows] = await sequelize.query('SELECT code_ciphertext FROM ml_auth_challenges WHERE id=:id', { replacements: { id: challenge.id } })
  assert.equal(rows[0].code_ciphertext, null)
  await service.finish(challenge, true)
  assert.equal(await service.acceptIncoming(scope, incoming), true, 'Late code still omitted from ordinary chat')
})

test('expired and old replies cannot reach a browser; one active request per account', async () => {
  const challenge = await service.begin(config())
  await assert.rejects(service.begin(config()), /ML_AUTH_CHALLENGE_ACTIVE/)
  const message = { groupId: group, messageId: randomUUID(), sender: 'operator', fromMe: false, text: '123456', timestamp: new Date(Date.now()-60_000), timestampVerified: true }
  assert.equal(await service.acceptIncoming(scope, message), true)
  assert.equal(await service.take(challenge), null)
  await sequelize.query("UPDATE ml_auth_challenges SET expires_at=NOW()-INTERVAL '1 second',code_ciphertext=:cipher WHERE id=:id", { replacements: { id: challenge.id, cipher: encryptMlCode('123456', challenge) } })
  assert.equal(await service.take(challenge), null)
  await service.expire()
  const [rows] = await sequelize.query('SELECT status,code_ciphertext FROM ml_auth_challenges WHERE id=:id', { replacements: { id: challenge.id } })
  assert.equal(rows[0].status, 'EXPIRED'); assert.equal(rows[0].code_ciphertext, null)
})

test('an expired or already-answered code request never leaves the operational outbox', async () => {
  const challenge = await service.begin(config())
  let transports = 0
  const alerts = new DailyAutomationAlerts({ requireConnectedCreds: async () => ({}) }, { requireCurrentGroups: async () => [] }, { sendText: async () => { transports++; return { id: 'should-not-send' } } })
  await alerts.enqueueLoginCode(config(), '2026-11-10', challenge.id)
  await sequelize.query("UPDATE ml_auth_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id", { replacements: { id: challenge.id } })
  await alerts.dispatch(config())
  assert.equal(transports, 0, 'Expiry is checked again at the send claim, before periodic cleanup')
  await service.expire()
  const [rows] = await sequelize.query('SELECT status FROM daily_automation_alerts WHERE event_key=:key', { replacements: { key: `ml-auth:${challenge.id}` } })
  assert.equal(rows[0].status, 'EXPIRED')
})
