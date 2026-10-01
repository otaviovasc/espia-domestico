const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-thirty-two-characters'
const {
  OfferImportService,
  MAX_IMPORT_PAYLOAD_BYTES,
} = require('../dist/services/OfferImportService.js')
const { CampaignController } = require('../dist/controllers/CampaignController.js')
const { categorizeOffers } = require('../dist/services/OfferCategorizationService.js')
const { DEFAULT_CLASSIFICATION_PROFILE } = require('../dist/dtos/classificationProfile.js')
const offer = (id, extra = {}) => ({
  title: `Produto ${id}`,
  discountedPrice: 100,
  affiliateUrl: `https://example.com/product/${id}`,
  ...extra,
})
const mlCard = (id, extra = {}) => ({
  title: `Produto ${id}`,
  productId: `MLB${id}`,
  commissionedUrl: `https://meli.la/${id}`,
  pricing: { currentAmount: 100 },
  ...extra,
})
const mlPayload = (cards) => ({ schemaVersion: 1, cards })
function controller(evaluator) {
  return new CampaignController(
    {},
    new OfferImportService(),
    {
      async getForUser(userId, profileId) {
        assert.equal(userId, 7)
        assert.equal(profileId, 'default')
        return DEFAULT_CLASSIFICATION_PROFILE
      },
    },
    {
      categorize(offers, profile, options) {
        return categorizeOffers(offers, evaluator, profile, options)
      },
    },
  )
}
async function request(instance, body) {
  let response
  await instance.importOffers(
    { user: { userId: 7 }, body },
    {
      json(value) {
        response = value
      },
    },
  )
  return response.data
}

test('multiple formats normalize independently with stable raw indexes and file provenance', () => {
  const result = new OfferImportService().parsePayloads([
    { name: 'cards.json', json: JSON.stringify(mlPayload([mlCard(1), null, mlCard(2)])) },
    { name: 'flat.json', json: { products: [null, offer('generic')] } },
    { name: 'empty.json', json: [] },
    { name: 'invalid-items.json', json: [null, {}] },
  ])
  assert.equal(result.source, 'mixed')
  assert.equal(result.totalSeen, 7)
  assert.deepEqual(result.offerIndexes, [0, 2, 4])
  assert.deepEqual(result.provenance, [
    { index: 0, fileIndex: 0, itemIndex: 0, fileName: 'cards.json' },
    { index: 2, fileIndex: 0, itemIndex: 2, fileName: 'cards.json' },
    { index: 4, fileIndex: 1, itemIndex: 1, fileName: 'flat.json' },
  ])
  assert.deepEqual(
    result.files.map(({ totalSeen, imported, invalid }) => [totalSeen, imported, invalid]),
    [
      [3, 2, 1],
      [2, 1, 1],
      [0, 0, 0],
      [2, 0, 2],
    ],
  )
  assert.deepEqual(
    result.errors.map(({ index, fileName }) => [index, fileName]),
    [
      [1, 'cards.json'],
      [3, 'flat.json'],
      [5, 'invalid-items.json'],
      [6, 'invalid-items.json'],
    ],
  )
})

test('overlapping files deduplicate source/product and URL aliases, preserving first entries', () => {
  const result = new OfferImportService().parsePayloads([
    { name: 'first.json', json: mlPayload([mlCard(1), mlCard(2)]) },
    {
      name: 'second.json',
      json: [
        offer('new-link', {
          title: 'Later duplicate',
          source: ' MercadoLivre ',
          productId: ' MLB1 ',
        }),
        offer('different-id', {
          affiliateUrl: 'https://meli.la/2',
          source: 'amazon',
          productId: 'OTHER',
        }),
        offer('amazon', { source: 'amazon', productId: 'MLB1' }),
        offer('new-link'),
      ],
    },
  ])
  assert.deepEqual(result.offerIndexes, [0, 1, 4])
  assert.equal(result.offers[0].title, 'Produto 1')
  assert.equal(result.duplicateCount, 3)
  assert.deepEqual(
    result.duplicates.map(({ index, duplicateOf }) => [index, duplicateOf]),
    [
      [2, 0],
      [3, 1],
      [5, 0],
    ],
  )
  assert.deepEqual(
    result.files.map(({ imported, duplicates }) => [imported, duplicates]),
    [
      [2, 0],
      [1, 3],
    ],
  )
})

test('duplicates, invalid items and non-fatal link evidence warnings have distinct counts', () => {
  const result = new OfferImportService().parsePayloads([
    {
      name: 'manual.json',
      json: mlPayload([mlCard(1, { commissionedUrlStatus: 'manual_unverified' }), null]),
    },
    { name: 'overlap.json', json: mlPayload([mlCard(1)]) },
  ])
  assert.equal(result.duplicateCount, 1)
  assert.equal(result.errors.length, 2)
  assert.deepEqual(
    result.files.map(({ imported, invalid, duplicates, warnings }) => [
      imported,
      invalid,
      duplicates,
      warnings,
    ]),
    [
      [1, 1, 0, 1],
      [0, 0, 1, 0],
    ],
  )
  assert.equal(result.offers[0].commissionedUrlStatus, 'manual_unverified')
})

test('later alias bridges merge entire components before selecting earliest winners', async () => {
  const payloads = [
    {
      name: 'first.json',
      json: [
        offer('U1', { source: 'ml', productId: 'P1' }),
        offer('U2', { source: 'ml', productId: 'P2' }),
      ],
    },
    {
      name: 'bridge.json',
      json: [
        offer('U2', { source: 'ml', productId: 'P1' }),
        offer('U3', { source: 'ml', productId: 'P2' }),
      ],
    },
  ]
  let calls = 0
  const result = await request(
    controller(async () => {
      calls++
      return 100
    }),
    { payloads, partialResults: true },
  )
  assert.equal(result.offers.length, 1)
  assert.deepEqual(result.offerIndexes, [0])
  assert.deepEqual(
    result.duplicates.map(({ index, duplicateOf }) => [index, duplicateOf]),
    [
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  )
  assert.deepEqual(
    result.files.map(({ imported, duplicates }) => [imported, duplicates]),
    [
      [1, 1],
      [0, 2],
    ],
  )
  assert.equal(calls, 1)
})

test('malformed second file and structural failures reject before any paid evaluation', async () => {
  let calls = 0
  const instance = controller(async () => {
    calls++
    return 100
  })
  for (const [name, json] of [
    ['broken.json', '{'],
    ['shape.json', { unknown: [] }],
    ['scalar.json', null],
    ['cards-shape.json', { cards: [] }],
  ]) {
    await assert.rejects(
      request(instance, {
        payloads: [
          { name: 'good.json', json: [offer('valid')] },
          { name, json },
        ],
        partialResults: true,
      }),
      (error) => error.statusCode === 400 && error.message.includes(name),
    )
  }
  assert.equal(calls, 0)
})

test('file count, raw combined item count, source format and combined bytes are bounded', () => {
  const service = new OfferImportService()
  assert.throws(
    () =>
      service.parsePayloads(
        Array.from({ length: 51 }, (_, index) => ({ name: `${index}.json`, json: [] })),
      ),
    /50 arquivos/,
  )
  assert.equal(
    service.parsePayloads(
      Array.from({ length: 50 }, (_, index) => ({ name: `${index}.json`, json: [] })),
    ).files.length,
    50,
  )
  const many = (count) => Array.from({ length: count }, () => offer('duplicate'))
  assert.throws(
    () =>
      service.parsePayloads([
        { name: 'first.json', json: many(2500) },
        { name: 'over-limit.json', json: many(2501) },
      ]),
    /over-limit.json.*5000 produtos/,
  )
  const allowed = service.parsePayloads([
    { name: 'first.json', json: many(2500) },
    { name: 'last.json', json: many(2500) },
  ])
  assert.equal(allowed.totalSeen, 5000)
  assert.equal(allowed.offers.length, 1)
  assert.equal(allowed.duplicateCount, 4999)
  assert.throws(
    () => service.parsePayloads([{ name: 'wrong-source.json', json: [], source: 'mercadolivre' }]),
    /wrong-source.json.*incompatível/,
  )
  assert.throws(
    () => service.parsePayloads([{ name: 'unknown-source.json', json: [], source: 'unknown' }]),
    /unknown-source.json.*inválida/,
  )
  assert.throws(
    () =>
      service.parsePayloads([
        { name: 'oversize.json', json: ' '.repeat(MAX_IMPORT_PAYLOAD_BYTES + 1) },
      ]),
    /32 MB/,
  )
})

test('multi-file parse-only returns provenance and duplicates without paid requests', async () => {
  let calls = 0
  const result = await request(
    controller(async () => {
      calls++
      return 100
    }),
    {
      parseOnly: true,
      payloads: [
        { name: 'a.json', json: [offer(1)] },
        { name: 'b.json', json: [offer(1), offer(2)] },
      ],
    },
  )
  assert.equal(calls, 0)
  assert.deepEqual(result.offerIndexes, [0, 2])
  assert.equal(result.files.length, 2)
  assert.equal(result.duplicateCount, 1)
  assert.equal(result.provenance[1].fileName, 'b.json')
  assert.equal(result.categorization.method, 'pending')
})

test('partial multi-file classification evaluates unique items and keeps failure provenance', async () => {
  const calls = []
  const result = await request(
    controller(async (item) => {
      calls.push(item.title)
      if (item.title === 'Produto failed') throw new Error('provider down')
      return 100
    }),
    {
      partialResults: true,
      payloads: [
        { name: 'a.json', json: [offer(1), offer(1)] },
        { name: 'b.json', json: [offer('failed'), offer(2)] },
      ],
    },
  )
  assert.deepEqual(calls, ['Produto 1', 'Produto failed', 'Produto 2'])
  assert.deepEqual(result.offerIndexes, [0, 3])
  assert.deepEqual(
    result.provenance.map(({ index, fileName }) => [index, fileName]),
    [
      [0, 'a.json'],
      [3, 'b.json'],
    ],
  )
  assert.equal(result.categorization.errors[0].index, 2)
  assert.equal(result.categorization.errors[0].fileName, 'b.json')
  assert.equal(result.failedOffers[0].itemIndex, 0)
  assert.equal(result.duplicateCount, 1)
})

test('additive API rejects ambiguous roots and preserves single-json behavior', async () => {
  let calls = 0
  const instance = controller(async () => {
    calls++
    return 100
  })
  await assert.rejects(
    request(instance, { json: [], payloads: [{ name: 'a.json', json: [] }], parseOnly: true }),
    /exclusivamente/,
  )
  await assert.rejects(
    request(instance, {
      payloads: [{ name: 'a.json', json: [] }],
      source: 'mercadolivre',
      parseOnly: true,
    }),
    /separadamente/,
  )
  await assert.rejects(request(instance, { parseOnly: true }), /exclusivamente/)
  const old = await request(instance, { json: [offer(1), offer(1)], parseOnly: true })
  assert.equal(old.offers.length, 2)
  assert.equal(old.provenance, undefined)
  assert.equal(old.files, undefined)
  const empty = await request(instance, {
    payloads: [
      { name: 'empty.json', json: [] },
      { name: 'invalid.json', json: [null] },
    ],
    parseOnly: true,
  })
  assert.equal(empty.offers.length, 0)
  assert.equal(empty.files[1].invalid, 1)
  assert.equal(calls, 0)
})
