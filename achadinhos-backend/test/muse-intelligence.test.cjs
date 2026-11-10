const { test } = require('node:test')
const assert = require('node:assert/strict')
process.env.SMART_CLASSIFICATION_MODEL = 'meta/muse-ember'
process.env.SMART_COPY_MODEL = 'meta/muse-ember'
process.env.SMART_KEYWORD_MODEL = 'meta/muse-ember'
process.env.AI_ENABLED = 'true'
process.env.OPENROUTER_KEY = 'synthetic-muse-contract-key'
process.env.AI_INPUT_COST_USD_PER_MILLION = '0.2'
process.env.AI_OUTPUT_COST_USD_PER_MILLION = '0.8'
const { SmartCampaignIntelligence, OpenRouterStructuredClient, smartProductImage, safeSmartCaption, groundedSmartCaption } = require('../dist/services/SmartCampaignIntelligence')
const image = 'https://http2.mlstatic.com/D_NQ_NP_123456-MLB99999999999_112026-O.webp'
const fit = { score: 90, reason: 'Uso direto na cozinha.', category: 'Cozinha', seasonalScore: 30 }

test('splitting a batch preserves singleton text and image identities including nonzero IDs', async () => {
  const seen = []
  const intelligence = new SmartCampaignIntelligence({ async generate(request) {
    const data = JSON.parse(request.prompt).productData
    if (Array.isArray(data)) {
      const { AppError } = require('../dist/middleware/Error/AppError')
      throw new AppError('Force a split without any provider call', 503, 'SMART_AI_INVALID_RESPONSE')
    }
    seen.push(data.id)
    assert.equal(request.images[0].id, data.id)
    assert.equal(request.images[0].url, data.id === 'p0' ? image : image.replace('123456', '123457'))
    assert.doesNotMatch(JSON.parse(request.prompt).captionInstructions, /a imagem p0/)
    return request.providerSchema.parse({ fits: { domestica: fit }, political: false, warnings: [], shortCaption: '', captionEvidence: { source: 'none', fact: '' } })
  } })
  const offer = { title: 'Panela', discountedPrice: 100, affiliateUrl: 'https://example.invalid/synthetic', imageUrl: image }
  const result = await intelligence.analyze([offer, { ...offer, title: 'Frigideira', imageUrl: image.replace('123456', '123457') }], ['domestica'], '2026-11-11')
  assert.deepEqual(seen, ['p0', 'p1'])
  assert.deepEqual(result.map(row => row.index), [0, 1])
})

test('Muse evidence keeps product image identities and reclassifies when the image changes', async () => {
  const requests = []
  const intelligence = new SmartCampaignIntelligence({ async generate(request) {
    requests.push(request)
    assert.match(request.prompt, /shortCaption/)
    assert.equal(request.images.length, 1)
    assert.equal(request.maxOutputTokens, 2400, 'Mandatory reasoning needs room before the JSON answer')
    return request.providerSchema.parse({ fits: { domestica: fit }, political: false, warnings: [], shortCaption: 'PRATICIDADE PARA COZINHAR TODOS OS DIAS', captionEvidence: { source: 'title', fact: 'Panela' } })
  } })
  const offer = { title: 'Panela', discountedPrice: 100, affiliateUrl: 'https://example.invalid/synthetic', imageUrl: image }
  for (const url of [image, image.replace('123456', '123457')]) {
    const [result] = await intelligence.analyze([{ ...offer, imageUrl: url }], ['domestica'], '2026-11-11')
    assert.equal(result.shortCaption, 'PRATICIDADE PARA COZINHAR TODOS OS DIAS')
  }
  assert.equal(requests.length, 2, 'A different observed image must not reuse the semantic result')
  assert.equal(requests[0].images[0].id, 'p0')
  assert.equal(requests[0].images[0].url, image)
})

test('unsafe images and commercial/urgent captions fall back without weakening product gates', () => {
  assert.equal(smartProductImage(image), image)
  for (const url of ['http://http2.mlstatic.com/D_NQ_NP_x.jpg', image+'?token=secret', image.replace('http2.mlstatic.com', '127.0.0.1'), image.replace('http2.mlstatic.com', 'http2.mlstatic.com.evil.invalid'), 'data:image/png;base64,aGVsbG8=']) assert.equal(smartProductImage(url), undefined)
  for (const value of ['SÓ HOJE R$ 10', '50% DE DESCONTO', 'Entrega garantida', 'https://example.invalid', 'CURA GARANTIDA', 'ÚLTIMAS UNIDADES', 'linha\nextra', '{}', 'O mais vendido da cozinha', 'Favorito de milhares de clientes', 'Promoção relâmpago só hoje', 'Aproveite a Black Friday', 'Emagrece rápido e elimina gordura', 'Só hoje']) assert.equal(safeSmartCaption(value), '')
  assert.equal(safeSmartCaption('  ORGANIZAÇÃO PARA OS SEUS SAPATOS  '), 'ORGANIZAÇÃO PARA OS SEUS SAPATOS')
})

test('caption evidence rejects props, title echoes, unsupported numbers and image-only specifications', () => {
  const blender = { title: 'Liquidificador Mondial Pratic Turbo', discountedPrice: 100, affiliateUrl: 'https://example.invalid' }
  assert.equal(groundedSmartCaption('Liquidificador Mondial Pratic Turbo com frutas no copo', { source: 'title', fact: blender.title }, blender), '')
  const tv = { ...blender, title: 'Smart TV TCL 43 polegadas QLED com Google TV' }
  assert.equal(groundedSmartCaption(tv.title, { source: 'title', fact: tv.title }, tv), '')
  assert.equal(groundedSmartCaption('Sua tela de 55 polegadas', { source: 'title', fact: tv.title }, tv), '')
  assert.equal(groundedSmartCaption('Inclui controle e pilhas', { source: 'title', fact: tv.title }, tv), '')
  const accessories = { ...tv, description: 'Inclui controle remoto' }
  assert.equal(groundedSmartCaption('Inclui controle e pilhas', { source: 'description', fact: accessories.description }, accessories), '')
  assert.equal(groundedSmartCaption('Praticidade no preparo diário', { source: 'image', fact: 'Liquidificador' }, blender), '')
  assert.equal(groundedSmartCaption('Praticidade no preparo diário', { source: 'title', fact: 'Não existe no título' }, blender), '')
  assert.equal(groundedSmartCaption('Praticidade no preparo diário', { source: 'title', fact: 'Liquidificador' }, blender), 'Praticidade no preparo diário')
  assert.equal(groundedSmartCaption('Capacidade de 5 litros', { source: 'title', fact: '5' }, { ...blender, title: 'Garrafa de 500ml' }), '')
  assert.equal(groundedSmartCaption('Praticidade no preparo diário', { source: 'title', fact: 'a' }, blender), '')
})

test('missing or malformed optional caption evidence preserves fit and political classification', async () => {
  for (const evidence of [undefined, null, { source: 'description', fact: 'x'.repeat(161) }, { source: 'other', fact: 'Unknown' }, { source: 'title', fact: 'Panela', extra: 'ignored' }, 3]) {
    const intelligence = new SmartCampaignIntelligence({ async generate(request) {
      return request.providerSchema.parse({ fits: { domestica: fit }, political: true, warnings: [], shortCaption: 'Praticidade para cozinhar', ...(evidence === undefined ? {} : { captionEvidence: evidence }) })
    } })
    const [result] = await intelligence.analyze([{ title: 'Panela', discountedPrice: 100, affiliateUrl: 'https://example.invalid' }], ['domestica'], '2026-11-11')
    assert.equal(result.political, true)
    assert.equal(result.fits[0].score, 90)
    assert.equal(result.shortCaption, '')
    assert.equal(result.captionEvidence, undefined)
  }
})

test('real SDK wire accepts malformed optional evidence without discarding required political/fit fields', async () => {
  const originalFetch = globalThis.fetch
  let transports = 0
  globalThis.fetch = async (_url, init) => {
    transports++
    const body = JSON.parse(init.body)
    const schema = body.response_format.json_schema.schema
    assert.equal(body.model, 'meta/muse-ember')
    assert.ok(schema.required.includes('political'))
    assert.ok(schema.required.includes('captionEvidence'))
    assert.equal(schema.properties.captionEvidence.type, 'object')
    assert.deepEqual(schema.properties.captionEvidence.required, ['source', 'fact'])
    assert.equal(schema.properties.captionEvidence.properties.source.type, 'string')
    assert.equal(schema.properties.captionEvidence.properties.fact.type, 'string')
    return new Response(JSON.stringify({ id: 'synthetic-muse-evidence', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ fits: { domestica: fit }, political: true, warnings: [], shortCaption: 'Praticidade para cozinhar', captionEvidence: { source: 'title', fact: 'x'.repeat(161) } }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const client = new OpenRouterStructuredClient()
    const [result] = await new SmartCampaignIntelligence({ generate: request => client.generate(request) }).analyze([{ title: 'Panela', discountedPrice: 100, affiliateUrl: 'https://example.invalid' }], ['domestica'], '2026-11-11')
    assert.equal(transports, 1)
    assert.equal(result.shortCaption, '')
    assert.equal(result.political, true)
    assert.equal(result.fits[0].score, 90)
  } finally { globalThis.fetch = originalFetch }
})

test('caption numbers preserve decimal and thousands values and accessories cannot invert negation', () => {
  const offer = { title: 'Liquidificador', discountedPrice: 100, affiliateUrl: 'https://example.invalid' }
  const check = (description, caption, fact = description) => groundedSmartCaption(caption, { source: 'description', fact }, { ...offer, description })
  assert.equal(check('Capacidade de 1,5 litros', 'Capacidade de 5 litros para preparar'), '')
  assert.equal(check('Capacidade de 1,5 litros', 'Capacidade de 1.5 litros para preparar'), 'Capacidade de 1.5 litros para preparar')
  assert.equal(check('Capacidade de 1,5 litros', 'Capacidade de 5 litros para preparar', 'Capacidade de 1 5 litros'), '')
  assert.equal(check('Potência de 1.000 watts', 'Potência de 1 watt no preparo'), '')
  assert.equal(check('Potência de 1.000 watts', 'Potência de 1000 watts no preparo'), 'Potência de 1000 watts no preparo')
  for (const description of ['Não inclui pilhas', 'Não acompanha pilhas', 'Sem pilhas inclusas', 'Nunca inclui pilhas', 'Pilhas não inclusas']) {
    assert.equal(check(description, 'Inclui pilhas'), '', description)
  }
  assert.equal(check('Não inclui pilhas', 'Inclui pilhas', 'inclui pilhas'), '')
  assert.equal(check('Inclui pilhas', 'Inclui pilhas para uso'), 'Inclui pilhas para uso')
  assert.equal(check('Inclui pilhas para uso diário', 'Inclui pilhas para uso diário'), 'Inclui pilhas para uso diário')
  assert.equal(check('Inclui tampa de vidro', 'Inclui tampa de vidro para cozinhar'), 'Inclui tampa de vidro para cozinhar')
  assert.equal(check('Ideal para mexer com colher; acompanha tampa', 'Panela que acompanha tampa e colher'), '')
})

test('a trailing singleton retains p4 and overlong optional copy does not erase political/fit results', async () => {
  let trailing = false
  const intelligence = new SmartCampaignIntelligence({ async generate(request) {
    const product = JSON.parse(request.prompt).productData
    const analysis = { fits: { domestica: fit }, political: true, warnings: [], shortCaption: 'x'.repeat(100), captionEvidence: { source: 'none', fact: '' } }
    if (Array.isArray(product)) return request.providerSchema.parse({ products: Object.fromEntries(product.map(p => [p.id, analysis])) })
    trailing = true
    assert.equal(product.id, 'p4')
    assert.equal(product.imageProvided, true)
    assert.equal(request.images[0].id, 'p4')
    return request.providerSchema.parse(analysis)
  } })
  const offers = Array.from({ length: 5 }, (_, i) => ({ title: `Produto QA ${i}`, imageUrl: image, discountedPrice: 100, affiliateUrl: 'https://example.invalid/synthetic' }))
  const results = await intelligence.analyze(offers, ['domestica'], '2026-11-11')
  assert.equal(trailing, true)
  assert.ok(results.every(result => result.shortCaption === '' && result.political === true && result.fits[0].score === 90))
  assert.ok(results.every(result => result.lineage.model === 'meta/muse-ember' && result.lineage.imageUrlHash && result.lineage.captionHash === null))
})

test('optional copy and keyword requests also reserve room for mandatory Muse reasoning', async () => {
  const intelligence = new SmartCampaignIntelligence({ async generate(request) {
    if (request.schemaName === 'smart_standout_intro') {
      assert.equal(request.maxOutputTokens, 1200)
      return { intro: 'ORGANIZAÇÃO PARA A SUA COZINHA' }
    }
    assert.equal(request.maxOutputTokens, 3800)
    return { packs: [{ slug: 'domestica', keywords: Array.from({ length: 8 }, (_, i) => `panela ${i}`), reason: 'Termos concretos de cozinha.' }] }
  } })
  assert.equal(await intelligence.standoutCopy({ title: 'Panela', discountedPrice: 100, affiliateUrl: 'https://example.invalid' }, 'domestica'), 'ORGANIZAÇÃO PARA A SUA COZINHA')
  const packs = await intelligence.keywordPacks('2026-11-11', ['domestica'])
  assert.equal(packs[0].slug, 'domestica')
})
