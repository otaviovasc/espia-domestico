const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')

const {
  SmartCampaignSender,
  getSmartLocalParts,
  resolveSmartSendPolicy,
  sanitizeSmartMessageIntro,
  smartLocalDateTime,
} = require('../dist/services/SmartCampaignSender.js')
const { SmartSend, SMART_SEND_STATUS } = require('../dist/database/models/SmartSend.js')
const { SmartPlan, SMART_PLAN_STATUS } = require('../dist/database/models/SmartPlan.js')
const { SmartAudience } = require('../dist/database/models/SmartAudience.js')
const {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} = require('../dist/database/models/ProductGroupDelivery.js')
const { sequelize } = require('../dist/database/index.js')

function fakeService(options = {}) {
  return new SmartCampaignSender(
    options.uazapi ?? {},
    options.connectionService ?? {},
    options.groupService ?? {},
    options.senderOptions,
  )
}

test('smart sender clamps plan policy to the hard delivery envelope', () => {
  const policy = resolveSmartSendPolicy(
    {
      timezone: 'UTC',
      settings: {
        audiences: {
          PET: {
            dailyCap: 500,
            startTime: '06:00',
            endTime: '23:30',
            minGapSeconds: 30,
            maxGapSeconds: 45,
            freshnessHours: 48,
            timezone: 'America/Sao_Paulo',
          },
        },
      },
    },
    { audienceSlug: 'PET', timezone: 'UTC' },
  )
  assert.equal(policy.dailyCap, 50)
  assert.equal(policy.startTime, '09:00')
  assert.equal(policy.endTime, '21:00')
  assert.equal(policy.minGapSeconds, 12 * 60)
  assert.equal(policy.timezone, 'America/Sao_Paulo')
  assert.equal(policy.freshnessHours, 24)
})

test('smart sender timezone conversion preserves the requested local slot', () => {
  const instant = smartLocalDateTime('2026-10-15', '09:00', 'America/Sao_Paulo')
  assert.deepEqual(getSmartLocalParts(instant, 'America/Sao_Paulo'), {
    date: '2026-10-15',
    time: '09:00',
  })
  assert.equal(instant.toISOString(), '2026-10-15T12:00:00.000Z')
})

test('standout intro strips links, placeholders and unsafe control bytes', () => {
  const result = sanitizeSmartMessageIntro(
    '  ⭐ Oferta rara {url}\u0000\nVeja https://example.invalid/x agora\nLinha 3\nLinha 4  ',
  )
  assert.equal(result, '⭐ Oferta rara url\nVeja  agora\nLinha 3')
  assert.doesNotMatch(result, /https?:|[{}]/)
})

test('processDue is non-overlapping and accounts for each terminal outcome', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const service = fakeService({ senderOptions: { batchSize: 5 } })
  let claimIndex = 0
  service.recoverExpiredSending = async () => {}
  service.claimNext = async () => {
    claimIndex++
    if (claimIndex === 1) await gate
    if (claimIndex <= 3) return { send: {}, plan: { id: claimIndex } }
    return null
  }
  const outcomes = ['sent', 'unknown', 'rescheduled']
  service.processClaim = async () => outcomes.shift()
  service.completePlans = async () => {}

  const first = service.processDue()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(await service.processDue(), {
    claimed: 0,
    sent: 0,
    unknown: 0,
    skipped: 0,
    rescheduled: 0,
    blocked: 0,
  })
  release()
  assert.deepEqual(await first, {
    claimed: 3,
    sent: 1,
    unknown: 1,
    skipped: 0,
    rescheduled: 1,
    blocked: 0,
  })
})

test('provider uncertainty becomes UNKNOWN and retains the durable delivery claim', async () => {
  const smartUpdates = []
  let deliveryUpdates = 0
  const originalSmartUpdate = SmartSend.update
  const originalDeliveryUpdate = ProductGroupDelivery.update
  SmartSend.update = async (values) => {
    smartUpdates.push(values)
    return [1]
  }
  ProductGroupDelivery.update = async () => {
    deliveryUpdates++
    return [1]
  }
  const service = fakeService({
    uazapi: {
      async sendText() {
        throw new Error('timeout after request submission')
      },
      async sendMedia() {
        throw new Error('unexpected media')
      },
    },
  })
  try {
    const outcome = await service.callProvider(
      {
        id: 7,
        userId: 11,
        messageIntro: 'Oferta especial',
        offer: {
          title: 'Ração premium',
          discountedPrice: 89.9,
          affiliateUrl: 'https://example.invalid/affiliate',
        },
      },
      { id: 2 },
      {
        creds: { baseUrl: 'https://provider.invalid', instanceId: 'x', instanceToken: 'secret' },
        scope: 'test',
      },
      { id: '123@g.us', name: 'PET', size: 10, announceOnly: false },
      { id: 9, claimToken: 'claim-token' },
    )
    assert.equal(outcome, 'unknown')
    assert.equal(smartUpdates.at(-1).status, SMART_SEND_STATUS.UNKNOWN)
    assert.match(smartUpdates.at(-1).lastError, /verifique o WhatsApp/i)
    assert.equal(deliveryUpdates, 0, 'uncertain sends must retain the SENDING ledger barrier')
  } finally {
    SmartSend.update = originalSmartUpdate
    ProductGroupDelivery.update = originalDeliveryUpdate
  }
})

test('provider acceptance fences the task and settles both records as SENT', async () => {
  const smartUpdates = []
  const deliveryUpdates = []
  const originalTransaction = sequelize.transaction
  const originalSmartUpdate = SmartSend.update
  const originalDeliveryUpdate = ProductGroupDelivery.update
  sequelize.transaction = async (callback) => callback({})
  SmartSend.update = async (values) => {
    smartUpdates.push(values)
    return [1]
  }
  ProductGroupDelivery.update = async (values) => {
    deliveryUpdates.push(values)
    return [1]
  }
  const service = fakeService({
    uazapi: {
      async sendText(_credentials, request) {
        assert.equal(request.number, '123@g.us')
        assert.match(request.text, /Ração premium/)
        return { messageid: 'provider-accepted-1', status: 'sent' }
      },
      async sendMedia() {
        throw new Error('unexpected media')
      },
    },
  })
  try {
    const outcome = await service.callProvider(
      {
        id: 8,
        userId: 11,
        messageIntro: null,
        offer: {
          title: 'Ração premium',
          discountedPrice: 89.9,
          affiliateUrl: 'https://example.invalid/affiliate',
        },
      },
      { id: 2 },
      {
        creds: {
          baseUrl: 'https://provider.invalid',
          instanceId: 'x',
          instanceToken: 'secret',
        },
        scope: 'test',
      },
      { id: '123@g.us', name: 'PET', size: 10, announceOnly: false },
      { id: 10, claimToken: 'claim-token' },
    )
    assert.equal(outcome, 'sent')
    assert.equal(smartUpdates.at(-1).status, SMART_SEND_STATUS.SENT)
    assert.equal(smartUpdates.at(-1).providerMessageId, 'provider-accepted-1')
    assert.equal(deliveryUpdates.at(-1).status, PRODUCT_GROUP_DELIVERY_STATUS.SENT)
    assert.equal(deliveryUpdates.at(-1).messageId, 'provider-accepted-1')
  } finally {
    sequelize.transaction = originalTransaction
    SmartSend.update = originalSmartUpdate
    ProductGroupDelivery.update = originalDeliveryUpdate
  }
})

test('an UNKNOWN send pauses its plan for operator attention', async () => {
  const originalQuery = sequelize.query
  const originalFindAll = SmartSend.findAll
  const originalPlanUpdate = SmartPlan.update
  const updates = []
  sequelize.query = async () => []
  SmartSend.findAll = async () => [
    { status: SMART_SEND_STATUS.UNKNOWN, count: '1' },
    { status: SMART_SEND_STATUS.PENDING, count: '4' },
  ]
  SmartPlan.update = async (values, options) => {
    updates.push({ values, options })
    return [1]
  }
  const service = fakeService()
  try {
    await service.completePlans(new Set([42]))
    assert.equal(updates.length, 1)
    assert.equal(updates[0].values.status, SMART_PLAN_STATUS.PAUSED)
    assert.equal(updates[0].values.progress.unknown, 1)
    assert.equal(updates[0].values.progress.pending, 4)
    assert.equal(updates[0].options.where.status, SMART_PLAN_STATUS.SCHEDULED)
  } finally {
    sequelize.query = originalQuery
    SmartSend.findAll = originalFindAll
    SmartPlan.update = originalPlanUpdate
  }
})

test('expired in-flight recovery pauses the plan atomically and blocks its next row', async () => {
  const originalTransaction = sequelize.transaction
  const originalQuery = sequelize.query
  const statements = []
  sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } })
  sequelize.query = async (sql) => {
    statements.push(sql)
    return []
  }
  const service = fakeService()
  try {
    await service.recoverExpiredSending(new Date('2026-10-15T12:00:00.000Z'))
    assert.match(statements[0], /UPDATE smart_sends[\s\S]+status = 'UNKNOWN'/)
    assert.match(statements[0], /UPDATE smart_plans[\s\S]+status = 'PAUSED'/)
    assert.match(statements[1], /status = 'FAILED'/)
    assert.match(statements[1], /UPDATE smart_plans[\s\S]+status = 'PAUSED'/)
    assert.match(statements[2], /attention\.status IN \('UNKNOWN', 'FAILED'\)/)

    statements.length = 0
    assert.equal(await service.claimNext(new Date('2026-10-15T12:00:00.000Z')), null)
    assert.match(statements[0], /NOT EXISTS[\s\S]+uncertain\.status IN \('UNKNOWN', 'FAILED'\)/)
  } finally {
    sequelize.transaction = originalTransaction
    sequelize.query = originalQuery
  }
})

test('a disabled audience defers only its own send without touching the plan', async () => {
  const originalFindOne = SmartAudience.findOne
  SmartAudience.findOne = async () => ({ enabled: false, destinations: [] })
  const reschedules = []
  const service = fakeService()
  service.reschedule = async (...args) => reschedules.push(args)
  const now = new Date('2026-10-15T13:00:00.000Z')
  const send = { userId: 11, audienceSlug: 'PET', localDate: '2026-10-15' }
  try {
    assert.equal(await service.enforceCurrentAudience({ id: 2 }, send, now), 'rescheduled')
    assert.equal(reschedules.length, 1)
    assert.equal(reschedules[0][1].toISOString(), '2026-10-15T13:05:00.000Z')
    assert.match(reschedules[0][3], /desativado/i)
  } finally {
    SmartAudience.findOne = originalFindOne
  }
})

test('a removed audience destination blocks the plan for reapproval', async () => {
  const originalFindOne = SmartAudience.findOne
  SmartAudience.findOne = async () => ({
    enabled: true,
    destinations: [{ groupId: 'other@g.us', groupName: 'Outro' }],
  })
  const blocks = []
  const service = fakeService()
  service.pauseForBlock = async (...args) => blocks.push(args)
  const send = {
    userId: 11,
    audienceSlug: 'PET',
    groupId: 'pet@g.us',
    localDate: '2026-10-15',
  }
  try {
    assert.equal(
      await service.enforceCurrentAudience({ id: 2 }, send, new Date('2026-10-15T13:00:00.000Z')),
      'blocked',
    )
    assert.equal(blocks.length, 1)
    assert.match(blocks[0][2], /não está mais vinculado/i)
  } finally {
    SmartAudience.findOne = originalFindOne
  }
})

test('cross-midnight catch-up moves the reservation to the actual accepted day', async () => {
  const originalUpdate = SmartSend.update
  const updates = []
  SmartSend.update = async (values) => {
    updates.push(values)
    return [1]
  }
  const service = fakeService({ senderOptions: { ownerId: 'test-owner' } })
  const send = {
    id: 9,
    userId: 11,
    localDate: '2026-10-14',
    scheduledAt: new Date('2026-10-14T12:00:00.000Z'),
  }
  try {
    const now = new Date('2026-10-15T13:00:00.000Z')
    await service.normalizeCatchupDate(send, { timezone: 'America/Sao_Paulo' }, now)
    assert.equal(send.localDate, '2026-10-15')
    assert.equal(send.scheduledAt, now)
    assert.equal(updates[0].localDate, '2026-10-15')
    assert.equal(updates[0].scheduledAt, now)
  } finally {
    SmartSend.update = originalUpdate
  }
})

test('daily smart count uses event timestamps for SENT and UNKNOWN rows', async () => {
  const originalQuery = sequelize.query
  let statement = ''
  sequelize.query = async (sql) => {
    statement = sql
    return [{ count: '2' }]
  }
  const service = fakeService()
  try {
    const count = await service.dailyDeliveryCount(
      { userId: 11, connectionScope: 'scope', groupId: 'pet@g.us' },
      { timezone: 'America/Sao_Paulo' },
      new Date('2026-10-15T13:00:00.000Z'),
      {},
    )
    assert.equal(count, 2)
    assert.match(statement, /ss\.status = 'SENDING' AND ss\.local_date = :localDate/)
    assert.match(statement, /ss\.status IN \('SENT', 'UNKNOWN'\)/)
    assert.match(statement, /COALESCE\(ss\.sent_at, ss\.updated_at\) >= :dayStart/)
  } finally {
    sequelize.query = originalQuery
  }
})
