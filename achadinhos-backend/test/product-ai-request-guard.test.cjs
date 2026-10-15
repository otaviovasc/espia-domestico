const { test } = require('node:test')
const assert = require('node:assert/strict')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'

const {
  ProductAIRequestGuard,
  estimateAIInputTokens,
} = require('../dist/services/ProductAIRequestGuard.js')

const config = {
  dailyRequestLimit: 10,
  dailyInputTokenLimit: 100_000,
  dailyOutputTokenLimit: 10_000,
  dailyCostLimitMicros: 1_000_000,
  globalDailyCostLimitMicros: 2_000_000,
  requestCostLimitMicros: 100_000,
  maxInputTokens: 20_000,
  maxOutputTokens: 4_000,
  inputCostUsdPerMillion: 0.2,
  outputCostUsdPerMillion: 0.8,
  cacheTtlHours: 24,
}

class MemoryLedger {
  constructor() {
    this.nextId = 1
    this.cache = new Map()
    this.pending = new Map()
  }

  async reserve(input) {
    const scopedCacheKey = `${input.context.userId}:${input.cacheKey}`
    if (this.cache.has(scopedCacheKey)) {
      return { kind: 'cached', value: this.cache.get(scopedCacheKey) }
    }
    const scopedRequestKey = `${input.context.userId}:${input.requestKey}`
    if ([...this.pending.values()].some((item) => item.scopedRequestKey === scopedRequestKey)) {
      const error = new Error('already reserved')
      error.code = 'AI_REQUEST_ALREADY_RESERVED'
      throw error
    }
    const id = this.nextId++
    this.pending.set(id, { scopedCacheKey, scopedRequestKey })
    return { kind: 'reserved', id }
  }

  async succeed(id, value) {
    const pending = this.pending.get(id)
    this.cache.set(pending.scopedCacheKey, value)
  }

  async failUnknown() {}
}

function request(userId, execute) {
  return {
    context: { userId, operationId: `click-${userId}` },
    operation: 'classification',
    model: 'test/model',
    modelVersion: 'classifier:v2',
    semanticInput: { title: 'molinete', niche: 'pesca' },
    providerInput: 'classifique molinete para pesca',
    maxOutputTokens: 80,
    validate: (value) => value,
    execute,
  }
}

test('persistent cache prevents a second provider call for one tenant but never crosses users', async () => {
  const guard = new ProductAIRequestGuard(new MemoryLedger(), config)
  let calls = 0
  const execute = async () => {
    calls++
    return { value: { score: 98 }, usage: { inputTokens: 20, outputTokens: 5 } }
  }

  assert.deepEqual(await guard.run(request(1, execute)), { score: 98 })
  assert.deepEqual(await guard.run(request(1, execute)), { score: 98 })
  assert.equal(calls, 1, 'the tenant cache must satisfy the repeat without network work')

  assert.deepEqual(await guard.run(request(2, execute)), { score: 98 })
  assert.equal(calls, 2, 'a different tenant must own an independent cache entry')
})

test('missing user scope and oversized output fail before provider execution', async () => {
  const guard = new ProductAIRequestGuard(new MemoryLedger(), config)
  let calls = 0
  const execute = async () => {
    calls++
    return { value: { score: 1 } }
  }
  await assert.rejects(
    guard.run({ ...request(undefined, execute), context: undefined }),
    (error) => error.code === 'AI_CONTEXT_REQUIRED',
  )
  await assert.rejects(
    guard.run({ ...request(1, execute), maxOutputTokens: config.maxOutputTokens + 1 }),
    (error) => error.code === 'AI_OUTPUT_TOO_LARGE',
  )
  assert.equal(calls, 0)
})

test('input estimation reserves a strict UTF-8 byte ceiling plus schema/chat overhead', () => {
  assert.ok(estimateAIInputTokens('ação para cães') > Buffer.byteLength('ação para cães'))
  assert.ok(estimateAIInputTokens('x') >= 4_096)
})
