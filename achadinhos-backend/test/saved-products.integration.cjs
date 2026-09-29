const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('reflect-metadata')

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { Campaign, CAMPAIGN_STATUS_ENUM } = require('../dist/database/models/Campaign.js')
const { CampaignLog } = require('../dist/database/models/CampaignLog.js')
const { SavedProduct } = require('../dist/database/models/SavedProduct.js')
const { createApp } = require('../dist/app.js')
const { generateToken } = require('../dist/middleware/auth.js')
const { offerIdentity } = require('../dist/utils/offerIdentity.js')

test('saved product API persists selected categories and isolates users', async () => {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(databaseHost), 'Integration test requires local Postgres')

  await sequelize.authenticate()
  const indexes = await sequelize.getQueryInterface().showIndex('saved_products')
  assert.ok(indexes.some((index) => index.name === 'saved_products_user_unsourced_product_unique' && index.unique))
  const stamp = randomUUID()
  const users = []
  let server
  try {
    for (const suffix of ['a', 'b']) {
      users.push(await User.create({
        name: `Catalog test ${suffix}`,
        email: `catalog-${stamp}-${suffix}@example.invalid`,
        passwordHash: 'not-used-by-this-test',
        role: USER_ROLE_ENUM.MEMBER,
      }))
    }
    server = createApp().listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/v1/saved-products`
    const tokens = users.map((user) => generateToken(user))
    const request = async (userIndex, path = '', init = {}) => {
      const response = await fetch(base + path, {
        ...init,
        headers: {
          authorization: `Bearer ${tokens[userIndex]}`,
          'content-type': 'application/json',
        },
      })
      return { status: response.status, body: await response.json() }
    }
    const offer = {
      title: 'Panela de teste',
      discountedPrice: 80,
      originalPrice: 100,
      affiliateUrl: `https://meli.la/catalog-${stamp}`,
      source: 'mercadolivre',
      productId: `MLB-${stamp}`,
      commissioned: true,
      commissionPercent: '12%',
      category: 'A',
      relevanceScore: 96,
      discountPercent: 20,
      commissionRate: 12,
      coupon: 'OLD',
    }

    const invalid = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [{ ...offer, category: undefined }] }) })
    assert.equal(invalid.status, 400)

    const first = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [offer] }) })
    assert.equal(first.status, 200)
    assert.equal(first.body.data.created, 1)
    assert.equal(first.body.data.saved[0].offer.category, 'A')
    const id = first.body.data.saved[0].id

    const repeated = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [{ ...offer, savedProductId: 999999 }] }) })
    assert.equal(repeated.body.data.created, 0)
    assert.equal(repeated.body.data.updated, 1)
    assert.equal(repeated.body.data.saved[0].id, id)
    assert.equal(repeated.body.data.saved[0].offer.savedProductId, id)
    assert.equal((await SavedProduct.findByPk(id)).offer.savedProductId, undefined)

    const renamedLink = { ...offer, affiliateUrl: `https://meli.la/catalog-new-${stamp}`, category: 'B' }
    const updated = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [renamedLink] }) })
    assert.equal(updated.body.data.saved[0].id, id)
    assert.equal(updated.body.data.saved[0].offer.category, 'B')

    const ownList = await request(0)
    assert.equal(ownList.body.data.total, 1)
    assert.equal(ownList.body.data.items[0].offer.category, 'B')
    assert.equal(ownList.body.data.items[0].offer.savedProductId, id)

    assert.equal((await request(1, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { title: 'Wrong user' } }) })).status, 404)
    assert.equal((await request(0, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { productId: 'forged' } }) })).status, 400)
    assert.equal((await request(0, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { savedProductId: 999 } }) })).status, 400)
    assert.equal((await request(0, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { title: '' } }) })).status, 400)
    const manual = await request(0, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { title: 'Panela revisada', category: 'A', coupon: null, description: 'Texto manual', commissionRate: 14 } }) })
    assert.equal(manual.status, 200)
    assert.equal(manual.body.data.offer.savedProductId, id)
    assert.equal(manual.body.data.offer.relevanceScore, undefined)
    assert.deepEqual(manual.body.data.manualOverrides, ['category', 'commissionPercent', 'commissionRate', 'coupon', 'description', 'relevanceScore', 'title'])
    assert.equal(manual.body.data.offer.coupon, undefined)
    assert.equal(manual.body.data.offer.commissionPercent, '14%')
    const reimport = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [{ ...renamedLink, title: 'Automatic title', category: 'C', coupon: 'NEW', relevanceScore: 30, discountedPrice: 70 }] }) })
    assert.equal(reimport.status, 200)
    assert.equal(reimport.body.data.saved[0].offer.title, 'Panela revisada')
    assert.equal(reimport.body.data.saved[0].offer.category, 'A')
    assert.equal(reimport.body.data.saved[0].offer.coupon, undefined)
    assert.equal(reimport.body.data.saved[0].offer.relevanceScore, undefined)
    assert.equal(reimport.body.data.saved[0].offer.discountedPrice, 70)
    assert.equal(reimport.body.data.saved[0].offer.commissionRate, 14)

    const otherSource = { ...offer, source: 'amazon', affiliateUrl: `https://amzn.to/catalog-${stamp}` }
    const second = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [otherSource] }) })
    assert.equal(second.body.data.created, 1)
    assert.notEqual(second.body.data.saved[0].id, id)
    assert.equal((await request(0, `/${second.body.data.saved[0].id}`, { method: 'PATCH', body: JSON.stringify({ offer: { affiliateUrl: renamedLink.affiliateUrl } }) })).status, 409)
    const manualUrl = `https://meli.la/manual-${stamp}`
    const linkEdit = await request(0, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { affiliateUrl: manualUrl } }) })
    assert.equal(linkEdit.status, 200)
    assert.equal(linkEdit.body.data.offer.affiliateUrl, manualUrl)
    const afterLinkReimport = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [renamedLink] }) })
    assert.equal(afterLinkReimport.body.data.saved[0].id, id)
    assert.equal(afterLinkReimport.body.data.saved[0].offer.affiliateUrl, manualUrl)

    const sentCampaign = await Campaign.create({
      userId: users[0].id,
      name: 'Catalog identity test',
      offers: [offer],
      groups: [{ id: '123@g.us', name: 'Test' }],
      safety: { minDelaySeconds: 8, maxDelaySeconds: 25, shuffleGroups: true, maxPerHour: 120, warmupBatchSize: 0, warmupPauseFactor: 3 },
      status: CAMPAIGN_STATUS_ENUM.COMPLETED,
    })
    await CampaignLog.create({
      campaignId: sentCampaign.id,
      groupId: '123@g.us',
      groupName: 'Test',
      offerTitle: offer.title,
      offerProductId: offer.productId,
      offerUrl: offer.affiliateUrl,
      success: true,
    })
    await CampaignLog.create({
      campaignId: sentCampaign.id,
      groupId: '123@g.us',
      groupName: 'Test',
      offerTitle: offer.title,
      offerUrl: manualUrl,
      success: true,
    })
    assert.equal((await request(0, `/${id}`, { method: 'PATCH', body: JSON.stringify({ offer: { affiliateUrl: `https://meli.la/manual-new-${stamp}` } }) })).status, 409)

    const flagsResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/campaigns/check-offers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
      body: JSON.stringify({ offers: [renamedLink, otherSource] }),
    })
    assert.equal(flagsResponse.status, 200)
    const flags = (await flagsResponse.json()).data
    assert.deepEqual(Object.keys(flags).sort(), [
      JSON.stringify(['amazon', offer.productId]),
      JSON.stringify(['mercadolivre', offer.productId]),
    ].sort())
    assert.equal(flags[JSON.stringify(['mercadolivre', offer.productId])].alreadySent, true)
    assert.equal(flags[JSON.stringify(['amazon', offer.productId])].alreadySent, false)
    const legacyFlagsResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/campaigns/check-offers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
      body: JSON.stringify({ offers: [{ productId: offer.productId, affiliateUrl: offer.affiliateUrl }] }),
    })
    assert.equal((await legacyFlagsResponse.json()).data[offer.productId].alreadySent, true)

    const generic = { ...offer, source: undefined, productId: `GEN-${stamp}`, affiliateUrl: `https://example.com/a-${stamp}` }
    const genericFirst = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [generic] }) })
    const genericId = genericFirst.body.data.saved[0].id
    const genericAgain = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [{ ...generic, affiliateUrl: `https://example.com/b-${stamp}` }] }) })
    assert.equal(genericAgain.body.data.created, 0)
    assert.equal(genericAgain.body.data.saved[0].id, genericId)
    assert.equal(genericAgain.body.data.saved[0].offer.productId, generic.productId)
    assert.equal(genericAgain.body.data.saved[0].offer.source, undefined)
    const storedGeneric = await SavedProduct.findByPk(genericId)
    assert.equal(storedGeneric.source, null)
    assert.equal(storedGeneric.productId, generic.productId)

    const idless = { ...generic, productId: undefined, affiliateUrl: `https://example.com/idless-${stamp}` }
    const idlessSaved = await request(0, '', { method: 'POST', body: JSON.stringify({ offers: [idless] }) })
    const idlessId = idlessSaved.body.data.saved[0].id
    const idlessLog = await CampaignLog.create({
      campaignId: sentCampaign.id,
      groupId: '123@g.us',
      groupName: 'Test',
      offerTitle: idless.title,
      offerUrl: idless.affiliateUrl,
      success: true,
    })
    const idlessLinkEdit = await request(0, `/${idlessId}`, { method: 'PATCH', body: JSON.stringify({ offer: { affiliateUrl: `https://example.com/idless-new-${stamp}` } }) })
    assert.equal(idlessLinkEdit.status, 409)
    await idlessLog.update({ offerIdentity: offerIdentity({ savedProductId: idlessId, affiliateUrl: idless.affiliateUrl }) })
    const catalogLinkEdit = await request(0, `/${idlessId}`, { method: 'PATCH', body: JSON.stringify({ offer: { affiliateUrl: `https://example.com/idless-new-${stamp}` } }) })
    assert.equal(catalogLinkEdit.status, 200)
    assert.equal(catalogLinkEdit.body.data.offer.savedProductId, idlessId)

    const bulk = Array.from({ length: 101 }, (_, index) => ({
      ...offer,
      source: 'test',
      productId: `BULK-${stamp}-${index}`,
      affiliateUrl: `https://example.com/bulk-${stamp}-${index}`,
    }))
    assert.equal((await request(0, '', { method: 'POST', body: JSON.stringify({ offers: bulk.slice(0, 100) }) })).body.data.created, 100)
    assert.equal((await request(0, '', { method: 'POST', body: JSON.stringify({ offers: bulk.slice(100) }) })).body.data.created, 1)
    const firstPage = await request(0, '?limit=100&offset=0')
    const secondPage = await request(0, '?limit=100&offset=100')
    assert.equal(firstPage.body.data.total, 105)
    assert.equal(firstPage.body.data.items.length, 100)
    assert.equal(secondPage.body.data.items.length, 5)

    const otherList = await request(1)
    assert.equal(otherList.body.data.total, 0)
    assert.equal((await request(1, `/${id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await request(0, `/${id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(0, `/${second.body.data.saved[0].id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(0, `/${genericId}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(0, `/${idlessId}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(0)).body.data.total, 101)
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    for (const user of users) await user.destroy()
    await sequelize.close()
  }
})
