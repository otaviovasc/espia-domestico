const test = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')

const {
  buildSmartSchedule,
  getSmartLocalDate,
  isEvidenceFresh,
  smartUnknownResolutionAvailableAt,
  smartZonedInstant,
  validateAudienceDailyCaps,
} = require('../dist/services/SmartCampaignService.js')

const policy = {
  dailyCap: 50,
  startTime: '09:00',
  endTime: '21:00',
  minGapSeconds: 720,
  maxGapSeconds: 960,
  maxStandouts: 3,
  freshnessHours: 24,
  timezone: 'America/Sao_Paulo',
}

test('smart policies cannot approve a window the worker would refuse', () => {
  const {
    SmartAudiencePolicySchema,
    CreateSmartPlanSchema,
    SmartPlanRetrySchema,
  } = require('../dist/dtos/smartCampaign.js')
  assert.equal(SmartAudiencePolicySchema.safeParse({ ...policy, endTime: '22:00' }).success, false)
  assert.equal(SmartAudiencePolicySchema.safeParse({ ...policy, minGapSeconds: 60 }).success, false)
  assert.equal(
    SmartAudiencePolicySchema.safeParse({ ...policy, freshnessHours: 25 }).success,
    false,
  )
  assert.equal(
    CreateSmartPlanSchema.safeParse({ date: '2026-02-30', audienceSlugs: ['pet'], rawJson: '[]' })
      .success,
    false,
  )
  assert.equal(
    SmartPlanRetrySchema.safeParse({ revision: 1, requestId: 'not-a-uuid' }).success,
    false,
  )
  assert.equal(
    SmartPlanRetrySchema.safeParse({
      revision: 1,
      requestId: 'ad831c6b-f573-4f0e-ad5f-b485562c6d6c',
    }).success,
    true,
  )
  assert.throws(
    () => buildSmartSchedule('2026-10-16', 2, { ...policy, endTime: '09:12' }, 'exclusive-end'),
    /comporta/,
  )
})

test('smart schedule is deterministic, starts at 09:00 and stays within 12–16 minute gaps', () => {
  const first = buildSmartSchedule('2026-10-16', 50, policy, 'stable-plan')
  const second = buildSmartSchedule('2026-10-16', 50, policy, 'stable-plan')

  assert.deepEqual(first, second)
  assert.equal(first[0].toISOString(), '2026-10-16T12:00:00.000Z')
  assert.ok(first.at(-1) <= smartZonedInstant('2026-10-16', '21:00', policy.timezone))
  for (let index = 1; index < first.length; index++) {
    const gap = (first[index].getTime() - first[index - 1].getTime()) / 1000
    assert.ok(gap >= 720, `gap ${index} was below 12 minutes`)
    assert.ok(gap <= 960, `gap ${index} was above 16 minutes`)
  }
})

test('smart schedule rejects a count that cannot fit the requested window', () => {
  assert.throws(
    () =>
      buildSmartSchedule(
        '2026-10-16',
        3,
        { ...policy, startTime: '09:00', endTime: '09:20' },
        'overflow',
      ),
    /comporta 2 envio/,
  )
})

test('daily caps are independent per audience and date', () => {
  const item = (audienceSlug, index, date = '2026-10-16') => ({ audienceSlug, date })
  const schedule = [
    ...Array.from({ length: 50 }, (_, index) => item('domestica', index)),
    ...Array.from({ length: 50 }, (_, index) => item('masculino', index)),
  ]
  assert.doesNotThrow(() => validateAudienceDailyCaps(schedule, policyByAudience))
  assert.throws(
    () => validateAudienceDailyCaps([...schedule, item('masculino', 50)], policyByAudience),
    /masculino excede 50 produtos em 2026-10-16/,
  )
  assert.doesNotThrow(() => validateAudienceDailyCaps([
    ...schedule,
    item('domestica', 50, '2026-10-17'),
  ], policyByAudience))
})

const policyByAudience = { domestica: policy, masculino: policy }

test('freshness requires real evidence and is measured against the send instant', () => {
  const sendAt = new Date('2026-10-16T12:00:00.000Z')
  assert.equal(isEvidenceFresh(null, sendAt, 24), false)
  assert.equal(isEvidenceFresh('2026-10-15T12:00:00.000Z', sendAt, 24), true)
  assert.equal(isEvidenceFresh('2026-10-15T11:59:59.999Z', sendAt, 24), false)
})

test('local date remains São Paulo date around UTC midnight', () => {
  assert.equal(getSmartLocalDate(new Date('2026-10-16T01:30:00.000Z')), '2026-10-15')
})

test('unknown resolution waits five minutes after the latest durable signal', () => {
  const available = smartUnknownResolutionAvailableAt(
    new Date('2026-10-15T12:00:00.000Z'),
    new Date('2026-10-15T12:03:00.000Z'),
    [new Date('2026-10-15T12:02:00.000Z')],
  )
  assert.equal(available.toISOString(), '2026-10-15T12:07:00.000Z')
})
