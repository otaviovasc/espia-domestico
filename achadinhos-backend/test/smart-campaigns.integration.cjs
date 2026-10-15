/*
 * Opt-in database coverage for the smart campaign workflow.
 *
 * This file deliberately ends in `.integration.cjs`: the normal unit test glob
 * does not run it. Run it against a disposable local Postgres after migrations:
 *   DATABASE_URL=postgresql://smartqa:smartqa-local-test@127.0.0.1:55433/smartqa \
 *     node --test test/smart-campaigns.integration.cjs
 */
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('reflect-metadata')

process.env.DATABASE_URL ??= 'postgresql://smartqa:smartqa-local-test@127.0.0.1:55433/smartqa'
process.env.JWT_SECRET ??= 'smart-campaign-integration-test-secret-32-chars'

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { SmartAudience } = require('../dist/database/models/SmartAudience.js')
const { SmartPlan, SMART_PLAN_STATUS } = require('../dist/database/models/SmartPlan.js')
const { SmartSend, SMART_SEND_STATUS } = require('../dist/database/models/SmartSend.js')
const {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} = require('../dist/database/models/ProductGroupDelivery.js')
const { SmartCampaignService } = require('../dist/services/SmartCampaignService.js')
const {
  SmartCampaignSender,
  getSmartLocalParts,
} = require('../dist/services/SmartCampaignSender.js')
const { offerIdentity } = require('../dist/utils/offerIdentity.js')
// Load and activate the central association registry before the service asks
// CampaignLog to include its parent Campaign in daily-budget queries.
const { registerAssociations } = require('../dist/database/models/index.js')
registerAssociations()

const localHostnames = new Set(['localhost', '127.0.0.1', '::1'])
const groupIds = {
  domestica: 'smart-domestica@g.us',
  masculino: 'smart-masculino@g.us',
  natal: 'smart-natal@g.us',
  pesca: 'smart-pesca@g.us',
  pet: 'smart-pet@g.us',
}

// Sequelize keeps its configured idle pool alive after the final assertion;
// close it explicitly so the opt-in runner cannot hang on a disposable DB.
after(async () => {
  await sequelize.close()
})

function assertLocalDatabase() {
  assert.ok(
    localHostnames.has(new URL(env.DATABASE_URL).hostname),
    'Smart campaign integration tests require disposable local Postgres',
  )
}

function localDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return getSmartLocalParts(now, 'America/Sao_Paulo').date
}

function offer(title, index, { observedAt = new Date(), verified = true } = {}) {
  return {
    title,
    originalPrice: 200,
    discountedPrice: 100 + index,
    currency: 'BRL',
    affiliateUrl: `https://meli.la/smart-${index}-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    productId: `MLB-SMART-${index}`,
    source: 'mercadolivre',
    commissioned: verified,
    commissionedUrlStatus: verified ? 'generated_from_page_state' : 'manual_unverified',
    commissionPercent: '15%',
    commissionRate: 15,
    discountPercent: 49,
    extensionEvidence: {
      extractedAt: new Date(observedAt).toISOString(),
      commission: {
        percent: 15,
        priceBrl: 100 + index,
        estimatedBrl: (100 + index) * 0.15,
        basis: 'visible_current_price_times_displayed_percent',
        guaranteed: false,
      },
      searchMatch: {
        keywords: [title],
        matchMode: 'any',
      },
    },
  }
}

function fakeDependencies({ analyses = null, provider = null } = {}) {
  const groups = new Map(
    Object.entries(groupIds).map(([slug, id]) => [
      id,
      {
        id,
        name: slug.toUpperCase(),
        size: 20,
        announceOnly: false,
      },
    ]),
  )
  const saved = []
  const analysisCalls = []
  const fakeImports = {
    parse(raw) {
      const offers = typeof raw === 'string' ? JSON.parse(raw) : raw
      return {
        offers,
        source: 'mercadolivre',
        totalSeen: offers.length,
        errors: [],
        duplicateCount: 0,
      }
    },
  }
  const fakeSavedProducts = {
    async save(userId, offers) {
      saved.push({ userId, offers })
      return offers
    },
  }
  const fakeIntelligence = {
    async analyze(offers, slugs, date, audienceConfigs) {
      analysisCalls.push({ offers, slugs, date, audienceConfigs })
      return offers.map((_, index) => ({
        index,
        fits: slugs.map((slug) => ({
          slug,
          score: slug === 'pet' ? 95 : 82,
          reason: `${slug} é relevante para esta oferta.`,
          category: slug === 'pet' ? 'alimentação' : 'casa',
          seasonalScore: slug === 'natal' ? 90 : 50,
        })),
        warnings: [],
      }))
    },
    async standoutCopy(product, slug) {
      return `Uso real para ${slug}: ${product.title}.`
    },
    ...(analyses
      ? {
          get analyses() {
            return analyses
          },
        }
      : {}),
  }
  const fakeGroups = {
    async requireCurrentGroups(_userId, requestedIds) {
      const selected = new Map()
      for (const id of requestedIds) {
        const group = groups.get(id)
        if (!group) throw new Error(`unknown group ${id}`)
        selected.set(id, group)
      }
      return selected
    },
  }
  const fakeConnections = {
    async getConnectionScope() {
      return 'smart-test-scope'
    },
    async requireConnectedContext() {
      return { scope: 'smart-test-scope', creds: { baseUrl: 'https://uaz.invalid', token: 'test' } }
    },
  }
  const fakeUazapi = provider ?? {
    async sendText() {
      return { id: `provider-${randomUUID()}`, status: 'sent' }
    },
    async sendMedia() {
      return { id: `provider-${randomUUID()}`, status: 'sent' }
    },
  }
  return {
    imports: fakeImports,
    savedProducts: fakeSavedProducts,
    intelligence: fakeIntelligence,
    groups: fakeGroups,
    connections: fakeConnections,
    uazapi: fakeUazapi,
    saved,
    analysisCalls,
  }
}

async function createUser(label) {
  const stamp = randomUUID()
  return User.create({
    name: `Smart integration ${label}`,
    email: `smart-${label}-${stamp}@example.invalid`,
    passwordHash: 'not-used-by-this-test',
    role: USER_ROLE_ENUM.MEMBER,
  })
}

async function configureAudiences(service, userId, slugs = Object.keys(groupIds)) {
  for (const slug of slugs) {
    await service.updateAudience(userId, slug, {
      enabled: true,
      destinations: [{ groupId: groupIds[slug], groupName: slug.toUpperCase() }],
    })
  }
}

test('smart audiences are seeded, editable, and tenant scoped', async () => {
  assertLocalDatabase()
  await sequelize.authenticate()
  const users = await Promise.all([createUser('audience-a'), createUser('audience-b')])
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    const audiences = await service.listAudiences(users[0].id)
    assert.deepEqual(
      audiences.map((item) => item.slug),
      ['domestica', 'masculino', 'natal', 'pesca', 'pet'],
    )
    assert.equal(audiences.find((item) => item.slug === 'natal').active, false)

    const updated = await service.updateAudience(users[0].id, 'pet', {
      enabled: true,
      description: 'Cães e gatos em rotina doméstica.',
      destinations: [{ groupId: groupIds.pet, groupName: 'PET' }],
    })
    assert.equal(updated.destinationGroupIds[0], groupIds.pet)
    await assert.rejects(
      service.updateAudience(users[0].id, 'pet', {
        destinations: [{ groupId: 'forged@g.us', groupName: 'FORGED' }],
      }),
      /unknown group|conexão|grupo/i,
      'an audience cannot bind an unverified destination JID',
    )
    assert.equal(
      (await service.listAudiences(users[1].id)).find((item) => item.slug === 'pet').active,
      false,
    )
    assert.equal(await SmartAudience.count({ where: { userId: users[0].id } }), 5)
    assert.equal(await SmartAudience.count({ where: { userId: users[1].id } }), 5)
  } finally {
    await Promise.all(users.map((user) => user.destroy()))
  }
})

test('mixed import becomes reviewable, supports revision edits, and approval is atomic', async () => {
  assertLocalDatabase()
  await sequelize.authenticate()
  const user = await createUser('review')
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id)
    const date = localDate(new Date().getHours() < 9 ? 0 : 1)
    const good = [
      offer('Fonte automática para gatos', 1),
      offer('Vara de pesca telescópica', 2),
      offer('Pisca pisca natalino', 3),
      offer('Organizador doméstico', 4),
      offer('Aparador masculino', 5),
    ]
    const rejected = offer('Oferta sem atribuição verificada', 6, { verified: false })
    const stale = offer('Oferta antiga', 7, { observedAt: new Date(Date.now() - 48 * 3_600_000) })
    const created = await service.createPlan(user.id, {
      requestId: randomUUID(),
      date,
      days: 1,
      audienceSlugs: ['domestica', 'masculino', 'natal', 'pesca', 'pet'],
      rawJson: [...good, rejected, stale],
    })
    assert.equal(created.status, SMART_PLAN_STATUS.ANALYZING)
    const createdRow = await SmartPlan.findOne({ where: { uuid: created.id, userId: user.id } })
    assert.ok(createdRow)
    assert.equal(await service.processPendingAnalysis(createdRow.id), true)
    const reviewed = await service.getPlan(user.id, created.id)
    assert.equal(reviewed.status, SMART_PLAN_STATUS.REVIEW)
    assert.ok(
      reviewed.items.some((item) => item.state === 'REJECTED' && /atribuição/i.test(item.reason)),
    )
    assert.ok(
      reviewed.items.some(
        (item) => item.state !== 'SELECTED' && /antiga/i.test(item.product.title),
      ),
    )
    const selected = reviewed.items.find((item) => item.state === 'SELECTED')
    assert.ok(selected, 'analysis should produce at least one selected offer')
    const edited = await service.updatePlan(user.id, created.id, {
      revision: reviewed.revision,
      items: [
        { id: selected.id, standout: true, customMessage: 'Oferta especial para uma rotina real.' },
      ],
    })
    assert.equal(edited.revision, reviewed.revision + 1)
    await assert.rejects(
      service.updatePlan(user.id, created.id, {
        revision: reviewed.revision,
        items: [{ id: selected.id, state: 'RESERVE' }],
      }),
    )
    const approved = await service.approve(user.id, created.id, edited.revision)
    assert.equal(approved.status, SMART_PLAN_STATUS.SCHEDULED)
    const sends = await SmartSend.findAll({
      where: {
        userId: user.id,
        planId: (await SmartPlan.findOne({ where: { uuid: created.id } })).id,
      },
    })
    assert.ok(sends.length > 0)
    assert.ok(sends.every((send) => send.status === SMART_SEND_STATUS.PENDING))
    assert.ok(sends.every((send) => send.scheduledAt.getHours() >= 0))
    assert.equal(
      new Set(sends.map((send) => `${send.groupId}:${send.offerIdentity}`)).size,
      sends.length,
    )
    await assert.rejects(service.pause(user.id, created.id), /revisão/i)
    await assert.rejects(service.cancel(user.id, created.id), /revisão/i)
    await assert.rejects(service.retryAnalysis(user.id, created.id), /revisão/i)
    const paused = await service.pause(user.id, created.id, approved.revision)
    assert.equal(paused.status, SMART_PLAN_STATUS.PAUSED)
    const resumed = await service.resume(user.id, created.id, paused.revision)
    assert.equal(resumed.status, SMART_PLAN_STATUS.SCHEDULED)
    const [operationEvents] = await sequelize.query(
      "SELECT action FROM smart_operation_events WHERE user_id=:userId AND action IN ('SMART_PLAN_APPROVED','SMART_PLAN_PAUSED','SMART_PLAN_RESUMED') ORDER BY id",
      { replacements: { userId: user.id } },
    )
    assert.deepEqual(
      operationEvents.map((event) => event.action),
      ['SMART_PLAN_APPROVED', 'SMART_PLAN_PAUSED', 'SMART_PLAN_RESUMED'],
    )

    const foreign = await createUser('review-foreign')
    try {
      await assert.rejects(service.getPlan(foreign.id, created.id), /não encontrado/i)
      await assert.rejects(
        service.approve(foreign.id, created.id, edited.revision),
        /não encontrado/i,
      )
    } finally {
      await foreign.destroy()
    }
  } finally {
    await user.destroy()
  }
})

test('concurrent approvals cannot duplicate reservations or exceed a destination cap', async () => {
  assertLocalDatabase()
  await sequelize.authenticate()
  const user = await createUser('approval-race')
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id, ['pet'])
    const pet = await service.updateAudience(user.id, 'pet', {
      policy: { dailyCap: 1, minGapSeconds: 720, maxGapSeconds: 960 },
    })
    assert.equal(pet.dailyCap, 1)
    const date = localDate(new Date().getHours() < 9 ? 0 : 1)
    const created = await service.createPlan(user.id, {
      requestId: randomUUID(),
      date,
      days: 1,
      audienceSlugs: ['pet'],
      rawJson: [offer('Comedouro pet', 21), offer('Brinquedo pet', 22)],
    })
    const createdRow = await SmartPlan.findOne({ where: { uuid: created.id, userId: user.id } })
    assert.ok(createdRow)
    await service.processPendingAnalysis(createdRow.id)
    const reviewed = await service.getPlan(user.id, created.id)
    const selected = reviewed.items.find((item) => item.state === 'SELECTED')
    assert.ok(selected)
    // Force two products into review selection to exercise the hard cap at approval.
    const second = reviewed.items.find(
      (item) => item.id !== selected.id && item.audienceSlug === 'pet',
    )
    assert.ok(second)
    await service.updatePlan(user.id, created.id, {
      revision: reviewed.revision,
      items: [{ id: second.id, state: 'SELECTED' }],
    })
    const edited = await service.getPlan(user.id, created.id)
    await assert.rejects(
      service.approve(user.id, created.id, edited.revision),
      /excederia|limite|comporta/i,
    )

    // A separate one-item plan exercises the approval race and idempotent retry.
    const single = await service.createPlan(user.id, {
      requestId: randomUUID(),
      date,
      days: 1,
      audienceSlugs: ['pet'],
      rawJson: [offer('Coleira pet', 23)],
    })
    const singleRowBefore = await SmartPlan.findOne({ where: { uuid: single.id, userId: user.id } })
    assert.ok(singleRowBefore)
    await service.processPendingAnalysis(singleRowBefore.id)
    const singleReview = await service.getPlan(user.id, single.id)
    const race = await Promise.allSettled([
      service.approve(user.id, single.id, singleReview.revision),
      service.approve(user.id, single.id, singleReview.revision),
    ])
    assert.ok(race.some((result) => result.status === 'fulfilled'))
    const singleRow = await SmartPlan.findOne({ where: { uuid: single.id, userId: user.id } })
    const count = await SmartSend.count({ where: { planId: singleRow.id } })
    assert.equal(count, 1)
  } finally {
    await user.destroy()
  }
})

test('sender enforces stale evidence, pauses on connection loss, and fences unknown sends after restart', async () => {
  assertLocalDatabase()
  await sequelize.authenticate()
  const user = await createUser('sender')
  try {
    // Keep the fixture inside the delivery window regardless of the wall clock
    // at which this opt-in test happens to be run.
    const now = new Date('2026-10-15T14:00:00-03:00')
    const date = getSmartLocalParts(now, 'America/Sao_Paulo').date
    const settings = {
      audiences: {
        pet: {
          dailyCap: 50,
          startTime: '09:00',
          endTime: '21:00',
          minGapSeconds: 720,
          maxGapSeconds: 960,
          maxStandouts: 3,
          freshnessHours: 24,
          timezone: 'America/Sao_Paulo',
        },
      },
    }
    const planFields = {
      userId: user.id,
      status: SMART_PLAN_STATUS.SCHEDULED,
      startDate: date,
      days: 1,
      timezone: 'America/Sao_Paulo',
      audienceSlugs: ['pet'],
      input: {
        offers: [],
        observedAt: [],
        source: 'test',
        totalSeen: 0,
        errors: [],
        duplicateCount: 0,
      },
      items: [],
      settings,
    }
    const plan = await SmartPlan.create(planFields)
    // Keep stale evidence in its own plan: an UNKNOWN result fences every
    // remaining task in that plan, while an independent plan must still be
    // allowed to skip its expired offer.
    const stalePlan = await SmartPlan.create(planFields)
    const fresh = offer('Envio desconhecido', 30)
    const stale = offer('Oferta expirada no sender', 31, {
      observedAt: new Date(now.getTime() - 48 * 3_600_000),
    })
    const createSend = (sendPlan, item, scheduledAt, extra = {}) =>
      SmartSend.create({
        userId: user.id,
        planId: sendPlan.id,
        audienceSlug: 'pet',
        groupId: groupIds.pet,
        groupName: 'PET',
        connectionScope: 'smart-test-scope',
        offerIdentity: offerIdentity(item),
        offer: item,
        messageIntro: null,
        scheduledAt,
        localDate: date,
        timezone: 'America/Sao_Paulo',
        evidenceObservedAt: extra.evidenceObservedAt ?? now,
        status: SMART_SEND_STATUS.PENDING,
      })
    const dueFresh = await createSend(plan, fresh, new Date(now.getTime() - 1000))
    const dueStale = await createSend(stalePlan, stale, new Date(now.getTime() - 1000), {
      evidenceObservedAt: new Date(now.getTime() - 48 * 3_600_000),
    })
    let calls = 0
    const deps = fakeDependencies({
      provider: {
        async sendText() {
          calls++
          return { status: 'sent' }
        }, // no id => UNKNOWN
        async sendMedia() {
          calls++
          return { status: 'sent' }
        },
      },
    })
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id, ['pet'])
    await service.updateAudience(user.id, 'pet', {
      destinations: [
        { groupId: groupIds.pet, groupName: 'PET' },
        { groupId: groupIds.masculino, groupName: 'MASCULINO' },
      ],
    })
    const sender = new SmartCampaignSender(deps.uazapi, deps.connections, deps.groups, {
      ownerId: 'sender-a',
      batchSize: 10,
      now: () => now,
    })
    const first = await sender.processDue()
    assert.deepEqual(
      { claimed: first.claimed, unknown: first.unknown, skipped: first.skipped },
      { claimed: 2, unknown: 1, skipped: 1 },
    )
    assert.equal((await SmartSend.findByPk(dueStale.id)).status, SMART_SEND_STATUS.SKIPPED)
    assert.equal((await SmartSend.findByPk(dueFresh.id)).status, SMART_SEND_STATUS.UNKNOWN)
    assert.equal(
      await ProductGroupDelivery.count({
        where: {
          userId: user.id,
          groupId: groupIds.pet,
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
        },
      }),
      1,
    )
    assert.equal(calls, 1)
    const restarted = new SmartCampaignSender(deps.uazapi, deps.connections, deps.groups, {
      ownerId: 'sender-b',
      batchSize: 10,
      now: () => now,
    })
    const second = await restarted.processDue()
    assert.equal(second.claimed, 0)
    assert.equal(calls, 1, 'UNKNOWN must not be resent after worker restart')

    const blockedPlan = await SmartPlan.create({
      userId: user.id,
      status: SMART_PLAN_STATUS.SCHEDULED,
      startDate: date,
      days: 1,
      timezone: 'America/Sao_Paulo',
      audienceSlugs: ['pet'],
      input: {
        offers: [],
        observedAt: [],
        source: 'test',
        totalSeen: 0,
        errors: [],
        duplicateCount: 0,
      },
      items: [],
      settings,
    })
    const blockedSend = await SmartSend.create({
      userId: user.id,
      planId: blockedPlan.id,
      audienceSlug: 'pet',
      groupId: groupIds.masculino,
      groupName: 'MASCULINO',
      connectionScope: 'smart-test-scope',
      offerIdentity: offerIdentity(offer('Conexão perdida', 32)),
      offer: offer('Conexão perdida', 32),
      scheduledAt: new Date(now.getTime() - 1000),
      localDate: date,
      timezone: 'America/Sao_Paulo',
      evidenceObservedAt: now,
      status: SMART_SEND_STATUS.PENDING,
    })
    const disconnected = {
      ...deps.connections,
      async requireConnectedContext() {
        throw new Error('offline')
      },
    }
    const blocker = new SmartCampaignSender(deps.uazapi, disconnected, deps.groups, {
      ownerId: 'sender-c',
      now: () => now,
    })
    const blockedResult = await blocker.processDue()
    assert.equal(blockedResult.blocked, 1)
    assert.equal((await SmartPlan.findByPk(blockedPlan.id)).status, SMART_PLAN_STATUS.PAUSED)
    assert.match((await SmartSend.findByPk(blockedSend.id)).lastError, /indisponível|offline/i)
  } finally {
    await user.destroy()
  }
})

test('UNKNOWN cooldown is server enforced and explicit resolution reconciles ledger and audit', async () => {
  assertLocalDatabase()
  const user = await createUser('unknown-recovery')
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id, ['pet'])
    const audience = await SmartAudience.findOne({ where: { userId: user.id, slug: 'pet' } })
    const plan = await SmartPlan.create({
      userId: user.id,
      status: SMART_PLAN_STATUS.PAUSED,
      startDate: localDate(),
      days: 1,
      timezone: 'America/Sao_Paulo',
      audienceSlugs: ['pet'],
      input: {},
      items: [],
      settings: { audiences: { pet: audience.policy } },
    })
    const product = offer('Arranhador para gatos', 99)
    const send = await SmartSend.create({
      userId: user.id,
      planId: plan.id,
      audienceSlug: 'pet',
      groupId: groupIds.pet,
      groupName: 'PET',
      connectionScope: 'smart-test-scope',
      offerIdentity: offerIdentity(product),
      offer: product,
      scheduledAt: new Date(),
      localDate: localDate(),
      timezone: 'America/Sao_Paulo',
      evidenceObservedAt: new Date(),
      status: SMART_SEND_STATUS.UNKNOWN,
      attempts: 1,
    })
    await ProductGroupDelivery.create({
      userId: user.id,
      connectionScope: 'smart-test-scope',
      offerIdentity: send.offerIdentity,
      offerUrl: product.affiliateUrl,
      offerTitle: product.title,
      groupId: groupIds.pet,
      groupName: 'PET',
      campaignId: null,
      status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
    })
    for (const resolution of ['sent', 'retry', 'skip']) {
      await assert.rejects(
        service.resolveUnknown(user.id, send.uuid, resolution),
        (error) => error.code === 'SMART_UNKNOWN_COOLDOWN',
      )
    }
    await sequelize.query(
      "UPDATE smart_sends SET updated_at=NOW()-INTERVAL '6 minutes' WHERE id=:id",
      { replacements: { id: send.id } },
    )
    await sequelize.query(
      "UPDATE product_group_deliveries SET heartbeat_at=NOW()-INTERVAL '6 minutes' WHERE user_id=:userId",
      { replacements: { userId: user.id } },
    )
    const resolved = await service.resolveUnknown(user.id, send.uuid, 'retry')
    assert.equal(resolved.status, SMART_SEND_STATUS.PENDING)
    assert.equal(
      await ProductGroupDelivery.count({ where: { userId: user.id } }),
      0,
      'only explicit verified retry releases the barrier',
    )
    assert.equal((await plan.reload()).status, SMART_PLAN_STATUS.SCHEDULED)
    const [events] = await sequelize.query(
      "SELECT metadata FROM smart_operation_events WHERE user_id=:userId AND action='SMART_SEND_UNKNOWN_RESOLVED'",
      { replacements: { userId: user.id } },
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.resolution, 'retry')
    const [stateEvents] = await sequelize.query(
      'SELECT status FROM smart_plan_events WHERE plan_id=:planId ORDER BY id',
      { replacements: { planId: plan.id } },
    )
    assert.deepEqual(
      stateEvents.map((event) => event.status),
      ['PAUSED', 'SCHEDULED'],
    )
  } finally {
    await user.destroy()
  }
})

test('parallel plan creation enforces the shared paid-analysis quota', async () => {
  assertLocalDatabase()
  const user = await createUser('analysis-quota')
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id, ['pet'])
    const input = {
      date: localDate(),
      days: 1,
      audienceSlugs: ['pet'],
      rawJson: [offer('Coleira pet', 101)],
    }
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        service.createPlan(user.id, { ...input, requestId: randomUUID() }),
      ),
    )
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 2)
    assert.equal(await SmartPlan.count({ where: { userId: user.id } }), 2)
  } finally {
    await user.destroy()
  }
})

test('failed analysis retry requires a revision and records its request id', async () => {
  assertLocalDatabase()
  const user = await createUser('retry-request')
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id, ['pet'])
    const created = await service.createPlan(user.id, {
      requestId: randomUUID(),
      date: localDate(),
      days: 1,
      audienceSlugs: ['pet'],
      rawJson: [offer('Coleira pet', 150)],
    })
    const plan = await SmartPlan.findOne({ where: { uuid: created.id, userId: user.id } })
    assert.ok(plan)
    plan.status = SMART_PLAN_STATUS.FAILED
    plan.progress = { ...plan.progress, phase: 'FAILED' }
    await plan.save()

    const requestId = randomUUID()
    const retried = await service.retryAnalysis(user.id, created.id, plan.revision, requestId)
    assert.equal(retried.status, SMART_PLAN_STATUS.ANALYZING)
    const [events] = await sequelize.query(
      "SELECT metadata FROM smart_operation_events WHERE user_id=:userId AND action='SMART_PLAN_ANALYSIS_RETRIED'",
      { replacements: { userId: user.id } },
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].metadata.requestId, requestId)
  } finally {
    await user.destroy()
  }
})

test('plan request ids are idempotent and analysis uses its frozen audience criteria', async () => {
  assertLocalDatabase()
  const user = await createUser('idempotent-snapshot')
  try {
    const deps = fakeDependencies()
    const service = new SmartCampaignService(
      deps.imports,
      deps.savedProducts,
      deps.intelligence,
      deps.groups,
      deps.connections,
    )
    await configureAudiences(service, user.id, ['pet'])
    await service.updateAudience(user.id, 'pet', {
      profile: { instructions: 'Critério original detalhado para cães e gatos domésticos.' },
    })
    const requestId = randomUUID()
    const input = {
      requestId,
      date: localDate(),
      days: 1,
      audienceSlugs: ['pet'],
      rawJson: [offer('Brinquedo interativo pet', 201)],
    }
    const first = await service.createPlan(user.id, input)
    const replay = await service.createPlan(user.id, input)
    assert.equal(replay.id, first.id)
    assert.equal(await SmartPlan.count({ where: { userId: user.id } }), 1)
    await assert.rejects(
      service.createPlan(user.id, {
        ...input,
        rawJson: [offer('Produto diferente', 202)],
      }),
      /identificação.*outros dados/i,
    )

    await service.updateAudience(user.id, 'pet', {
      profile: { instructions: 'Critério posterior que não pode alterar esta análise.' },
    })
    const row = await SmartPlan.findOne({ where: { uuid: first.id, userId: user.id } })
    assert.ok(row)
    await service.processPendingAnalysis(row.id)
    assert.equal(
      deps.analysisCalls[0].audienceConfigs.pet.instructions,
      'Critério original detalhado para cães e gatos domésticos.',
    )
  } finally {
    await user.destroy()
  }
})
