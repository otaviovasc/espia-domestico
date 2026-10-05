#!/usr/bin/env node
// Local end-to-end API/database validation. --live adds two paid Jev evaluations.
// --serve keeps the isolated database/API available for browser validation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const backend = path.resolve(__dirname, '../achadinhos-backend')
const fromBackend = (file) => require(path.join(backend, file))
const { Client } = fromBackend('node_modules/pg')
fromBackend('node_modules/dotenv').config({ path: path.join(backend, '.env'), quiet: true })
fromBackend('node_modules/reflect-metadata')

const live = process.argv.includes('--live')
const serve = process.argv.includes('--serve')
const database = `achadinhos_bulk_validation_${Date.now()}`
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'achadinhos-bulk-validation-'))
let server
let sequelize
let adminUrl
let cleaned = false
let interrupted = false
function assertRunning() {
  if (interrupted) throw new Error('Validation interrupted; removing temporary resources.')
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  if (sequelize) await sequelize.close()
  if (adminUrl) {
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.end()
  }
  fs.rmSync(directory, { recursive: true, force: true })
}

async function main() {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'Requires local PostgreSQL')
  const admin = new URL(url)
  admin.pathname = '/postgres'
  adminUrl = admin.href
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  await client.query(`CREATE DATABASE "${database}"`)
  await client.end()
  assertRunning()
  url.pathname = `/${database}`
  process.env.DATABASE_URL = url.href
  process.env.BULK_QA_DATABASE_URL = url.href
  process.env.NODE_ENV = 'test'
  process.env.COOKIE_SECURE = 'false'
  process.env.RUN_SCHEDULER = 'false'
  process.env.LOG_LEVEL = 'error'
  process.env.JWT_SECRET = 'bulk-validation-only-secret-at-least-32-characters'
  const config = path.join(directory, 'sequelize.cjs')
  fs.writeFileSync(config, "module.exports={test:{use_env_variable:'BULK_QA_DATABASE_URL',dialect:'postgres',logging:false}}")
  const migrations = spawnSync(process.execPath, [
    path.join(backend, 'node_modules/sequelize-cli/lib/sequelize'),
    'db:migrate', '--env', 'test', '--config', config,
  ], { cwd: backend, env: process.env, encoding: 'utf8' })
  assert.equal(migrations.status, 0, migrations.stderr || migrations.stdout)
  assertRunning()

  const categorization = fromBackend('dist/services/OfferCategorizationService.js')
  const { OfferCategorizationService, categorizeOffers } = categorization
  const original = OfferCategorizationService.prototype.categorize
  const calls = new Map()
  let active = 0
  let peak = 0
  let realProvider = false
  OfferCategorizationService.prototype.categorize = function (offers, profile, options) {
    if (realProvider) return original.call(this, offers, profile, options)
    return categorizeOffers(offers, async (offer) => {
      const count = (calls.get(offer.title) || 0) + 1
      calls.set(offer.title, count)
      active++
      peak = Math.max(peak, active)
      try {
        await new Promise((resolve) => setTimeout(resolve, 30))
        if (offer.title.includes('Falha temporária') && count === 1) throw Error('QA provider failure')
        return 90
      } finally { active-- }
    }, profile, options)
  }
  ;({ sequelize } = fromBackend('dist/database/index.js'))
  const { registerAssociations, User } = fromBackend('dist/database/models/index.js')
  registerAssociations()
  const bcrypt = fromBackend('node_modules/bcrypt')
  const user = await User.create({
    name: 'Bulk validation', email: 'bulk-qa@example.invalid',
    passwordHash: await bcrypt.hash('Bulk-qa-2026-only', 12), role: 'ADMIN',
  })
  const { generateToken } = fromBackend('dist/middleware/auth.js')
  const token = generateToken(user)
  const { createApp } = fromBackend('dist/app.js')
  const app = fromBackend('node_modules/express')()
  app.get('/__qa/stats', (_req, res) => res.json({
    calls: Object.fromEntries(calls), totalCalls: [...calls.values()].reduce((a, b) => a + b, 0), peak,
  }))
  app.use(createApp())
  server = app.listen(serve ? 3100 : 0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v1`
  const request = async (route, body, expectedStatus = 200) => {
    assertRunning()
    const response = await fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const result = await response.json()
    assertRunning()
    assert.equal(response.status, expectedStatus, JSON.stringify(result))
    return expectedStatus === 200 ? result.data : result
  }
  const offer = (index, prefix = 'API') => ({
    title: `${prefix} Panela ${index}`, discountedPrice: 79.9, originalPrice: 119.9,
    affiliateUrl: `https://meli.la/qa-${prefix}-${index}`, commissionPercent: '12%',
    commissioned: true, source: 'mercadolivre', productId: `${prefix}-${index}`,
  })
  const large = await request('/campaigns/import-offers', {
    json: Array.from({ length: 5000 }, (_, i) => offer(i)), parseOnly: true,
  })
  assert.equal(large.offers.length, 5000)
  assert.equal(calls.size, 0, 'Parse-only must make no paid calls')
  const extensionArg = process.argv.find((arg) => arg.startsWith('--extension-path='))
  const extension = extensionArg
    ? extensionArg.slice('--extension-path='.length)
    : path.resolve(backend, '../../afiliados-extension')
  if (fs.existsSync(path.join(extension, 'src/curation.js'))) {
    const extractor = require(path.join(extension, 'src/extractor.js'))
    const { manualCard, basketExport } = require(path.join(extension, 'src/curation.js'))
    const { compactExport } = require(path.join(extension, 'src/export.js'))
    const full = basketExport([manualCard({
      title: 'Panela manual exportada',
      productUrl: 'https://www.mercadolivre.com.br/panela/p/MLB1234567',
      commissionedUrl: 'https://meli.la/bulk-manual-qa', price: '79,90',
    }, extractor)])
    full.cards[0].visible.commissionPercent = '12%'
    full.cards[0].commission = extractor.commissionEvidence(full.cards[0])
    full.cards[0].searchMatch = { keywords: ['panela'], matchMode: 'any', commission: { minPercent: 10, maxPercent: null, minEstimatedBrl: 5 } }
    full.cards[0].reviewVideos = { source: 'mercado_livre_product_page', requested: 3, found: 1, status: 'shortfall', scanScope: 'loaded_product_page', videos: [{ url: 'https://video-vod-clips.mms.mlstatic.com/example/master.m3u8', kind: 'customer_review', status: 'complete', format: 'ts', filename: '/home/fixture/Downloads/video-1.ts' }] }
    for (const json of [full, compactExport(full)]) {
      const result = await request('/campaigns/import-offers', { json, parseOnly: true })
      assert.equal(result.source, 'mercadolivre')
      assert.equal(result.offers.length, 1)
      assert.equal(result.offers[0].commissionedUrlStatus, 'manual_unverified')
      assert.equal(result.offers[0].discountedPrice, 79.9)
      assert.ok(result.errors.some((item) => item.message.includes('manual_unverified')))
      const offer = result.offers[0]
      assert.equal(offer.extensionEvidence.commission.estimatedBrl, 9.59)
      assert.equal(offer.extensionEvidence.searchMatch.commission.minPercent, 10)
      assert.equal(offer.extensionEvidence.reviewVideos.videos[0].filename, 'video-1.ts')
      const saved = await request('/saved-products', { offers: [{ ...offer, category: 'B' }] })
      const id = saved.saved[0].id
      const listed = await request('/saved-products')
      assert.deepEqual(listed.items.find(item => item.id === id).offer.extensionEvidence, offer.extensionEvidence)
      const response = await fetch(`${base}/saved-products/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
      assert.equal(response.status, 200)
    }
    console.log(JSON.stringify({ extensionExports: ['full', 'compact'], importedCards: 1,
      manualEvidence: 'manual_unverified', paidCalls: 0 }))
  }
  const input = Array.from({ length: 123 }, (_, i) => offer(i))
  input[7].title = 'Falha temporária API 7'
  input[117].title = 'Falha temporária API 117'
  const parsed = await request('/campaigns/import-offers', { json: input, parseOnly: true })
  const successes = []
  const failures = []
  for (let i = 0; i < parsed.offers.length; i += 4) {
    const result = await request('/campaigns/import-offers', {
      json: parsed.offers.slice(i, i + 4), partialResults: true,
      classificationProfileSnapshot: parsed.categorization.profileSnapshot,
    })
    successes.push(...result.offers)
    failures.push(...result.failedOffers.map((item) => item.offer))
  }
  assert.equal(successes.length, 121)
  assert.equal(failures.length, 2)
  const retry = await request('/campaigns/import-offers', {
    json: failures, partialResults: true,
    classificationProfileSnapshot: parsed.categorization.profileSnapshot,
  })
  assert.equal(retry.offers.length, 2)
  successes.push(...retry.offers)
  assert.equal([...calls.values()].filter((count) => count === 2).length, 2)
  assert.equal(peak, 4)
  const saved = await request('/saved-products', { offers: successes })
  assert.equal(saved.created, 123)
  const page = await request('/saved-products?limit=100&offset=100')
  assert.equal(page.total, 123)
  assert.equal(page.items.length, 23)
  const preview = await request('/campaigns/preview', { offers: successes })
  assert.equal(preview.length, 123)
  const checks = await request('/campaigns/check-offers', { offers: successes })
  assert.equal(Object.keys(checks).length, 123)
  console.log(JSON.stringify({
    parsedItems: 5000, classifiedItems: successes.length, partialFailures: 2,
    retriedItems: 2, mockEvaluationCalls: 125, peakConcurrency: peak,
    persistedItems: page.total, previewItems: preview.length,
    deliveryCheckItems: Object.keys(checks).length,
  }))
  const beforeMulti = [...calls.values()].reduce((sum, count) => sum + count, 0)
  const multiOffer = (index) => offer(index, 'Multi')
  const mlCard = (item) => ({
    productId: item.productId, title: item.title,
    productUrl: 'https://www.mercadolivre.com.br/p/MLB1234567',
    commissionedUrl: item.affiliateUrl, commissionedUrlStatus: 'present_on_card',
    pricing: { currentAmount: item.discountedPrice, originalAmount: item.originalPrice, currency: 'BRL' },
    commissionPercent: item.commissionPercent,
  })
  const failingMulti = { ...multiOffer(60), title: 'Falha temporária Multi 60' }
  const payloads = [
    { name: 'generic-a.json', json: [...Array.from({ length: 60 }, (_, i) => multiOffer(i)), { title: 'Invalid without URL or price' }] },
    { name: 'mercadolivre.json', json: {
      sourceUrl: 'https://www.mercadolivre.com.br/afiliados/hub',
      cards: [mlCard(multiOffer(0)), mlCard(failingMulti)],
    } },
    { name: 'generic-b.json', json: { products: [multiOffer(2), multiOffer(60), multiOffer(61)] } },
  ]
  const multi = await request('/campaigns/import-offers', { payloads, parseOnly: true })
  assert.equal(multi.totalSeen, 66)
  assert.equal(multi.offers.length, 62)
  assert.equal(multi.duplicateCount, 3)
  assert.equal(multi.provenance.length, 62)
  assert.deepEqual(multi.offerIndexes.slice(-2), [62, 65])
  assert.deepEqual(multi.provenance.slice(-2).map(({ fileName, itemIndex }) => ({ fileName, itemIndex })), [
    { fileName: 'mercadolivre.json', itemIndex: 1 }, { fileName: 'generic-b.json', itemIndex: 2 },
  ])
  assert.equal(multi.files[0].invalid, 1)
  assert.equal([...calls.values()].reduce((sum, count) => sum + count, 0), beforeMulti)
  const invalidFile = await request('/campaigns/import-offers', {
    payloads: [payloads[0], { name: 'broken.json', json: '{not valid JSON' }],
    partialResults: true,
  }, 400)
  assert.ok(invalidFile.error.message.includes('broken.json'))
  assert.equal([...calls.values()].reduce((sum, count) => sum + count, 0), beforeMulti)
  const multiSuccesses = []
  const multiFailures = []
  for (let i = 0; i < multi.offers.length; i += 4) {
    const result = await request('/campaigns/import-offers', {
      json: multi.offers.slice(i, i + 4), partialResults: true,
      classificationProfileSnapshot: multi.categorization.profileSnapshot,
    })
    multiSuccesses.push(...result.offers)
    multiFailures.push(...result.failedOffers.map((item) => item.offer))
  }
  assert.equal(multiSuccesses.length, 61)
  assert.equal(multiFailures.length, 1)
  const multiRetry = await request('/campaigns/import-offers', {
    json: multiFailures, partialResults: true,
    classificationProfileSnapshot: multi.categorization.profileSnapshot,
  })
  multiSuccesses.push(...multiRetry.offers)
  assert.equal(multiSuccesses.length, 62)
  const multiCalls = [...calls.entries()].filter(([title]) => title.includes('Multi'))
  assert.equal(multiCalls.length, 62)
  assert.equal(multiCalls.reduce((sum, [, count]) => sum + count, 0), 63)
  assert.equal(multiCalls.filter(([, count]) => count > 1).length, 1)
  const multiSaved = await request('/saved-products', { offers: multiSuccesses })
  assert.equal(multiSaved.created, 62)
  console.log(JSON.stringify({ multiFiles: 3, rawItems: 66, uniqueItems: 62,
    duplicates: 3, invalidItems: 1, mockEvaluations: 63, retriedItems: 1,
    persistedMultiItems: multiSaved.created, malformedFilePaidCalls: 0 }))
  if (live) {
    assertRunning()
    assert.ok(process.env.OPENROUTER_KEY, '--live requires OPENROUTER_KEY')
    realProvider = true
    try {
      const result = await request('/campaigns/import-offers', {
        json: [offer(1, 'Live'), {
          ...offer(2, 'Live'), title: 'Batom vermelho para maquiagem',
          description: 'Cosmético para maquiagem pessoal.',
        }], partialResults: true,
      })
      assert.equal(result.offers.length, 2, JSON.stringify(result.categorization.errors))
      assert.ok(result.offers.every((item) => Number.isFinite(item.relevanceScore) && item.category))
      console.log(JSON.stringify({ liveProvider: 'typesafe/jev-1.13', paidItems: 2,
        results: result.offers.map(({ title, category, relevanceScore }) => ({ title, category, relevanceScore })) }))
    } finally { realProvider = false }
  }
  if (serve) {
    console.log(`Browser QA API running at ${base}. Login: bulk-qa@example.invalid / Bulk-qa-2026-only`)
    console.log('Provider is mocked after any live smoke. The database is removed on SIGINT/SIGTERM.')
  } else await cleanup()
}

// Wait for setup or the current request before dropping the database, so an
// interrupt cannot race CREATE DATABASE or delete a database still in use.
let run
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true
    void Promise.resolve(run).then(cleanup).then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  })
}
run = main().catch(async (error) => {
  console.error(error.message)
  await cleanup()
  process.exitCode = 1
})
