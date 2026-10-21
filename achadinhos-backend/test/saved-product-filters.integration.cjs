const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
require('reflect-metadata')

// Dedicated disposable database only; never fall through to the app's .env.
const url = new URL(process.env.CATALOG_TEST_DATABASE_URL || 'postgresql://localhost/disabled')
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.startsWith('/catalog_qol'))
process.env.DATABASE_URL = url.href
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'catalog-local-test-secret-at-least-thirty-two'
const { sequelize } = require('../dist/database/index.js')
const { SavedProduct } = require('../dist/database/models/SavedProduct.js')
const { ProductGroup } = require('../dist/database/models/ProductGroup.js')
const { SavedProductGroupMembership } = require('../dist/database/models/SavedProductGroupMembership.js')
const { SavedProductService } = require('../dist/services/SavedProductService.js')
const { SavedProductController } = require('../dist/controllers/SavedProductController.js')

test('catalog filters cover the full tenant population before count and pagination', async (t) => {
  try {
    for (const model of [SavedProduct, ProductGroup, SavedProductGroupMembership]) await model.sync({ force: true })
    const products = await SavedProduct.bulkCreate(Array.from({ length: 132 }, (_, i) => {
      const target = i < 3 || i === 131
      const offer = { title: target ? 'Agulha 100%_ especial' : `Comum ${i}`, productId: `SKU-${i}`, affiliateUrl: `https://example.com/${i}`, discountedPrice: 10, category: 'C' }
      return {
        userId: i === 131 ? 2 : 1, offer, affiliateUrl: offer.affiliateUrl,
        affiliateUrlHash: createHash('sha256').update(offer.affiliateUrl).digest('hex'),
        classifications: i === 130 ? {} : { default: { category: 'A', profileName: 'Casa' }, ...(target ? { 7: { category: 'B', profileName: 'Arquivado oficina' } } : {}), ...(i === 131 ? { 9: { category: 'D', profileName: 'Privado' } } : {}) },
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      }
    }))
    const group = await ProductGroup.create({ userId: 1, name: 'Selecionados' })
    const foreign = await ProductGroup.create({ userId: 2, name: 'Outro usuário' })
    await SavedProductGroupMembership.bulkCreate([...products.slice(0, 2), products[131]].map((p) => ({ savedProductId: p.id, productGroupId: group.id })))
    const service = new SavedProductService()
    const controller = new SavedProductController(service, {})
    const list = async (query = {}, userId = 1) => {
      let data
      await controller.list({ query, user: { userId } }, { json: (body) => { data = body.data } })
      return data
    }
    await t.test('search reaches older products beyond the initial 100, with literal percent and underscore', async () => {
      const first = await list({ search: 'AGULHA 100%_', limit: '2' })
      assert.equal(first.total, 3)
      assert.deepEqual(first.items.map((p) => p.id), [products[2].id, products[1].id])
      const second = await list({ search: 'agulha 100%_', limit: '2', offset: '2' })
      assert.equal(second.total, 3)
      assert.deepEqual(second.items.map((p) => p.id), [products[0].id])
      assert.equal((await list({ search: "' OR 1=1 --" })).total, 0)
    })
    await t.test('search covers IDs, affiliate URLs and archived classification names', async () => {
      assert.equal((await list({ search: 'SKU-130' })).total, 1)
      assert.equal((await list({ search: 'example.com/130' })).total, 1)
      assert.equal((await list({ search: 'arquivado oficina' })).total, 3)
      const options = (await list({ search: 'no match' })).classificationProfiles
      assert.ok(options.some((p) => p.id === '7'), 'archived profiles stay available even without page matches')
      assert.ok(!options.some((p) => p.id === '9'), 'profile options must not leak another tenant')
    })
    await t.test('profile and category match the same classification, with legacy fallback only for empty classifications', async () => {
      assert.equal((await list({ category: 'B' })).total, 3)
      assert.equal((await list({ profileId: '7', category: 'A' })).total, 0)
      assert.equal((await list({ profileId: '7', category: 'B' })).total, 3)
      assert.equal((await list({ category: 'C' })).total, 1)
      assert.equal((await list({ profileId: '99' })).total, 0)
    })
    await t.test('combined group filtering and count stay tenant scoped', async () => {
      assert.equal((await list({ groupId: String(group.id), profileId: '7', category: 'B', search: 'agulha' })).total, 2)
      assert.equal((await list({ search: 'agulha' }, 2)).total, 1)
      await assert.rejects(list({ groupId: String(foreign.id) }), /não encontrado/)
    })
    await t.test('malformed filters are rejected instead of silently broadening the query', async () => {
      for (const query of [{ search: ['a', 'b'] }, { search: 'a'.repeat(301) }, { profileId: 'bad' }, { category: 'E' }, { groupId: '0' }, { limit: '0' }, { offset: '-1' }]) await assert.rejects(list(query))
    })
  } finally {
    await sequelize.close()
  }
})
