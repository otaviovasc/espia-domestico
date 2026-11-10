const { test } = require('node:test')
const assert = require('node:assert/strict')
process.env.SMART_CLASSIFICATION_MODEL = 'meta/muse-ember'
process.env.SMART_COPY_MODEL = 'meta/muse-ember'
process.env.SMART_KEYWORD_MODEL = 'meta/muse-ember'
const { SmartCampaignIntelligence, smartProductImage, safeSmartCaption } = require('../dist/services/SmartCampaignIntelligence')
const image = 'https://http2.mlstatic.com/D_NQ_NP_123456-MLB99999999999_112026-O.webp'
const fit = { score: 90, reason: 'Uso direto na cozinha.', category: 'Cozinha', seasonalScore: 30 }

test('Muse evidence keeps product image identities and reclassifies when the image changes', async () => {
  const requests = []
  const intelligence = new SmartCampaignIntelligence({ async generate(request) {
    requests.push(request)
    assert.match(request.prompt, /shortCaption/)
    assert.equal(request.images.length, 1)
    assert.equal(request.maxOutputTokens, 2400, 'Mandatory reasoning needs room before the JSON answer')
    return request.providerSchema.parse({ fits: { domestica: fit }, political: false, warnings: [], shortCaption: 'PRATICIDADE PARA COZINHAR TODOS OS DIAS' })
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
  for (const value of ['SÓ HOJE R$ 10', '50% DE DESCONTO', 'Entrega garantida', 'https://example.invalid', 'CURA GARANTIDA', 'ÚLTIMAS UNIDADES', 'linha\nextra', '{}']) assert.equal(safeSmartCaption(value), '')
  assert.equal(safeSmartCaption('  ORGANIZAÇÃO PARA OS SEUS SAPATOS  '), 'ORGANIZAÇÃO PARA OS SEUS SAPATOS')
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
