const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://dailyqa:dailyqa-local-only@127.0.0.1:55462/dailyqa'
process.env.JWT_SECRET ??= 'daily-observability-local-secret-at-least-32-characters'
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(new URL(process.env.DATABASE_URL).hostname))
const { sequelize } = require('../dist/database')
const { User } = require('../dist/database/models/User')
const { SmartPlan } = require('../dist/database/models/SmartPlan')
const { SmartSend } = require('../dist/database/models/SmartSend')
const { registerAssociations } = require('../dist/database/models')
const { SmartCampaignSender } = require('../dist/services/SmartCampaignSender')
const { logger } = require('../dist/utils/logger')
registerAssociations()
after(() => sequelize.close())

test('committed send outcomes and daily completion summary are safe and emitted once', async (t) => {
  const logs = []
  t.mock.method(logger, 'info', (data, message) => logs.push({ data, message }))
  const user = await User.create({ name: 'Observability QA', email: `${randomUUID()}@observability.invalid`, passwordHash: 'unused' })
  try {
    const plan = await SmartPlan.create({ userId: user.id, status: 'SCHEDULED', startDate: '2026-11-12', days: 1,
      timezone: 'America/Sao_Paulo', audienceSlugs: ['domestica', 'masculino'], input: {}, settings: { dailyAutomation: {} } })
    const sender = new SmartCampaignSender({}, {}, {})
    const sends = []
    for (const [audienceSlug, status, lastError] of [
      ['domestica', 'SENT', null], ['domestica', 'SKIPPED', 'O intervalo seguro ultrapassa a janela diária.'],
      ['masculino', 'SENT', null],
    ]) sends.push(await SmartSend.create({ userId: user.id, planId: plan.id, audienceSlug,
      groupId: 'fixture-destination', groupName: 'PRIVATE', connectionScope: 'fixture', offerIdentity: randomUUID(),
      offer: { affiliateUrl: 'https://private.invalid' }, scheduledAt: new Date('2026-11-12T13:00:00Z'),
      localDate: '2026-11-12', timezone: 'America/Sao_Paulo', evidenceObservedAt: new Date(), status, lastError }))
    // A stale process return must not turn a committed SKIPPED row into a SENT log.
    await sender.logSendOutcome({ send: sends[1], plan }, 'sent')
    assert.equal(logs[0].data.outcome, 'skipped')
    assert.equal(logs[0].data.reasonCode, 'GAP_EXCEEDS_WINDOW')
    assert.equal(logs[0].data.planUuid, plan.uuid)
    assert.equal(logs[0].data.slot, '2026-11-12T13:00:00.000Z')
    assert.equal(logs[0].data.audience, 'domestica')
    await sender.logSendOutcome({ send: sends[0], plan }, 'sent')
    assert.equal(logs[1].data.outcome, 'sent')
    assert.equal(logs[1].data.reasonCode, 'PROVIDER_CONFIRMED')
    const rescheduled = sends[2]
    const originalSlot = rescheduled.scheduledAt.toISOString()
    const nextSlot = new Date(rescheduled.scheduledAt.getTime() + 60_000)
    await SmartSend.update({ status: 'PENDING', scheduledAt: nextSlot, lastError: 'Intervalo de segurança compartilhado ainda ativo.' }, { where: { id: rescheduled.id } })
    await sender.logSendOutcome({ send: rescheduled, plan }, 'rescheduled')
    assert.equal(logs[2].data.outcome, 'rescheduled')
    assert.equal(logs[2].data.reasonCode, 'SHARED_CADENCE')
    assert.equal(logs[2].data.slot, originalSlot)
    assert.equal(logs[2].data.nextSlot, nextSlot.toISOString())
    await SmartSend.update({ status: 'SENT' }, { where: { id: rescheduled.id } })
    await sender.completePlans(new Set([plan.id]))
    await new SmartCampaignSender({}, {}, {}).completePlans(new Set([plan.id]))
    const summaries = logs.filter(log => log.message === 'Daily delivery summary')
    assert.equal(summaries.length, 1)
    assert.deepEqual(summaries[0].data.audiences, {
      domestica: { sent: 1, skipped: 1, failed: 0 }, masculino: { sent: 1, skipped: 0, failed: 0 },
    })
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|private.invalid|fixture-destination|affiliateUrl|lastError/)
  } finally { await user.destroy() }
})

test('expired leases and exhausted attempts each log one committed recovery outcome', async (t) => {
  const logs = []
  t.mock.method(logger, 'info', (data, message) => logs.push({ data, message }))
  const user = await User.create({ name: 'Observability QA', email: `${randomUUID()}@observability.invalid`, passwordHash: 'unused' })
  try {
    const plan = await SmartPlan.create({ userId: user.id, status: 'SCHEDULED', startDate: '2026-11-12', days: 1,
      timezone: 'America/Sao_Paulo', audienceSlugs: ['domestica', 'masculino'], input: {}, settings: { dailyAutomation: {} } })
    for (const [audienceSlug, status, attempts] of [['domestica', 'SENDING', 1], ['masculino', 'PENDING', 3]]) {
      await SmartSend.create({ userId: user.id, planId: plan.id, audienceSlug, groupId: 'fixture-destination', groupName: 'PRIVATE',
        connectionScope: 'fixture', offerIdentity: randomUUID(), offer: {}, scheduledAt: new Date('2026-11-12T13:00:00Z'),
        localDate: '2026-11-12', timezone: 'America/Sao_Paulo', evidenceObservedAt: new Date(), status, attempts, maxAttempts: 3,
        leaseOwner: 'fixture', leaseExpiresAt: new Date(Date.now() - 60_000) })
    }
    const sender = new SmartCampaignSender({}, {}, {})
    await sender.recoverExpiredSending(new Date())
    await sender.recoverExpiredSending(new Date())
    assert.deepEqual(logs.map(log => log.data.outcome).sort(), ['failed', 'unknown'])
    assert.deepEqual(logs.map(log => log.data.reasonCode).sort(), ['ATTEMPTS_EXHAUSTED', 'LEASE_EXPIRED_AFTER_PROVIDER'])
    await plan.reload()
    assert.equal(plan.status, 'PAUSED')
    await sender.completePlans(new Set([plan.id]))
    assert.equal(logs.filter(log => log.message === 'Daily delivery summary').length, 0)
  } finally { await user.destroy() }
})
