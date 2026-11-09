const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:55439/unused'
process.env.JWT_SECRET ??= 'daily-test-secret-at-least-thirty-two-characters'
const { DailyAutomationConfigSchema, dailyItemTarget, dailyWindow, dailyMinimumItems, dailyRemainingCapacity } = require('../dist/config/dailyAutomation')
const { dailyRequestId } = require('../dist/services/DailyAutomationService')
const { DailyProductCollector } = require('../dist/services/DailyProductCollector')
const { buildSmartSchedule } = require('../dist/services/SmartCampaignService')
const { SmartCampaignSender, resolveSmartSendPolicy } = require('../dist/services/SmartCampaignSender')

test('daily cadence fills 08:00–19:00 with 30 items per audience and 20–25 minute gaps', () => {
  const config = DailyAutomationConfigSchema.parse({ userId: 1 })
  assert.equal(dailyItemTarget(config), 30)
  const policy = { startTime: config.startTime, endTime: config.endTime, timezone: config.timezone,
    minGapSeconds: 1200, maxGapSeconds: 1500, dailyCap: 30, spreadAcrossWindow: true, windowEndBufferSeconds: 120 }
  const slots = buildSmartSchedule('2026-11-09', dailyItemTarget(config), policy, 'daily')
  assert.equal(slots[0].toISOString(), '2026-11-09T11:00:00.000Z')
  assert.equal(slots.at(-1).toISOString(), '2026-11-09T21:58:00.000Z')
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 1200000 && slots[i] - slots[i - 1] <= 1500000)
  assert.equal(dailyWindow(config, new Date('2026-11-09T10:00:00Z')).due, true)
  assert.equal(dailyWindow(config, new Date('2026-11-09T22:00:00Z')).due, false)
  assert.equal(dailyWindow({ ...config, weekdaysOnly: true }, new Date('2026-11-08T14:00:00Z')).due, false)
  assert.equal(DailyAutomationConfigSchema.safeParse({ userId: 1, minIntervalMinutes: 25, maxIntervalMinutes: 20 }).success, false)
})

test('daily request identity is stable across restarts and changes each local day/user', () => {
  assert.equal(dailyRequestId(1, '2026-11-09'), dailyRequestId(1, '2026-11-09'))
  assert.notEqual(dailyRequestId(1, '2026-11-09'), dailyRequestId(1, '2026-11-10'))
  assert.notEqual(dailyRequestId(1, '2026-11-09'), dailyRequestId(2, '2026-11-09'))
  assert.match(dailyRequestId(1, '2026-11-09'), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/)
})

test('accepted full-window cadence settings select enough items to fit the buffered window', () => {
  const config = DailyAutomationConfigSchema.parse({ userId: 1, minIntervalMinutes: 24, maxIntervalMinutes: 25 })
  assert.equal(dailyMinimumItems(config), 28)
  assert.equal(dailyItemTarget(config), 28)
  const slots = buildSmartSchedule('2026-11-09', dailyItemTarget(config), { startTime: config.startTime, endTime: config.endTime,
    timezone: config.timezone, minGapSeconds: 1440, maxGapSeconds: 1500, dailyCap: 28, spreadAcrossWindow: true, windowEndBufferSeconds: 120 }, '24-25')
  assert.equal(slots.at(-1).toISOString(), '2026-11-09T21:58:00.000Z')
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 1440000 && slots[i] - slots[i - 1] <= 1500000)
  for (const interval of [20, 25]) {
    assert.equal(DailyAutomationConfigSchema.safeParse({ userId: 1, minIntervalMinutes: interval, maxIntervalMinutes: interval }).success, false)
    const partial = DailyAutomationConfigSchema.parse({ userId: 1, minIntervalMinutes: interval, maxIntervalMinutes: interval, requireFullWindow: false })
    assert.ok(dailyItemTarget(partial) <= dailyRemainingCapacity(partial, new Date('2026-11-09T10:00:00Z')))
  }
  for (let min = 20; min <= 25; min++) for (let max = min; max <= 25; max++) {
    const parsed = DailyAutomationConfigSchema.safeParse({ userId: 1, minIntervalMinutes: min, maxIntervalMinutes: max })
    if (!parsed.success) continue
    const candidate = parsed.data
    assert.ok(dailyItemTarget(candidate) >= dailyMinimumItems(candidate))
    const schedule = buildSmartSchedule('2026-11-09', dailyItemTarget(candidate), { startTime: candidate.startTime, endTime: candidate.endTime,
      timezone: candidate.timezone, minGapSeconds: min * 60, maxGapSeconds: max * 60, dailyCap: dailyItemTarget(candidate),
      spreadAcrossWindow: true, windowEndBufferSeconds: 120 }, `${min}-${max}`)
    assert.equal(schedule.at(-1).toISOString(), '2026-11-09T21:58:00.000Z')
    for (let i = 1; i < schedule.length; i++) assert.ok(schedule[i] - schedule[i - 1] >= min * 60000 && schedule[i] - schedule[i - 1] <= max * 60000)
  }
  assert.equal(DailyAutomationConfigSchema.safeParse({ userId: 1, startTime: '18:59', requireFullWindow: false }).success, false)
})

test('daily 08:00 start and 20–25 minute cadence are honored by the existing sender', () => {
  const plan = { timezone: 'America/Sao_Paulo', settings: {
    dailyAutomation: { localDate: '2026-11-09', startTime: '08:00', endTime: '19:00' },
    audiences: { domestica: { startTime: '08:00', endTime: '19:00', minGapSeconds: 1200, maxGapSeconds: 1500 } },
  } }
  const resolved = resolveSmartSendPolicy(plan, { audienceSlug: 'domestica', localDate: '2026-11-09' })
  assert.equal(resolved.startTime, '08:00')
  assert.equal(resolved.minGapSeconds, 1200)
  assert.equal(resolved.maxGapSeconds, 1500)
  plan.settings.global = { earlyStart: { date: '2026-11-09', time: '07:05' }, startNow: true }
  assert.equal(resolveSmartSendPolicy(plan, { audienceSlug: 'domestica', localDate: '2026-11-09' }).startTime, '08:00', 'Manual early start cannot bypass the daily envelope')
  assert.equal(resolveSmartSendPolicy(plan, { audienceSlug: 'domestica', localDate: '2026-11-10' }).startTime, '09:00')
})

test('daily feasibility is checked before expensive work and respects the last full-window start', () => {
  const config = DailyAutomationConfigSchema.parse({ userId: 1 })
  assert.equal(dailyMinimumItems(config), 28)
  assert.equal(dailyRemainingCapacity(config, new Date('2026-11-09T12:58:00Z')), 28)
  assert.equal(dailyRemainingCapacity(config, new Date('2026-11-09T12:59:00Z')), 27)
})

test('an invalid effective daily window stays closed instead of falling back to 09:00–21:00', async () => {
  const plan = { timezone: 'America/Sao_Paulo', settings: {
    dailyAutomation: { localDate: '2026-11-09', startTime: '08:00', endTime: '19:00' },
    global: { earlyStart: { date: '2026-11-09', time: '20:00' } },
    audiences: { domestica: { startTime: '08:00', endTime: '19:00' } },
  } }
  const send = { audienceSlug: 'domestica', localDate: '2026-11-09' }
  const policy = resolveSmartSendPolicy(plan, send)
  assert.equal(policy.endTime, '19:00')
  assert.equal(policy.startTime, policy.endTime, 'No valid sending minute remains')
  const sender = new SmartCampaignSender({}, {}, {})
  sender.finishWithoutProvider = async () => {}
  sender.reschedule = async () => assert.fail('A closed daily window must not be deferred')
  assert.equal(await sender.enforceWindow(send, plan, policy, new Date('2026-11-09T21:00:00Z')), 'skipped')
})

test('daily offers are skipped after 19:00 and on a later day without calling a provider', async () => {
  const sender = new SmartCampaignSender({}, {}, {})
  const results = []
  sender.finishWithoutProvider = async (_send, status) => results.push(status)
  sender.reschedule = async () => assert.fail('Daily offers must not roll into another day')
  const plan = { settings: { dailyAutomation: { localDate: '2026-11-09' } } }
  const policy = { timezone: 'America/Sao_Paulo', startTime: '08:00', endTime: '19:00' }
  for (const time of ['2026-11-09T22:00:00Z', '2026-11-10T12:00:00Z']) {
    assert.equal(await sender.enforceWindow({}, plan, policy, new Date(time)), 'skipped')
  }
  assert.deepEqual(results, ['SKIPPED', 'SKIPPED'])
})

test('missing session stops collection before browser allocation', async () => {
  const original = process.env.DAILY_BROWSER_STATE_PATH
  delete process.env.DAILY_BROWSER_STATE_PATH
  try { await assert.rejects(new DailyProductCollector().collect([], new AbortController().signal), { code: 'AUTH_REQUIRED' }) }
  finally { if (original !== undefined) process.env.DAILY_BROWSER_STATE_PATH = original }
})

test('vendored extension sources match their recorded integrity hashes', () => {
  const root = path.join(__dirname, '../vendor/affiliate-hub')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'provenance.json')))
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), hash)
  }
})
