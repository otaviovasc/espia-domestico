const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
require('reflect-metadata')

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { Campaign, CAMPAIGN_STATUS_ENUM } = require('../dist/database/models/Campaign.js')
const { CampaignLog } = require('../dist/database/models/CampaignLog.js')
const { SavedProduct } = require('../dist/database/models/SavedProduct.js')
const { ProductGroup } = require('../dist/database/models/ProductGroup.js')
const {
  SavedProductGroupMembership,
} = require('../dist/database/models/SavedProductGroupMembership.js')
const { ClassificationProfileRecord } = require('../dist/database/models/ClassificationProfile.js')
const { createApp } = require('../dist/app.js')
const { generateToken } = require('../dist/middleware/auth.js')
const { offerIdentity } = require('../dist/utils/offerIdentity.js')

test('saved product API persists selected categories and isolates users', async () => {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(databaseHost),
    'Integration test requires local Postgres',
  )

  await sequelize.authenticate()
  const indexes = await sequelize.getQueryInterface().showIndex('saved_products')
  assert.ok(
    indexes.some(
      (index) => index.name === 'saved_products_user_unsourced_product_unique' && index.unique,
    ),
  )
  const stamp = randomUUID()
  const users = []
  let server
  try {
    for (const suffix of ['a', 'b', 'legacy']) {
      users.push(
        await User.create({
          name: `Catalog test ${suffix}`,
          email: `catalog-${stamp}-${suffix}@example.invalid`,
          passwordHash: 'not-used-by-this-test',
          role: USER_ROLE_ENUM.MEMBER,
        }),
      )
    }
    const legacyOffers = Array.from({ length: 2 }, (_, index) => ({
      title: `Produto legado ${index}`,
      discountedPrice: 50 + index,
      affiliateUrl: `https://example.com/legacy-${stamp}-${index}`,
      category: 'B',
    }))
    const legacyProducts = await SavedProduct.bulkCreate(
      legacyOffers.map((offer, index) => ({
        userId: users[2].id,
        source: null,
        productId: `LEGACY-${stamp}-${index}`,
        affiliateUrl: offer.affiliateUrl,
        affiliateUrlHash: createHash('sha256').update(offer.affiliateUrl).digest('hex'),
        offer,
        classifications: {},
      })),
    )
    // Model the group/memberships backfilled by the migration for legacy data.
    // Runtime saves now use explicit batch groups and never create this group.
    const legacyDefaultGroup = await ProductGroup.create({
      userId: users[2].id,
      name: 'Produtos existentes',
      isDefault: true,
    })
    await SavedProductGroupMembership.bulkCreate(
      legacyProducts.map((product) => ({
        savedProductId: product.id,
        productGroupId: legacyDefaultGroup.id,
      })),
    )
    const customProfile = await ClassificationProfileRecord.create({
      userId: users[0].id,
      name: 'Ferramentas',
      nicheDescription: 'Ferramentas e equipamentos de oficina.',
      relevanceInstructions: 'Priorize ferramentas úteis.',
      weights: { relevance: 60, discount: 25, commission: 15 },
      discountCap: 50,
      commissionCap: 20,
      thresholds: {
        aScore: 75,
        aRelevance: 75,
        aDiscount: 15,
        aCommission: 10,
        bScore: 55,
        bRelevance: 50,
        cScore: 35,
        dRelevance: 25,
      },
    })
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
    const apiRequest = async (userIndex, path, init = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`, {
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

    const invalid = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [{ ...offer, category: undefined }] }),
    })
    assert.equal(invalid.status, 400)

    const first = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [offer] }),
    })
    assert.equal(first.status, 200)
    assert.equal(first.body.data.created, 1)
    assert.equal(first.body.data.saved[0].offer.category, 'A')
    assert.equal(first.body.data.saved[0].classifications.default.category, 'A')
    assert.equal(first.body.data.saved[0].classifications.default.profileName, 'Doméstico')
    assert.equal(first.body.data.saved[0].groupIds.length, 0)
    const id = first.body.data.saved[0].id

    const emptyGroups = await apiRequest(0, '/product-groups')
    assert.equal(emptyGroups.status, 200)
    assert.deepEqual(emptyGroups.body.data.items, [])
    const explicitGroup = await apiRequest(0, '/product-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Produtos existentes' }),
    })
    assert.equal(explicitGroup.status, 201)
    const batchGroupId = explicitGroup.body.data.id
    const explicitMembership = await request(0, '/groups', {
      method: 'PUT',
      body: JSON.stringify({ productIds: [id], groupIds: [batchGroupId], mode: 'add' }),
    })
    assert.equal(explicitMembership.status, 200)
    const initialGroups = await apiRequest(0, '/product-groups')
    assert.equal(initialGroups.status, 200)
    assert.equal(initialGroups.body.data.items.length, 1)
    assert.equal(initialGroups.body.data.items[0].name, 'Produtos existentes')
    assert.equal(initialGroups.body.data.items[0].isDefault, false)
    assert.equal(initialGroups.body.data.items[0].productCount, 1)

    const legacyGroups = await apiRequest(2, '/product-groups')
    assert.equal(legacyGroups.status, 200)
    assert.equal(legacyGroups.body.data.items[0].name, 'Produtos existentes')
    assert.equal(legacyGroups.body.data.items[0].productCount, 2)
    const legacyList = await request(2, `?groupId=${legacyGroups.body.data.items[0].id}`)
    assert.equal(legacyList.body.data.total, 2)
    assert.ok(legacyList.body.data.items.every((item) => item.groupIds.length === 1))

    const repeated = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [{ ...offer, savedProductId: 999999 }] }),
    })
    assert.equal(repeated.body.data.created, 0)
    assert.equal(repeated.body.data.updated, 1)
    assert.equal(repeated.body.data.saved[0].id, id)
    assert.equal(repeated.body.data.saved[0].offer.savedProductId, id)
    assert.equal((await SavedProduct.findByPk(id)).offer.savedProductId, undefined)

    const renamedLink = {
      ...offer,
      source: 'MercadoLivre',
      affiliateUrl: `https://meli.la/catalog-new-${stamp}`,
      category: 'B',
    }
    const updated = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [renamedLink] }),
    })
    assert.equal(updated.body.data.saved[0].id, id)
    assert.equal(updated.body.data.saved[0].offer.category, 'B')
    assert.equal(updated.body.data.saved[0].offer.source, 'mercadolivre')

    const ownList = await request(0)
    assert.equal(ownList.body.data.total, 1)
    assert.equal(ownList.body.data.items[0].offer.category, 'B')
    assert.equal(ownList.body.data.items[0].offer.savedProductId, id)

    assert.equal(
      (
        await request(1, `/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ offer: { title: 'Wrong user' } }),
        })
      ).status,
      404,
    )
    assert.equal(
      (
        await request(0, `/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ offer: { productId: 'forged' } }),
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await request(0, `/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ offer: { savedProductId: 999 } }),
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await request(0, `/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ offer: { title: '' } }),
        })
      ).status,
      400,
    )
    const manual = await request(0, `/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        offer: {
          title: 'Panela revisada',
          category: 'A',
          coupon: null,
          description: 'Texto manual',
          commissionRate: 14,
        },
      }),
    })
    assert.equal(manual.status, 200)
    assert.equal(manual.body.data.offer.savedProductId, id)
    assert.equal(manual.body.data.offer.relevanceScore, undefined)
    assert.deepEqual(manual.body.data.manualOverrides, [
      'category',
      'commissionPercent',
      'commissionRate',
      'coupon',
      'description',
      'relevanceScore',
      'title',
    ])
    assert.equal(manual.body.data.offer.coupon, undefined)
    assert.equal(manual.body.data.offer.commissionPercent, '14%')
    const reimport = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({
        offers: [
          {
            ...renamedLink,
            title: 'Automatic title',
            category: 'C',
            coupon: 'NEW',
            relevanceScore: 30,
            discountedPrice: 70,
          },
        ],
      }),
    })
    assert.equal(reimport.status, 200)
    assert.equal(reimport.body.data.saved[0].offer.title, 'Panela revisada')
    assert.equal(reimport.body.data.saved[0].offer.category, 'A')
    assert.equal(reimport.body.data.saved[0].offer.coupon, undefined)
    assert.equal(reimport.body.data.saved[0].offer.relevanceScore, undefined)
    assert.equal(reimport.body.data.saved[0].offer.discountedPrice, 70)
    assert.equal(reimport.body.data.saved[0].offer.commissionRate, 14)

    const customRating = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({
        offers: [
          {
            ...renamedLink,
            category: 'C',
            relevanceScore: 42,
            classificationProfileId: String(customProfile.id),
            classificationProfileName: 'Nome forjado',
          },
        ],
      }),
    })
    assert.equal(customRating.status, 200)
    assert.equal(customRating.body.data.saved[0].classifications.default.category, 'A')
    assert.equal(
      customRating.body.data.saved[0].classifications[String(customProfile.id)].category,
      'C',
    )
    assert.equal(
      customRating.body.data.saved[0].classifications[String(customProfile.id)].profileName,
      'Ferramentas',
    )
    const customManual = await request(0, `/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        classificationProfileId: String(customProfile.id),
        offer: { category: 'B' },
      }),
    })
    assert.equal(customManual.status, 200)
    assert.equal(customManual.body.data.classifications.default.category, 'A')
    assert.equal(customManual.body.data.classifications[String(customProfile.id)].category, 'B')
    assert.equal(
      customManual.body.data.classifications[String(customProfile.id)].relevanceScore,
      undefined,
    )
    const customReimport = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({
        offers: [
          {
            ...renamedLink,
            category: 'D',
            relevanceScore: 5,
            classificationProfileId: String(customProfile.id),
          },
        ],
      }),
    })
    assert.equal(
      customReimport.body.data.saved[0].classifications[String(customProfile.id)].category,
      'B',
    )
    assert.equal(
      customReimport.body.data.saved[0].classifications[String(customProfile.id)].relevanceScore,
      undefined,
    )

    const foreignProfile = await ClassificationProfileRecord.create({
      userId: users[1].id,
      name: 'Perfil estrangeiro',
      nicheDescription: 'Não pertence ao primeiro usuário.',
      relevanceInstructions: 'Não pode ser usado por outro usuário.',
      weights: { relevance: 60, discount: 25, commission: 15 },
      discountCap: 50,
      commissionCap: 20,
      thresholds: customProfile.thresholds,
    })
    const foreignRating = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({
        offers: [
          {
            ...offer,
            affiliateUrl: `https://example.com/foreign-${stamp}`,
            productId: `FOREIGN-${stamp}`,
            classificationProfileId: String(foreignProfile.id),
          },
        ],
      }),
    })
    assert.equal(foreignRating.status, 404)

    const summerGroup = await apiRequest(0, '/product-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Campanha verão' }),
    })
    assert.equal(summerGroup.status, 201)
    assert.equal(summerGroup.body.data.productCount, 0)
    const summerGroupId = summerGroup.body.data.id
    assert.equal(
      (
        await request(0, '/groups', {
          method: 'PUT',
          body: JSON.stringify({ productIds: [id], groupIds: [], mode: 'add' }),
        })
      ).status,
      400,
    )
    const grouped = await request(0, '/groups', {
      method: 'PUT',
      body: JSON.stringify({ productIds: [id], groupIds: [summerGroupId], mode: 'add' }),
    })
    assert.equal(grouped.status, 200)
    assert.equal(grouped.body.data.updated, 1)
    const groupedList = await request(0, `?groupId=${summerGroupId}`)
    assert.equal(groupedList.body.data.total, 1)
    assert.deepEqual(
      groupedList.body.data.items[0].groupIds,
      [batchGroupId, summerGroupId].sort((a, b) => a - b),
    )
    const renamedGroup = await apiRequest(0, `/product-groups/${summerGroupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Campanha ferramentas' }),
    })
    assert.equal(renamedGroup.status, 200)
    assert.equal(renamedGroup.body.data.name, 'Campanha ferramentas')
    assert.equal(
      (
        await apiRequest(0, '/product-groups', {
          method: 'POST',
          body: JSON.stringify({ name: 'produtos EXISTENTES' }),
        })
      ).status,
      409,
    )
    const otherUserGroups = await apiRequest(1, '/product-groups')
    assert.deepEqual(otherUserGroups.body.data.items, [])
    const otherUserGroup = await apiRequest(1, '/product-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Lote de outro usuário' }),
    })
    assert.equal(otherUserGroup.status, 201)
    const otherGroupId = otherUserGroup.body.data.id
    assert.equal(
      (
        await request(0, '/groups', {
          method: 'PUT',
          body: JSON.stringify({ productIds: [id], groupIds: [otherGroupId], mode: 'add' }),
        })
      ).status,
      404,
    )
    assert.equal((await request(1, `?groupId=${summerGroupId}`)).status, 404)
    assert.equal(
      (await apiRequest(0, `/product-groups/${batchGroupId}`, { method: 'DELETE' })).status,
      200,
    )
    assert.equal(
      (await apiRequest(0, `/product-groups/${summerGroupId}`, { method: 'DELETE' })).status,
      200,
    )

    const otherSource = {
      ...offer,
      source: 'amazon',
      affiliateUrl: `https://amzn.to/catalog-${stamp}`,
    }
    const second = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [otherSource] }),
    })
    assert.equal(second.body.data.created, 1)
    assert.notEqual(second.body.data.saved[0].id, id)
    assert.equal(
      (
        await request(0, `/${second.body.data.saved[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({ offer: { affiliateUrl: renamedLink.affiliateUrl } }),
        })
      ).status,
      409,
    )
    const manualUrl = `https://meli.la/manual-${stamp}`
    const linkEdit = await request(0, `/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ offer: { affiliateUrl: manualUrl } }),
    })
    assert.equal(linkEdit.status, 200)
    assert.equal(linkEdit.body.data.offer.affiliateUrl, manualUrl)
    const afterLinkReimport = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [renamedLink] }),
    })
    assert.equal(afterLinkReimport.body.data.saved[0].id, id)
    assert.equal(afterLinkReimport.body.data.saved[0].offer.affiliateUrl, manualUrl)

    const sentCampaign = await Campaign.create({
      userId: users[0].id,
      name: 'Catalog identity test',
      offers: [offer],
      groups: [{ id: '123@g.us', name: 'Test' }],
      safety: {
        minDelaySeconds: 8,
        maxDelaySeconds: 25,
        shuffleGroups: true,
        maxPerHour: 120,
        warmupBatchSize: 0,
        warmupPauseFactor: 3,
      },
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
    assert.equal(
      (
        await request(0, `/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ offer: { affiliateUrl: `https://meli.la/manual-new-${stamp}` } }),
        })
      ).status,
      409,
    )

    const flagsResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/campaigns/check-offers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
        body: JSON.stringify({ offers: [renamedLink, otherSource] }),
      },
    )
    assert.equal(flagsResponse.status, 200)
    const flags = (await flagsResponse.json()).data
    assert.deepEqual(
      Object.keys(flags).sort(),
      [
        JSON.stringify(['amazon', offer.productId]),
        JSON.stringify(['mercadolivre', offer.productId]),
      ].sort(),
    )
    assert.equal(flags[JSON.stringify(['mercadolivre', offer.productId])].alreadySent, true)
    assert.equal(flags[JSON.stringify(['amazon', offer.productId])].alreadySent, false)
    const legacyFlagsResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/campaigns/check-offers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens[0]}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          offers: [{ productId: offer.productId, affiliateUrl: offer.affiliateUrl }],
        }),
      },
    )
    assert.equal((await legacyFlagsResponse.json()).data[offer.productId].alreadySent, true)

    const generic = {
      ...offer,
      source: undefined,
      productId: `GEN-${stamp}`,
      affiliateUrl: `https://example.com/a-${stamp}`,
    }
    const genericFirst = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [generic] }),
    })
    const genericId = genericFirst.body.data.saved[0].id
    const genericAgain = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({
        offers: [{ ...generic, affiliateUrl: `https://example.com/b-${stamp}` }],
      }),
    })
    assert.equal(genericAgain.body.data.created, 0)
    assert.equal(genericAgain.body.data.saved[0].id, genericId)
    assert.equal(genericAgain.body.data.saved[0].offer.productId, generic.productId)
    assert.equal(genericAgain.body.data.saved[0].offer.source, undefined)
    const storedGeneric = await SavedProduct.findByPk(genericId)
    assert.equal(storedGeneric.source, null)
    assert.equal(storedGeneric.productId, generic.productId)

    const idless = {
      ...generic,
      productId: undefined,
      affiliateUrl: `https://example.com/idless-${stamp}`,
    }
    const idlessSaved = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: [idless] }),
    })
    const idlessId = idlessSaved.body.data.saved[0].id
    const idlessLog = await CampaignLog.create({
      campaignId: sentCampaign.id,
      groupId: '123@g.us',
      groupName: 'Test',
      offerTitle: idless.title,
      offerUrl: idless.affiliateUrl,
      success: true,
    })
    const idlessLinkEdit = await request(0, `/${idlessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ offer: { affiliateUrl: `https://example.com/idless-new-${stamp}` } }),
    })
    assert.equal(idlessLinkEdit.status, 409)
    await idlessLog.update({
      offerIdentity: offerIdentity({ savedProductId: idlessId, affiliateUrl: idless.affiliateUrl }),
    })
    const catalogLinkEdit = await request(0, `/${idlessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ offer: { affiliateUrl: `https://example.com/idless-new-${stamp}` } }),
    })
    assert.equal(catalogLinkEdit.status, 200)
    assert.equal(catalogLinkEdit.body.data.offer.savedProductId, idlessId)

    const bulk = Array.from({ length: 101 }, (_, index) => ({
      ...offer,
      source: 'test',
      productId: `BULK-${stamp}-${index}`,
      affiliateUrl: `https://example.com/bulk-${stamp}-${index}`,
    }))
    assert.equal(
      (
        await request(0, '', {
          method: 'POST',
          body: JSON.stringify({ offers: bulk.slice(0, 100) }),
        })
      ).body.data.created,
      100,
    )
    assert.equal(
      (await request(0, '', { method: 'POST', body: JSON.stringify({ offers: bulk.slice(100) }) }))
        .body.data.created,
      1,
    )
    const firstPage = await request(0, '?limit=100&offset=0')
    const secondPage = await request(0, '?limit=100&offset=100')
    assert.equal(firstPage.body.data.total, 105)
    assert.equal(firstPage.body.data.items.length, 100)
    assert.equal(secondPage.body.data.items.length, 5)

    const otherList = await request(1)
    assert.equal(otherList.body.data.total, 0)
    assert.equal((await request(1, `/${id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await request(0, `/${id}`, { method: 'DELETE' })).status, 200)
    assert.equal(
      (await request(0, `/${second.body.data.saved[0].id}`, { method: 'DELETE' })).status,
      200,
    )
    assert.equal((await request(0, `/${genericId}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(0, `/${idlessId}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(0)).body.data.total, 101)
    const largeBatch = Array.from({ length: 501 }, (_, index) => ({
      ...offer,
      productId: `LARGE-${stamp}-${index}`,
      affiliateUrl: `https://example.com/large-${stamp}-${index}`,
    }))
    const tooLarge = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: largeBatch }),
    })
    assert.equal(tooLarge.status, 400)
    assert.equal((await request(0)).body.data.total, 101)
    const fullBatch = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({ offers: largeBatch.slice(0, 500) }),
    })
    assert.equal(fullBatch.status, 200)
    assert.equal(fullBatch.body.data.created, 500)
    assert.equal(fullBatch.body.data.saved.length, 500)
    assert.equal((await request(0)).body.data.total, 601)
    assert.equal((await request(1)).body.data.total, 0)
  } finally {
    if (server)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    for (const user of users) await user.destroy()
    await sequelize.close()
  }
})
