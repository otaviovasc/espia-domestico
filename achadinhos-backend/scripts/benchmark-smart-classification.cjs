#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const fixtureArgument = process.argv.slice(2).find((value) => value.startsWith('--fixture='))
const fixtureName =
  fixtureArgument?.slice('--fixture='.length) === 'heldout' ? 'heldout' : 'benchmark'
const fixturePath = path.resolve(
  __dirname,
  `../test/fixtures/smart-classification-${fixtureName}.json`,
)
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const args = new Set(process.argv.slice(2))
const live = args.has('--live')
const smoke = args.has('--smoke')
const providerFallback = args.has('--provider-fallback')
const modelArgument = process.argv.slice(2).find((value) => value.startsWith('--models='))
const models = (
  modelArgument?.slice('--models='.length) ||
  process.env.SMART_BENCHMARK_MODELS ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

function validateFixture(data) {
  if (data.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error('Invalid fixture metadata')
  if (!Array.isArray(data.audiences) || data.audiences.length !== 5)
    throw new Error('Fixture must include five audiences')
  const expectedSize = data.purpose === 'heldout' ? [8, 8] : [20, 30]
  if (
    !Array.isArray(data.cases) ||
    data.cases.length < expectedSize[0] ||
    data.cases.length > expectedSize[1]
  )
    throw new Error(`Fixture must include ${expectedSize[0]}-${expectedSize[1]} cases`)
  const ids = new Set()
  for (const item of data.cases) {
    if (!item.id || ids.has(item.id) || !item.title)
      throw new Error(`Invalid or duplicate fixture case: ${item.id}`)
    ids.add(item.id)
    for (const slug of data.audiences) {
      const range = item.expected?.[slug]
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isFinite) ||
        range[0] < 0 ||
        range[1] > 100 ||
        range[0] > range[1]
      ) {
        throw new Error(`Invalid ${slug} range for ${item.id}`)
      }
    }
  }
}

validateFixture(fixture)

if (!live) {
  console.log(
    JSON.stringify(
      {
        mode: 'offline',
        fixture: path.relative(process.cwd(), fixturePath),
        cases: fixture.cases.length,
        audiences: fixture.audiences,
        status: 'valid',
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (!process.env.OPENROUTER_KEY) throw new Error('OPENROUTER_KEY is required only with --live')
if (!models.length)
  throw new Error('Pass --models=model-a,model-b or SMART_BENCHMARK_MODELS with --live')

async function benchmark(modelId) {
  const [{ generateObject }, { createOpenRouter }] = await Promise.all([
    import('ai'),
    import('@openrouter/ai-sdk-provider'),
  ])
  const { SmartCampaignIntelligence } = require('../dist/services/SmartCampaignIntelligence.js')
  let estimatedCostUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_KEY })
  const generate = async (request) => {
    const result = await generateObject({
      model: openrouter(modelId, {
        provider: {
          allow_fallbacks: providerFallback,
          require_parameters: true,
          data_collection: 'deny',
          max_price: {
            prompt: Number(process.env.AI_INPUT_COST_USD_PER_MILLION ?? 0.2),
            completion: Number(process.env.AI_OUTPUT_COST_USD_PER_MILLION ?? 0.8),
          },
        },
        reasoning: { enabled: false },
        usage: { include: true },
      }),
      schema: request.providerSchema ?? request.schema,
      schemaName: request.schemaName,
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: Math.min(request.maxOutputTokens, 4000),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(30_000),
    })
    const usage = result.usage || {}
    inputTokens += usage.inputTokens || 0
    outputTokens += usage.outputTokens || 0
    estimatedCostUsd += Number(result.providerMetadata?.openrouter?.usage?.cost || 0)
    return result.object
  }
  const intelligence = new SmartCampaignIntelligence({ generate })
  const offers = fixture.cases.map(({ title, description }, index) => ({
    title,
    description,
    discountedPrice: 100 + index,
    affiliateUrl: `https://example.com/benchmark/${index}`,
    commissioned: true,
    commissionPercent: '10%',
  }))
  const started = performance.now()
  const analyses = await intelligence.analyze(offers, fixture.audiences, fixture.date)
  let smokeResult
  if (smoke) {
    const { z } = require('zod')
    const packs = await intelligence.keywordPacks(fixture.date, fixture.audiences)
    const intro = await intelligence.standoutCopy(offers[0], fixture.audiences[0])
    const relevance = await generate({
      schema: z.object({ score: z.number().int().min(0).max(100) }).strict(),
      schemaName: 'offer_niche_relevance_smoke',
      system:
        'Você avalia relevância de produto. Retorne somente o objeto do schema. Não invente fatos.',
      prompt: JSON.stringify({
        niche: 'Produtos para pesca esportiva.',
        productData: { title: 'Molinete de pesca', description: 'Molinete para vara de pesca.' },
      }),
      maxOutputTokens: 80,
    })
    smokeResult = {
      keywordPacks: packs.length,
      keywordUsedAI: packs.every(({ reason }) => !reason.startsWith('Fallback determinístico')),
      standoutCopyValid: typeof intro === 'string' && intro.length <= 220,
      manualRelevanceValid: Number.isInteger(relevance.score) && relevance.score >= 0,
    }
  }
  const elapsedMs = Math.round(performance.now() - started)
  let insideRange = 0
  let scored = 0
  const confusion = {
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
    ambiguous: 0,
  }
  const misses = []
  for (const analysis of analyses) {
    const expected = fixture.cases[analysis.index].expected
    for (const fit of analysis.fits) {
      const [minimum, maximum] = expected[fit.slug]
      scored++
      if (fit.score >= minimum && fit.score <= maximum) insideRange++
      else
        misses.push({
          id: fixture.cases[analysis.index].id,
          slug: fit.slug,
          expected: [minimum, maximum],
          actual: fit.score,
        })
      if (minimum >= fixture.scoreThreshold) {
        if (fit.score >= fixture.scoreThreshold) confusion.truePositive++
        else confusion.falseNegative++
      } else if (maximum < fixture.scoreThreshold) {
        if (fit.score >= fixture.scoreThreshold) confusion.falsePositive++
        else confusion.trueNegative++
      } else confusion.ambiguous++
    }
  }
  return {
    model: modelId,
    cases: fixture.cases.length,
    rangeAccuracy: Number((insideRange / scored).toFixed(4)),
    confusion,
    elapsedMs,
    usage: { inputTokens, outputTokens, estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)) },
    ...(smokeResult ? { smoke: smokeResult } : {}),
    misses: misses.slice(0, 20),
  }
}

;(async () => {
  const results = []
  for (const model of models) {
    try {
      results.push(await benchmark(model))
    } catch (error) {
      results.push({
        model,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Benchmark failed',
        ...(error && typeof error === 'object' && 'code' in error ? { code: error.code } : {}),
        ...(error && typeof error === 'object' && 'details' in error
          ? { details: error.details }
          : {}),
      })
    }
  }
  console.log(
    JSON.stringify(
      { mode: 'live', fixtureVersion: fixture.version, date: fixture.date, results },
      null,
      2,
    ),
  )
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
