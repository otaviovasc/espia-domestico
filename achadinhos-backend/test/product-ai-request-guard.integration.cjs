/*
 * Opt-in persistence/concurrency coverage for the paid AI request ledger.
 * Requires a migrated disposable local Postgres on port 55433.
 */
const { test, after, before } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

process.env.DATABASE_URL ??= 'postgresql://smartqa:smartqa-local-test@127.0.0.1:55433/smartqa'
process.env.JWT_SECRET ??= 'smart-ai-guard-integration-test-secret-32-chars'

const { sequelize } = require('../dist/database/index.js')
const { User } = require('../dist/database/models/User.js')
const { SmartAIRequest } = require('../dist/database/models/SmartAIRequest.js')
const { ProductAIRequestGuard } = require('../dist/services/ProductAIRequestGuard.js')

const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
const users = []

const config = {
  dailyRequestLimit: 20,
  dailyInputTokenLimit: 100_000,
  dailyOutputTokenLimit: 20_000,
  dailyCostLimitMicros: 1_000_000,
  globalDailyCostLimitMicros: 2_000_000,
  requestCostLimitMicros: 100_000,
  maxInputTokens: 20_000,
  maxOutputTokens: 4_000,
  inputCostUsdPerMillion: 0.2,
  outputCostUsdPerMillion: 0.8,
  cacheTtlHours: 24,
}

before(async () => {
  assert.ok(
    localHosts.has(new URL(process.env.DATABASE_URL).hostname),
    'AI guard integration tests require disposable local Postgres',
  )
  await sequelize.authenticate()
})

after(async () => {
  if (users.length) await User.destroy({ where: { id: users.map(({ id }) => id) } })
  await sequelize.close()
})

async function createUser(label) {
  const suffix = randomUUID()
  const user = await User.create({
    name: `AI Guard ${label}`,
    email: `ai-guard-${label}-${suffix}@example.test`,
    passwordHash: 'not-used-by-this-test',
  })
  users.push(user)
  return user
}

function request(userId, semanticInput, execute) {
  return {
    context: { userId, operationId: randomUUID() },
    operation: 'integration_classification',
    model: 'fake/no-network',
    modelVersion: 'integration:v1',
    semanticInput,
    providerInput: JSON.stringify(semanticInput),
    maxOutputTokens: 80,
    validate(value) {
      assert.equal(typeof value.score, 'number')
      return value
    },
    execute,
  }
}

test('database cache is tenant-owned and satisfies a repeat without provider work', async () => {
  const firstUser = await createUser('cache-a')
  const secondUser = await createUser('cache-b')
  const guard = new ProductAIRequestGuard(undefined, config)
  let calls = 0
  const execute = async () => {
    calls++
    return { value: { score: 97 }, usage: { inputTokens: 20, outputTokens: 4 } }
  }
  const semantic = { title: 'molinete', niche: 'pesca' }

  assert.equal((await guard.run(request(firstUser.id, semantic, execute))).score, 97)
  assert.equal((await guard.run(request(firstUser.id, semantic, execute))).score, 97)
  assert.equal(calls, 1)
  assert.equal((await guard.run(request(secondUser.id, semantic, execute))).score, 97)
  assert.equal(calls, 2, 'another user must not receive the first tenant cache row')

  assert.equal(await SmartAIRequest.count({ where: { userId: [firstUser.id, secondUser.id] } }), 2)
})

test('unknown provider outcomes retain their reservation and cannot auto-charge again', async () => {
  const user = await createUser('unknown')
  const guard = new ProductAIRequestGuard(undefined, config)
  let calls = 0
  const execute = async () => {
    calls++
    throw new Error('simulated response loss')
  }
  const input = request(user.id, { title: 'vara de pesca' }, execute)

  await assert.rejects(guard.run(input), /simulated response loss/)
  await assert.rejects(
    guard.run({ ...input, context: { userId: user.id, operationId: randomUUID() } }),
    (error) => error.code === 'AI_REQUEST_ALREADY_RESERVED',
  )
  assert.equal(calls, 1)
})

test('advisory lock makes concurrent daily reservations atomic across guard instances', async () => {
  const user = await createUser('atomic')
  const oneRequest = { ...config, dailyRequestLimit: 1 }
  const first = new ProductAIRequestGuard(undefined, oneRequest)
  const second = new ProductAIRequestGuard(undefined, oneRequest)
  let calls = 0
  const execute = async () => {
    calls++
    return { value: { score: 80 }, usage: { inputTokens: 10, outputTokens: 2 } }
  }

  const settled = await Promise.allSettled([
    first.run(request(user.id, { title: 'produto a' }, execute)),
    second.run(request(user.id, { title: 'produto b' }, execute)),
  ])
  assert.equal(settled.filter(({ status }) => status === 'fulfilled').length, 1)
  const rejected = settled.find(({ status }) => status === 'rejected')
  assert.equal(rejected.reason.code, 'AI_DAILY_BUDGET_EXCEEDED')
  assert.equal(calls, 1, 'rejected reservation must never reach provider execution')
})
