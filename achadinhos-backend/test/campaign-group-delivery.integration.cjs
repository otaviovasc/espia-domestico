const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
process.env.DELIVERY_CLAIM_HEARTBEAT_MS = '20'
require('reflect-metadata')

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { Campaign, CAMPAIGN_STATUS_ENUM } = require('../dist/database/models/Campaign.js')
const { CampaignLog } = require('../dist/database/models/CampaignLog.js')
const { SavedProduct } = require('../dist/database/models/SavedProduct.js')
const {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} = require('../dist/database/models/ProductGroupDelivery.js')
const {
  CampaignService,
  DELIVERY_CLAIM_RECOVERY_MS,
} = require('../dist/services/CampaignService.js')
const { BadRequestError } = require('../dist/middleware/Error/AppError.js')

const safety = {
  minDelaySeconds: 0,
  maxDelaySeconds: 0,
  shuffleGroups: false,
  maxPerHour: 0,
  warmupBatchSize: 0,
  warmupPauseFactor: 1,
}
const groups = [
  { id: '100@g.us', name: 'Grupo A' },
  { id: '200@g.us', name: 'Grupo B' },
  { id: '300@g.us', name: 'Grupo C' },
]

async function waitForCampaign(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const campaign = await Campaign.findByPk(id)
    if (campaign.status !== CAMPAIGN_STATUS_ENUM.RUNNING) return campaign
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`campaign ${id} did not finish`)
}

test('campaign delivery ledger skips successful product/group pairs and retries failures', async () => {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(databaseHost),
    'Integration test requires local Postgres',
  )
  await sequelize.authenticate()

  const stamp = randomUUID()
  const user = await User.create({
    name: 'Group delivery test',
    email: `group-delivery-${stamp}@example.invalid`,
    passwordHash: 'not-used-by-this-test',
    role: USER_ROLE_ENUM.MEMBER,
  })
  const calls = []
  let failGroupBOnce = true
  let connected = true
  let disconnectAfterNextSend = false
  let blockedSend = null
  const uazapi = {
    async sendText(_creds, params) {
      calls.push(params.number)
      if (blockedSend) {
        const currentBlock = blockedSend
        blockedSend = null
        currentBlock.started()
        await currentBlock.gate
      }
      if (params.number === groups[1].id && failGroupBOnce) {
        failGroupBOnce = false
        return { id: `failed-${calls.length}`, status: 'failed' }
      }
      if (disconnectAfterNextSend) {
        disconnectAfterNextSend = false
        connected = false
      }
      return { id: `message-${calls.length}`, status: 'sent' }
    },
    async sendMedia() {
      throw new Error('images are disabled in this test')
    },
  }
  const connectionService = {
    async requireConnectedContext() {
      if (!connected) throw BadRequestError('WhatsApp desconectado')
      return { creds: { baseUrl: 'https://uaz.invalid', token: 'test' }, scope: 'instance:test' }
    },
    async requireConnectedCreds() {
      return { baseUrl: 'https://uaz.invalid', token: 'test' }
    },
    async getConnectionScope() {
      return 'instance:test'
    },
  }
  const groupService = {
    async requireCurrentGroups(_userId, requestedIds) {
      return new Map(
        groups.filter((group) => requestedIds.includes(group.id)).map((group) => [group.id, group]),
      )
    },
  }
  const service = new CampaignService(uazapi, connectionService, groupService)

  const mercadoOffer = {
    title: 'Panela doméstica',
    discountedPrice: 80,
    affiliateUrl: `https://meli.la/${stamp}`,
    source: 'mercadolivre',
    productId: `MLB-${stamp}`,
  }

  try {
    const otherUser = await User.create({
      name: 'Other catalog owner',
      email: `other-catalog-${stamp}@example.invalid`,
      passwordHash: 'not-used-by-this-test',
      role: USER_ROLE_ENUM.MEMBER,
    })
    const foreignProduct = await SavedProduct.create({
      userId: otherUser.id,
      source: mercadoOffer.source,
      productId: mercadoOffer.productId,
      affiliateUrl: mercadoOffer.affiliateUrl,
      affiliateUrlHash: createHash('sha256').update(mercadoOffer.affiliateUrl).digest('hex'),
      offer: mercadoOffer,
    })
    await assert.rejects(
      service.create(user.id, {
        name: 'ID forjado',
        offers: [{ ...mercadoOffer, savedProductId: foreignProduct.id }],
        groups: [groups[0]],
        safety,
        sendImages: false,
      }),
      /não pertence ao usuário/,
    )
    const ownProduct = await SavedProduct.create({
      userId: user.id,
      source: mercadoOffer.source,
      productId: mercadoOffer.productId,
      affiliateUrl: mercadoOffer.affiliateUrl,
      affiliateUrlHash: createHash('sha256').update(mercadoOffer.affiliateUrl).digest('hex'),
      offer: mercadoOffer,
    })
    await assert.rejects(
      service.create(user.id, {
        name: 'ID divergente',
        offers: [
          {
            ...mercadoOffer,
            savedProductId: ownProduct.id,
            affiliateUrl: 'https://example.com/forged',
          },
        ],
        groups: [groups[0]],
        safety,
        sendImages: false,
      }),
      /foi alterado/,
    )

    ownProduct.classifications = {
      corrida: {
        category: 'A',
        relevanceScore: 95,
        discountPercent: 20,
        commissionRate: 12,
        profileName: 'Corrida',
        classifiedAt: new Date().toISOString(),
      },
    }
    await ownProduct.save()
    const nicheOffer = {
      ...mercadoOffer,
      savedProductId: ownProduct.id,
      category: 'A',
      relevanceScore: 95,
      discountPercent: 20,
      commissionRate: 12,
      classificationProfileId: 'corrida',
      classificationProfileName: 'Corrida',
    }
    await service.create(user.id, {
      name: 'Categoria do nicho salvo',
      offers: [nicheOffer],
      groups: [groups[0]],
      safety,
      sendImages: false,
    })
    ownProduct.classifications = {
      ...ownProduct.classifications,
      corrida: { ...ownProduct.classifications.corrida, profileName: 'Corrida e treino' },
    }
    await ownProduct.save()
    await service.create(user.id, {
      name: 'Nome do nicho alterado',
      offers: [nicheOffer],
      groups: [groups[0]],
      safety,
      sendImages: false,
    })
    await assert.rejects(
      service.create(user.id, {
        name: 'Categoria de nicho forjada',
        offers: [{ ...nicheOffer, category: 'B' }],
        groups: [groups[0]],
        safety,
        sendImages: false,
      }),
      /foi alterado/,
    )

    const first = await Campaign.create({
      userId: user.id,
      name: 'Primeiro envio',
      offers: [mercadoOffer],
      groups: groups.slice(0, 2),
      safety,
      sendImages: false,
    })
    await service.runNow(user.id, first.id)
    const firstDone = await waitForCampaign(first.id)
    assert.equal(firstDone.totalSent, 1)
    assert.equal(firstDone.totalFailed, 1)
    assert.equal(await CampaignLog.count({ where: { campaignId: first.id } }), 2)

    const afterFirst = (
      await service.checkOffers(
        user.id,
        [mercadoOffer],
        groups.slice(0, 2).map((g) => g.id),
      )
    )[JSON.stringify(['mercadolivre', mercadoOffer.productId])]
    assert.deepEqual(afterFirst.sentGroupIds, [groups[0].id])
    assert.deepEqual(afterFirst.eligibleGroupIds, [groups[1].id])

    const amazonOffer = {
      ...mercadoOffer,
      title: 'Panela Amazon',
      source: 'amazon',
      affiliateUrl: `https://amzn.to/${stamp}`,
    }
    const second = await Campaign.create({
      userId: user.id,
      name: 'Segundo envio',
      offers: [{ ...mercadoOffer, affiliateUrl: `https://meli.la/changed-${stamp}` }, amazonOffer],
      groups: groups.slice(0, 2),
      safety,
      sendImages: false,
    })
    await service.runNow(user.id, second.id)
    const secondDone = await waitForCampaign(second.id)
    assert.equal(secondDone.totalSent, 3)
    assert.equal(secondDone.totalFailed, 0)
    assert.equal(await CampaignLog.count({ where: { campaignId: second.id } }), 3)
    assert.equal(
      calls.length,
      5,
      'only the missing Mercado Livre group and both Amazon groups are attempted',
    )

    const flags = await service.checkOffers(
      user.id,
      [{ ...mercadoOffer, affiliateUrl: `https://meli.la/another-${stamp}` }, amazonOffer],
      groups.slice(0, 2).map((group) => group.id),
    )
    assert.deepEqual(
      flags[JSON.stringify(['mercadolivre', mercadoOffer.productId])].sentGroupIds.sort(),
      [groups[0].id, groups[1].id].sort(),
    )
    assert.deepEqual(
      flags[JSON.stringify(['amazon', mercadoOffer.productId])].sentGroupIds.sort(),
      [groups[0].id, groups[1].id].sort(),
    )

    const savedAliasCampaign = await Campaign.create({
      userId: user.id,
      name: 'Identidade salva sobre histórico legado',
      offers: [{ ...mercadoOffer, savedProductId: ownProduct.id }],
      groups: groups.slice(0, 2),
      safety,
      sendImages: false,
    })
    const beforeAliasCalls = calls.length
    await service.runNow(user.id, savedAliasCampaign.id)
    const savedAliasDone = await waitForCampaign(savedAliasCampaign.id)
    assert.equal(calls.length, beforeAliasCalls)
    assert.equal(savedAliasDone.totalSkipped, 2)

    const overlapOffer = {
      ...mercadoOffer,
      productId: `OVERLAP-${stamp}`,
      affiliateUrl: `https://example.com/${stamp}`,
    }
    const overlapping = await Promise.all(
      ['Sobreposta 1', 'Sobreposta 2'].map((name) =>
        Campaign.create({
          userId: user.id,
          name,
          offers: [overlapOffer],
          groups: [groups[2]],
          safety,
          sendImages: false,
        }),
      ),
    )
    const beforeOverlapCalls = calls.length
    await Promise.all(overlapping.map((campaign) => service.runNow(user.id, campaign.id)))
    const overlapDone = await Promise.all(
      overlapping.map((campaign) => waitForCampaign(campaign.id)),
    )
    assert.equal(
      calls.length - beforeOverlapCalls,
      1,
      'atomic unique claim prevents concurrent duplicate sends',
    )
    assert.equal(
      overlapDone.reduce((sum, campaign) => sum + campaign.totalSent, 0),
      1,
    )
    assert.equal(
      overlapDone.reduce((sum, campaign) => sum + campaign.totalFailed, 0),
      0,
    )
    assert.equal(
      overlapDone.reduce((sum, campaign) => sum + campaign.totalSkipped, 0),
      1,
    )

    const disconnectOffer = {
      ...mercadoOffer,
      productId: `DISCONNECT-${stamp}`,
      affiliateUrl: `https://example.com/disconnect-${stamp}`,
    }
    const disconnectCampaign = await Campaign.create({
      userId: user.id,
      name: 'Interrompe ao desconectar',
      offers: [disconnectOffer],
      groups: groups.slice(0, 2),
      safety,
      sendImages: false,
    })
    const beforeDisconnectCalls = calls.length
    disconnectAfterNextSend = true
    await service.runNow(user.id, disconnectCampaign.id)
    const disconnected = await waitForCampaign(disconnectCampaign.id)
    assert.equal(calls.length - beforeDisconnectCalls, 1)
    assert.equal(disconnected.status, CAMPAIGN_STATUS_ENUM.FAILED)
    assert.equal(disconnected.totalSent, 1)
    connected = true

    const liveClaimOffer = {
      ...mercadoOffer,
      productId: `LIVE-CLAIM-${stamp}`,
      affiliateUrl: `https://example.com/live-claim-${stamp}`,
    }
    const liveClaimCampaign = await Campaign.create({
      userId: user.id,
      name: 'Reivindicação ativa',
      offers: [liveClaimOffer],
      groups: [groups[2]],
      safety,
      sendImages: false,
    })
    let markProviderStarted
    let releaseProvider
    const providerStarted = new Promise((resolve) => {
      markProviderStarted = resolve
    })
    const providerGate = new Promise((resolve) => {
      releaseProvider = resolve
    })
    blockedSend = { started: markProviderStarted, gate: providerGate }
    await service.runNow(user.id, liveClaimCampaign.id)
    await providerStarted
    const liveClaim = await ProductGroupDelivery.findOne({
      where: { campaignId: liveClaimCampaign.id },
    })
    assert.ok(liveClaim)
    await sequelize.query(
      `UPDATE product_group_deliveries
       SET created_at = :staleAt, heartbeat_at = :staleAt
       WHERE id = :id`,
      {
        replacements: {
          id: liveClaim.id,
          staleAt: new Date(Date.now() - DELIVERY_CLAIM_RECOVERY_MS - 1000),
        },
      },
    )
    let refreshedLiveClaim = null
    for (let attempt = 0; attempt < 50; attempt++) {
      refreshedLiveClaim = await ProductGroupDelivery.findByPk(liveClaim.id)
      if (
        refreshedLiveClaim.heartbeatAt.getTime() >
        Date.now() - DELIVERY_CLAIM_RECOVERY_MS
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(
      refreshedLiveClaim.heartbeatAt.getTime() > Date.now() - DELIVERY_CLAIM_RECOVERY_MS,
      'the active provider call refreshes its claim heartbeat',
    )
    let liveRecoveryError = null
    try {
      await service.resolveDeliveryClaim(user.id, {
        offer: liveClaimOffer,
        groupId: groups[2].id,
        resolution: 'retry',
      })
    } catch (error) {
      liveRecoveryError = error
    }
    try {
      assert.match(liveRecoveryError?.message ?? '', /Aguarde cinco minutos/)
      const callsWithLiveProvider = calls.length
      const competingCampaign = await Campaign.create({
        userId: user.id,
        name: 'Tentativa durante reivindicação ativa',
        offers: [liveClaimOffer],
        groups: [groups[2]],
        safety,
        sendImages: false,
      })
      await service.runNow(user.id, competingCampaign.id)
      const competingDone = await waitForCampaign(competingCampaign.id)
      assert.equal(competingDone.totalSkipped, 1)
      assert.equal(calls.length, callsWithLiveProvider, 'a live claim also fences another campaign')
    } finally {
      releaseProvider()
    }
    const liveClaimDone = await waitForCampaign(liveClaimCampaign.id)
    assert.equal(liveClaimDone.status, CAMPAIGN_STATUS_ENUM.COMPLETED)
    assert.equal(
      await ProductGroupDelivery.count({
        where: { campaignId: liveClaimCampaign.id, status: PRODUCT_GROUP_DELIVERY_STATUS.SENT },
      }),
      1,
    )

    const recoveryBaseOffer = {
      ...mercadoOffer,
      productId: `RECOVERY-${stamp}`,
      affiliateUrl: `https://example.com/recovery-${stamp}`,
    }
    const recoveryProduct = await SavedProduct.create({
      userId: user.id,
      source: recoveryBaseOffer.source,
      productId: recoveryBaseOffer.productId,
      affiliateUrl: recoveryBaseOffer.affiliateUrl,
      affiliateUrlHash: createHash('sha256').update(recoveryBaseOffer.affiliateUrl).digest('hex'),
      offer: recoveryBaseOffer,
    })
    const ambiguousOffer = { ...recoveryBaseOffer, savedProductId: recoveryProduct.id }
    const identity = require('../dist/utils/offerIdentity.js').offerIdentity(ambiguousOffer)
    await ProductGroupDelivery.create({
      userId: user.id,
      connectionScope: 'instance:test',
      offerIdentity: identity,
      offerSource: ambiguousOffer.source,
      offerProductId: ambiguousOffer.productId,
      offerUrl: ambiguousOffer.affiliateUrl,
      offerTitle: ambiguousOffer.title,
      groupId: groups[0].id,
      groupName: groups[0].name,
      status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
    })
    const ambiguous = (await service.checkOffers(user.id, [ambiguousOffer], [groups[0].id]))[
      `saved:${recoveryProduct.id}`
    ]
    assert.deepEqual(ambiguous.sendingGroupIds, [groups[0].id])
    assert.deepEqual(ambiguous.eligibleGroupIds, [])
    assert.equal(ambiguous.groups[0].claimStatus, 'sending')
    await assert.rejects(
      service.resolveDeliveryClaim(user.id, {
        savedProductId: recoveryProduct.id,
        groupId: groups[0].id,
        resolution: 'retry',
      }),
      /Aguarde cinco minutos/,
    )
    await assert.rejects(
      service.resolveDeliveryClaim(otherUser.id, {
        savedProductId: recoveryProduct.id,
        groupId: groups[0].id,
        resolution: 'retry',
      }),
      /não pertence ao usuário/,
    )
    const staleClaimAt = new Date(Date.now() - DELIVERY_CLAIM_RECOVERY_MS - 1000)
    await ProductGroupDelivery.update(
      { createdAt: staleClaimAt, heartbeatAt: staleClaimAt },
      { where: { userId: user.id, offerIdentity: identity, groupId: groups[0].id } },
    )
    const recoverable = (await service.checkOffers(user.id, [ambiguousOffer], [groups[0].id]))[
      `saved:${recoveryProduct.id}`
    ]
    assert.equal(recoverable.groups[0].claimStatus, 'unconfirmed')
    assert.deepEqual(
      await service.resolveDeliveryClaim(user.id, {
        savedProductId: recoveryProduct.id,
        groupId: groups[0].id,
        resolution: 'retry',
      }),
      { savedProductId: recoveryProduct.id, groupId: groups[0].id, status: 'unsent' },
    )
    assert.equal(
      await ProductGroupDelivery.count({
        where: { userId: user.id, offerIdentity: identity, groupId: groups[0].id },
      }),
      0,
    )
    await ProductGroupDelivery.create({
      userId: user.id,
      connectionScope: 'instance:test',
      offerIdentity: identity,
      offerSource: ambiguousOffer.source,
      offerProductId: ambiguousOffer.productId,
      offerUrl: ambiguousOffer.affiliateUrl,
      offerTitle: ambiguousOffer.title,
      groupId: groups[0].id,
      groupName: groups[0].name,
      status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
      createdAt: staleClaimAt,
      heartbeatAt: staleClaimAt,
    })
    assert.deepEqual(
      await service.resolveDeliveryClaim(user.id, {
        savedProductId: recoveryProduct.id,
        groupId: groups[0].id,
        resolution: 'sent',
      }),
      { savedProductId: recoveryProduct.id, groupId: groups[0].id, status: 'sent' },
    )

    const rawOffer = {
      ...mercadoOffer,
      productId: `RAW-${stamp}`,
      affiliateUrl: `https://example.com/raw-${stamp}`,
    }
    const rawIdentity = require('../dist/utils/offerIdentity.js').offerIdentity(rawOffer)
    const stalledCampaign = await Campaign.create({
      userId: user.id,
      name: 'Execução interrompida',
      offers: [rawOffer],
      groups: [groups[0]],
      safety,
      sendImages: false,
      status: CAMPAIGN_STATUS_ENUM.RUNNING,
    })
    await ProductGroupDelivery.create({
      userId: user.id,
      connectionScope: 'instance:test',
      offerIdentity: rawIdentity,
      offerSource: rawOffer.source,
      offerProductId: rawOffer.productId,
      offerUrl: rawOffer.affiliateUrl,
      offerTitle: rawOffer.title,
      groupId: groups[0].id,
      groupName: groups[0].name,
      campaignId: stalledCampaign.id,
      status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
      createdAt: staleClaimAt,
      heartbeatAt: staleClaimAt,
    })
    assert.deepEqual(
      await service.resolveDeliveryClaim(user.id, {
        offer: rawOffer,
        groupId: groups[0].id,
        resolution: 'retry',
      }),
      { savedProductId: null, groupId: groups[0].id, status: 'unsent' },
    )
    assert.equal((await stalledCampaign.reload()).status, CAMPAIGN_STATUS_ENUM.FAILED)

    const invalidCampaign = await Campaign.create({
      userId: user.id,
      name: 'Grupo inválido',
      offers: [mercadoOffer],
      groups: [{ id: '999@g.us', name: 'Antigo' }],
      safety,
      sendImages: false,
    })
    groupService.requireCurrentGroups = async () => {
      throw BadRequestError('grupo fora da conexão atual')
    }
    await assert.rejects(service.runNow(user.id, invalidCampaign.id), /grupo fora da conexão atual/)
    assert.equal((await invalidCampaign.reload()).status, CAMPAIGN_STATUS_ENUM.DRAFT)
  } finally {
    await user.destroy()
    await User.destroy({ where: { email: `other-catalog-${stamp}@example.invalid` } })
    await sequelize.close()
  }
})
