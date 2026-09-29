const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
process.env.DELIVERY_CLAIM_HEARTBEAT_MS = '20'
require('reflect-metadata')

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { Campaign, CAMPAIGN_STATUS_ENUM } = require('../dist/database/models/Campaign.js')
const {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} = require('../dist/database/models/ProductGroupDelivery.js')
const { CampaignService } = require('../dist/services/CampaignService.js')
const { BadRequestError } = require('../dist/middleware/Error/AppError.js')
const { offerIdentity } = require('../dist/utils/offerIdentity.js')

const safety = {
  minDelaySeconds: 0,
  maxDelaySeconds: 0,
  shuffleGroups: false,
  maxPerHour: 0,
  warmupBatchSize: 0,
  warmupPauseFactor: 1,
}
const group = { id: '100@g.us', name: 'Grupo A' }

async function waitForCampaign(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const campaign = await Campaign.findByPk(id)
    if (campaign.status !== CAMPAIGN_STATUS_ENUM.RUNNING) return campaign
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`campaign ${id} did not finish`)
}

test('allowResend resends SENT pairs but still blocks SENDING pairs', async () => {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(databaseHost),
    'Integration test requires local Postgres',
  )
  await sequelize.authenticate()

  const stamp = randomUUID()
  const user = await User.create({
    name: 'Resend test',
    email: `resend-${stamp}@example.invalid`,
    passwordHash: 'not-used-by-this-test',
    role: USER_ROLE_ENUM.MEMBER,
  })
  const calls = []
  const uazapi = {
    async sendText(_creds, params) {
      calls.push(params.number)
      return { id: `message-${calls.length}`, status: 'sent' }
    },
    async sendMedia() {
      throw new Error('images are disabled in this test')
    },
  }
  const connectionService = {
    async requireConnectedContext() {
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
      assert.deepEqual(requestedIds, [group.id])
      return new Map([[group.id, group]])
    },
  }
  const service = new CampaignService(uazapi, connectionService, groupService)

  const offer = {
    title: 'Panela resend',
    discountedPrice: 80,
    affiliateUrl: `https://meli.la/${stamp}`,
    source: 'mercadolivre',
    productId: `MLB-${stamp}`,
  }

  try {
    const first = await Campaign.create({
      userId: user.id,
      name: 'Primeiro envio',
      offers: [offer],
      groups: [group],
      safety,
      sendImages: false,
    })
    assert.equal(first.allowResend, false)
    await service.runNow(user.id, first.id)
    assert.equal((await waitForCampaign(first.id)).totalSent, 1)
    assert.equal(calls.length, 1)

    // Default campaign skips the already-sent pair.
    const skipped = await Campaign.create({
      userId: user.id,
      name: 'Sem reenvio',
      offers: [offer],
      groups: [group],
      safety,
      sendImages: false,
    })
    await service.runNow(user.id, skipped.id)
    const skippedDone = await waitForCampaign(skipped.id)
    assert.equal(skippedDone.totalSkipped, 1)
    assert.equal(calls.length, 1)

    // Opt-in resend delivers the same pair again.
    const resent = await Campaign.create({
      userId: user.id,
      name: 'Com reenvio',
      offers: [offer],
      groups: [group],
      safety,
      sendImages: false,
      allowResend: true,
    })
    await service.runNow(user.id, resent.id)
    const resentDone = await waitForCampaign(resent.id)
    assert.equal(resentDone.totalSent, 1)
    assert.equal(resentDone.totalSkipped, 0)
    assert.equal(calls.length, 2)

    // An in-flight (SENDING) claim stays blocked even with resend on.
    const inFlightOffer = { ...offer, productId: `MLB-INFLIGHT-${stamp}` }
    await ProductGroupDelivery.create({
      userId: user.id,
      connectionScope: 'instance:test',
      offerIdentity: offerIdentity(inFlightOffer),
      offerSource: 'mercadolivre',
      offerProductId: inFlightOffer.productId,
      offerUrl: inFlightOffer.affiliateUrl,
      offerTitle: inFlightOffer.title,
      groupId: group.id,
      groupName: group.name,
      campaignId: null,
      status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
      heartbeatAt: new Date(),
    })
    const resendBlocked = await Campaign.create({
      userId: user.id,
      name: 'Reenvio com par em voo',
      offers: [inFlightOffer],
      groups: [group],
      safety,
      sendImages: false,
      allowResend: true,
    })
    await service.runNow(user.id, resendBlocked.id)
    const blockedDone = await waitForCampaign(resendBlocked.id)
    assert.equal(blockedDone.totalSkipped, 1)
    assert.equal(calls.length, 2)
  } finally {
    await Campaign.destroy({ where: { userId: user.id } })
    await ProductGroupDelivery.destroy({ where: { userId: user.id } })
    await User.destroy({ where: { id: user.id } })
    await sequelize.close()
  }
})
