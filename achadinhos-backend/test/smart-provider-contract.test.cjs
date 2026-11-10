const { test } = require('node:test')
const assert = require('node:assert/strict')
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters'
process.env.AI_ENABLED = 'true'
process.env.OPENROUTER_KEY = 'test-provider-contract-key'
process.env.SMART_CLASSIFICATION_MODEL = 'deepseek/deepseek-v4.1-flash'
process.env.AI_INPUT_COST_USD_PER_MILLION = '0.2'
process.env.AI_OUTPUT_COST_USD_PER_MILLION = '0.8'

const { SmartCampaignIntelligence, OpenRouterStructuredClient } = require('../dist/services/SmartCampaignIntelligence.js')
const fit = { score: 20, reason: 'Pouca afinidade.', category: 'geral', seasonalScore: 10 }
const analysis = { fits: { masculino: fit, domestica: fit }, political: false, warnings: [] }
const offer = title => ({ title, discountedPrice: 100, affiliateUrl: 'https://example.com/synthetic', commissioned: true, commissionPercent: '10%' })

test('Muse Ember keeps mandatory reasoning within the bounded structured request', async () => {
  const { z } = require('zod')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'meta/muse-ember')
    assert.deepEqual(body.reasoning, { effort: 'low', exclude: true })
    assert.equal(body.max_tokens, 100)
    assert.equal(body.provider.data_collection, 'deny')
    assert.equal(body.provider.max_price.completion, 0.8)
    const content = body.messages.find(message => message.role === 'user').content
    assert.equal(content.find(part => part.type === 'image_url').image_url.url, 'https://http2.mlstatic.com/D_NQ_NP_123-MLB456-O.webp')
    assert.ok(content.some(part => part.type === 'text' && part.text.includes('p0')))
    return new Response(JSON.stringify({ id: 'muse-contract', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const result = await new OpenRouterStructuredClient().generate({ model: 'meta/muse-ember', schema: z.object({ ok: z.boolean() }), schemaName: 'muse_contract', system: 'Return JSON.', prompt: 'ok true', maxOutputTokens: 100, images: [{ id: 'p0', url: 'https://http2.mlstatic.com/D_NQ_NP_123-MLB456-O.webp' }] })
    assert.deepEqual(result.object, { ok: true })
  } finally { globalThis.fetch = originalFetch }
})

test('real SDK sends required product/audience properties and normalizes the provider reply', async () => {
  const originalFetch = globalThis.fetch
  let wireReply
  const requests = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    const schema = body.response_format.json_schema.schema
    assert.equal(body.model, 'deepseek/deepseek-v4.1-flash')
    const checkAnalysis = schema => {
      assert.equal(schema.properties.fits.type, 'object')
      assert.deepEqual([...schema.properties.fits.required].sort(), ['domestica', 'masculino'])
      assert.equal(schema.properties.fits.additionalProperties, false)
      assert.ok(schema.required.includes('political'))
      assert.equal(schema.properties.political.type, 'boolean')
    }
    if (schema.properties.products) {
      assert.deepEqual(schema.properties.products.required, ['p0', 'p1'])
      assert.equal(schema.properties.products.additionalProperties, false)
      checkAnalysis(schema.properties.products.properties.p0)
    } else checkAnalysis(schema)
    return new Response(JSON.stringify({
      id: 'synthetic-contract-test', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(wireReply) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const client = new OpenRouterStructuredClient()
    const intelligence = new SmartCampaignIntelligence({ async generate(request) {
      const batch = request.schemaName.endsWith('_batch')
      // Reverse property order to prove output association is by identity, not order.
      wireReply = batch ? { products: { p1: analysis, p0: analysis } } : analysis
      return client.generate(request)
    } })
    for (const products of [[offer('Produto')], [offer('Produto'), offer('Outro produto')]]) {
      const results = await intelligence.analyze(products, ['domestica', 'masculino'], '2026-10-22')
      assert.deepEqual(results.map(r=>r.index), products.map((_,i)=>i))
      assert.ok(results.every(r=>r.fits.map(f=>f.slug).join(',') === 'domestica,masculino'))
    }
    assert.equal(requests.length, 2)
    const invalid = new SmartCampaignIntelligence({ async generate(request) {
      wireReply = { fits: { domestica: fit }, political: false, warnings: [] }
      return client.generate(request)
    } })
    await assert.rejects(invalid.analyze([offer('Resposta incompleta')], ['domestica', 'masculino'], '2026-10-22'), error => {
      assert.equal(error.details.category, 'structured_output')
      assert.equal(error.details.cause, 'schema_validation')
      assert.ok(error.details.validationIssues.some(issue => issue.path === 'fits.masculino'))
      return true
    })
    const recoverySizes = []
    const recovering = new SmartCampaignIntelligence({ async generate(request) {
      const batch = request.schemaName.endsWith('_batch')
      recoverySizes.push(batch ? JSON.parse(request.prompt).productData.length : 1)
      wireReply = batch ? { products: { p0: analysis } } : analysis
      return client.generate(request)
    } })
    const recovered = await recovering.analyze([offer('Produto A'), offer('Produto B')], ['domestica', 'masculino'], '2026-10-22')
    assert.deepEqual(recoverySizes, [2, 1, 1])
    assert.deepEqual(recovered.map(r=>r.index), [0, 1])
  } finally { globalThis.fetch = originalFetch }
})
