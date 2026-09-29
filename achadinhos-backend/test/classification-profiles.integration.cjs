const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
require('reflect-metadata')

const { env } = require('../dist/config/env.js')
const { sequelize } = require('../dist/database/index.js')
const { User, USER_ROLE_ENUM } = require('../dist/database/models/User.js')
const { ClassificationProfileRecord } = require('../dist/database/models/ClassificationProfile.js')
const { SavedProduct } = require('../dist/database/models/SavedProduct.js')
const { createApp } = require('../dist/app.js')
const { generateToken } = require('../dist/middleware/auth.js')

const profile = {
  name: 'Corrida',
  nicheDescription: 'Produtos para corrida de rua, treino e recuperação esportiva.',
  relevanceInstructions: 'Priorize tênis, relógios, hidratação e acessórios para corredores.',
  weights: { relevance: 70, discount: 20, commission: 10 },
  discountCap: 40,
  commissionCap: 20,
  thresholds: {
    aScore: 80,
    aRelevance: 85,
    aDiscount: 10,
    aCommission: 5,
    bScore: 60,
    bRelevance: 60,
    cScore: 40,
    dRelevance: 20,
  },
}

test('classification profile CRUD is user-scoped and keeps the built-in default immutable', async () => {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(databaseHost),
    'Integration test requires local Postgres',
  )

  await sequelize.authenticate()
  const stamp = randomUUID()
  const users = []
  let server
  try {
    for (const suffix of ['a', 'b']) {
      users.push(
        await User.create({
          name: `Profile test ${suffix}`,
          email: `profile-${stamp}-${suffix}@example.invalid`,
          passwordHash: 'not-used-by-this-test',
          role: USER_ROLE_ENUM.MEMBER,
        }),
      )
    }
    server = createApp().listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/v1/classification-profiles`
    const tokens = users.map((user) => generateToken(user))
    const request = async (userIndex, path = '', init = {}) => {
      const response = await fetch(base + path, {
        ...init,
        headers: {
          authorization: `Bearer ${tokens[userIndex]}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      })
      return { status: response.status, body: await response.json() }
    }

    const initial = await request(0)
    assert.equal(initial.status, 200)
    assert.equal(initial.body.data.length, 1)
    assert.equal(initial.body.data[0].id, 'default')
    assert.equal(initial.body.data[0].name, 'Doméstico')
    assert.equal(initial.body.data[0].builtIn, true)

    const invalid = await request(0, '', {
      method: 'POST',
      body: JSON.stringify({
        ...profile,
        weights: { relevance: 70, discount: 10, commission: 10 },
      }),
    })
    assert.equal(invalid.status, 400)

    const created = await request(0, '', { method: 'POST', body: JSON.stringify(profile) })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.builtIn, false)
    assert.match(created.body.data.id, /^[1-9]\d*$/)
    const id = created.body.data.id

    const ownList = await request(0)
    assert.deepEqual(
      ownList.body.data.map((item) => item.id),
      ['default', id],
    )
    assert.deepEqual(
      (await request(1)).body.data.map((item) => item.id),
      ['default'],
    )

    const affiliateUrl = `https://example.com/profile-snapshot-${stamp}`
    const savedProduct = await SavedProduct.create({
      userId: users[0].id,
      source: null,
      productId: null,
      affiliateUrl,
      affiliateUrlHash: createHash('sha256').update(affiliateUrl).digest('hex'),
      offer: {
        title: 'Tênis de corrida',
        discountedPrice: 300,
        affiliateUrl,
        category: 'A',
        classificationProfileId: id,
        classificationProfileName: 'Corrida',
      },
      classifications: {
        [id]: {
          category: 'A',
          relevanceScore: 95,
          profileName: 'Corrida',
          classifiedAt: new Date().toISOString(),
        },
      },
    })

    assert.equal(
      (
        await request(1, `/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...profile, name: 'Tentativa de outro usuário' }),
        })
      ).status,
      404,
    )
    const updated = await request(0, `/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...profile, name: 'Corrida avançada' }),
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.name, 'Corrida avançada')
    assert.equal((await ClassificationProfileRecord.findByPk(Number(id))).name, 'Corrida avançada')
    await savedProduct.reload()
    assert.equal(savedProduct.classifications[id].profileName, 'Corrida avançada')
    assert.equal(savedProduct.offer.classificationProfileName, 'Corrida avançada')

    assert.equal((await request(0, '/default', { method: 'DELETE' })).status, 400)
    assert.equal((await request(1, `/${id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await request(0, `/${id}`, { method: 'DELETE' })).status, 200)
    await savedProduct.reload()
    assert.equal(savedProduct.classifications[id].profileName, 'Corrida avançada')
    assert.deepEqual(
      (await request(0)).body.data.map((item) => item.id),
      ['default'],
    )
  } finally {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
    for (const user of users) await user.destroy()
    await sequelize.close()
  }
})
