const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dailyDiscoveryKeywords, dailyDiscoveryPage, DAILY_DISCOVERY_MAX_KEYWORD_ROUNDS, DAILY_DISCOVERY_ROUND_SIZE } = require('../dist/utils/dailyDiscovery')
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

for (const slug of ['domestica', 'masculino']) {
  test(`${slug} discovery expands beyond the wire limit, preserves base priority and terminates`, () => {
    const base = [' CÂMERA ', 'camera', 'panela, cafeteira', '', 'x'.repeat(201)]
    const first = dailyDiscoveryKeywords(slug, base, 0)
    assert.equal(DAILY_DISCOVERY_ROUND_SIZE, 50)
    assert.deepEqual(first.slice(0, 3), ['CÂMERA', 'panela', 'cafeteira'])
    const all = []
    let round = 0
    for (; round < 20; round++) {
      const keywords = dailyDiscoveryKeywords(slug, base, round)
      assert.deepEqual(keywords, dailyDiscoveryKeywords(slug, base, round))
      assert.ok(keywords.length <= 50)
      assert.ok(keywords.every(term => term.length <= 200))
      if (!keywords.length) break
      all.push(...keywords)
    }
    assert.ok(round < 20, 'keyword bank must terminate without cycling')
    assert.ok(all.length >= 300, 'audience bank must provide at least 300 relevant terms')
    for (let page = 0; page < 5; page++) {
      assert.equal(dailyDiscoveryKeywords(slug, [], page).length, 50, 'five full pages support the 250-candidate cap')
    }
    const bank = Array.from({ length: 20 }, (_, page) => dailyDiscoveryKeywords(slug, [], page)).flat()
    assert.ok(bank.length >= 300, 'bank size must not depend on supplied base terms')
    assert.equal(new Set(bank.map(normalize)).size, bank.length)
    assert.equal(new Set(all.map(normalize)).size, all.length)
    assert.deepEqual(dailyDiscoveryKeywords(slug, base, round + 1), [])
  })
}
test('audience banks differ and invalid rounds cannot silently restart discovery', () => {
  assert.notDeepEqual(dailyDiscoveryKeywords('domestica', [], 1), dailyDiscoveryKeywords('masculino', [], 1))
  for (const round of [-1, 0.5, NaN, Infinity]) assert.throws(() => dailyDiscoveryKeywords('domestica', [], round), RangeError)
})

for (const slug of ['domestica', 'masculino']) {
  test(`${slug} date rotation is repeatable, covers disjoint pages and has one broad hub fallback`, () => {
    const date = '2026-11-11'
    const base = ['panela', 'Panela', 'café, CAFÉ']
    const first = dailyDiscoveryKeywords(slug, base, 0, date)
    assert.deepEqual(first, dailyDiscoveryKeywords(slug, base, 0, date))
    assert.notDeepEqual(first, dailyDiscoveryKeywords(slug, base, 0, '2026-11-12'))
    const all = []
    let round = 0
    for (; round <= DAILY_DISCOVERY_MAX_KEYWORD_ROUNDS; round++) {
      const page = dailyDiscoveryPage(slug, base, round, date)
      assert.ok(Array.isArray(page))
      if (!page.length) break
      all.push(...page)
    }
    assert.ok(round <= 16)
    assert.ok(all.length >= 500, 'at least ten pages of audience terms')
    assert.equal(new Set(all.map(normalize)).size, all.length)
    const unrotated = Array.from({ length: 16 }, (_, page) => dailyDiscoveryKeywords(slug, base, page)).flat()
    assert.deepEqual(new Set(all.map(normalize)), new Set(unrotated.map(normalize)))
    assert.deepEqual(dailyDiscoveryPage(slug, base, round, date), [])
    assert.equal(dailyDiscoveryPage(slug, base, round + 1, date), undefined)
    assert.equal(dailyDiscoveryPage(slug, base, 100, date), undefined)
  })
}
test('date rotation validates dates and oversized custom inventories have a hard page bound', () => {
  for (const date of ['2026-02-30', 'not-a-date', '2026-13-01'])
    assert.throws(() => dailyDiscoveryKeywords('domestica', [], 0, date), RangeError)
  const base = Array.from({ length: 2000 }, (_, n) => `produto ${n}`)
  assert.equal(dailyDiscoveryKeywords('domestica', base, 16, '2026-11-11').length, 0)
  assert.deepEqual(dailyDiscoveryPage('domestica', base, 16, '2026-11-11'), [])
  assert.equal(dailyDiscoveryPage('domestica', base, 17, '2026-11-11'), undefined)
})

const { DAILY_DISCOVERY_PRIORITY_SIZE, DAILY_DISCOVERY_EXPLORATION_SIZE } = require('../dist/utils/dailyDiscovery')
const { matchesKeyword, politicalMention } = require('../vendor/affiliate-hub/extractor')
const wordKey = value => normalize(value).match(/[\p{L}\p{N}]+/gu)?.join(' ') || ''
const profiles = {
  domestica: { keywords: 'organizador|panela|hermético|herméticos|aspirador|edredom|secadora|skincare|modelador|necessaire|maquiagem|airfryer|cozinha|liquidificador|cafeteira|toalha|lençol|secador|chapinha|bolsa'.split('|'), negative: ['peça automotiva', 'isca de pesca', 'equipamento industrial', 'medicamento'] },
  masculino: { keywords: 'barbeador|aparador|parafusadeira|furadeira|multímetro|catraca|masculino|automotivo|halter|smartwatch|carteira|bluetooth|ferramenta|chave|tênis|camiseta|bermuda|perfume|fone|mochila'.split('|'), negative: ['maquiagem', 'bolsa feminina', 'vestido feminino', 'peça sem compatibilidade'] },
}
// >=2 unique products meeting all four daily gates, fit-known off-audience <=25%, 2026-11-11 export.
const proven = {
  domestica: 'panela|liquidificador|cafeteira|panelas|cozinha|potes herméticos|aspirador|organizador|caixa organizadora|sapateira|organizador de pia|escorredor de louça|lençol|edredom|cobertor|copo medidor|chaleira|frigideira|secador|escova secadora|shampoo|perfume feminino|airfryer|organizador de geladeira|ralador|peneira'.split('|'),
  masculino: 'furadeira|parafusadeira|smartwatch|masculino|smart tv|fone de ouvido|perfume masculino|compressor de ar|power bank|microfone|tênis masculino|chave de impacto|nível a laser|macaco hidráulico|som automotivo|catraca'.split('|'),
}
const bank = (slug, base = []) => Array.from({ length: 16 }, (_, round) => dailyDiscoveryKeywords(slug, base, round)).flat()

test('raw inventories are unique under the collector word rules and do not collide across audiences', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('../src/utils/dailyDiscovery.ts'), 'utf8')
  for (const slug of ['domestica', 'masculino']) {
    const raw = [...source.matchAll(new RegExp(`${slug}: \x60([^\x60]+)\x60`, 'g'))].flatMap(match => match[1].split('|'))
    assert.ok(raw.length >= 500)
    assert.equal(new Set(raw.map(wordKey)).size, raw.length, 'duplicates must be fixed at source, not hidden by deduplication')
    for (const term of bank(slug, profiles[slug].keywords)) {
      assert.ok(!politicalMention({ title: term }), term)
      assert.ok(!profiles[slug].negative.some(negative => matchesKeyword({ title: term }, negative, 'word') || matchesKeyword({ title: negative }, term, 'word')), term)
    }
  }
  const domestic = new Set(bank('domestica').map(wordKey))
  assert.deepEqual(bank('masculino').filter(term => domestic.has(wordKey(term))), [])
})

for (const slug of ['domestica', 'masculino']) {
  test(`${slug} keeps proven families daily, balances categories and covers every term in bounded first-page exploration`, () => {
    assert.equal(DAILY_DISCOVERY_PRIORITY_SIZE, 30)
    assert.equal(DAILY_DISCOVERY_EXPLORATION_SIZE, 20)
    const base = profiles[slug].keywords
    const inventory = bank(slug, base)
    const k = Math.ceil((inventory.length - DAILY_DISCOVERY_PRIORITY_SIZE) / DAILY_DISCOVERY_EXPLORATION_SIZE)
    const seen = new Set()
    const categories = slug === 'domestica'
      ? [['panela', 'cafeteira'], ['aspirador', 'organizador'], ['lençol', 'edredom'], ['secador', 'perfume feminino']]
      : [['furadeira', 'parafusadeira'], ['smartwatch', 'fone de ouvido'], ['barbeador', 'aparador de barba'], ['tênis masculino', 'camiseta masculina'], ['som automotivo', 'macaco hidráulico']]
    for (let day = 0; day < 366; day++) {
      const date = new Date(Date.UTC(2026, 10, 11 + day)).toISOString().slice(0, 10)
      const page = dailyDiscoveryKeywords(slug, base, 0, date)
      assert.equal(page.length, 50)
      assert.deepEqual(page, dailyDiscoveryKeywords(slug, base, 0, date))
      assert.ok(page.filter(term => proven[slug].includes(term)).length >= (slug === 'domestica' ? 20 : 10))
      assert.ok(categories.every(group => group.some(term => page.includes(term))))
      if (day < k) page.forEach(term => seen.add(wordKey(term)))
    }
    assert.deepEqual(seen, new Set(inventory.map(wordKey)), `full first-page coverage in ${k} days`)
    const all = Array.from({ length: 16 }, (_, round) => dailyDiscoveryKeywords(slug, base, round, '2026-11-11')).flat()
    assert.equal(new Set(all.map(wordKey)).size, all.length)
    assert.deepEqual(new Set(all.map(wordKey)), new Set(inventory.map(wordKey)))
  })
}

test('profile aliases narrow generic words and preserve useful BR spelling/plural variants', () => {
  const male = bank('masculino', profiles.masculino.keywords)
  for (const term of ['bluetooth', 'aparador', 'tênis', 'perfume', 'mochila', 'chave', 'ferramenta', 'camiseta', 'bermuda', 'carteira', 'automotivo']) assert.ok(!male.includes(term), term)
  const female = bank('domestica', profiles.domestica.keywords)
  for (const term of ['bolsa', 'modelador', 'secadora', 'algodão', 'canivete', 'lápis', 'borracha']) assert.ok(!female.includes(term), term)
  for (const term of ['air fryer', 'airfryer', 'panela', 'panelas', 'hermético', 'herméticos', 'capa almofada', 'tônico antioleosidade', 'creme multirreparador']) assert.ok(female.includes(term), term)
  assert.ok(male.includes('chave phillips'))
  assert.equal(matchesKeyword({ title: 'Perfume Feminino Eau De Parfum' }, 'perfume masculino', 'word'), false)
  assert.equal(matchesKeyword({ title: 'Tênis Infantil Menina' }, 'tênis masculino', 'word'), false)
  assert.equal(matchesKeyword({ title: 'Aparador Buffet Sala Madeira' }, 'aparador de barba', 'word'), false)
})

test('oversized custom bases cannot starve built-in priority or exploration', () => {
  const base = Array.from({ length: 2000 }, (_, n) => `produto ${n}`)
  for (const slug of ['domestica', 'masculino']) {
    const all = Array.from({ length: 16 }, (_, round) => dailyDiscoveryKeywords(slug, base, round, '2026-11-11')).flat()
    assert.equal(all.length, 800)
    assert.ok(bank(slug).every(term => all.includes(term)))
    assert.ok(dailyDiscoveryKeywords(slug, base, 0, '2026-11-11').filter(term => proven[slug].includes(term)).length >= 10)
  }
})

test('offline evaluation separates latest products, unknown quality, rejection, attribution and observed demand', () => {
  const { evaluate } = require('../scripts/evaluate-daily-keywords.cjs')
  const product = (productId, title, signals = { rating: 4.8, soldCount: 100 }) => ({ productId, title, extensionEvidence: { visibleSignals: signals } })
  const item = (id, state, fit, score, title = 'Panéla de pressão') => ({ audienceSlug: 'domestica', plan_uuid: 'plan', state, fitScore: fit, score, product: product(id, title) })
  const data = { items: [item('A', 'SELECTED', 90, 80), item('A', 'REJECTED', 40, 80), item('B', 'RESERVE', 85, 70),
    { ...item('C', 'SELECTED', 90, 80), product: product('C', 'panela elétrica', { soldCount: 1000 }) },
    item('D', 'SELECTED', 90, 80, 'Panelada'), { ...item('B', 'SELECTED', 90, 80), audienceSlug: 'masculino' }],
    runs: [{ id: 1, plan_uuid: 'plan', payloads: [{ audienceSlug: 'domestica', cards: [{ productId: 'B', title: 'Panela de pressão', searchMatch: { matchStyle: 'word', keywords: ['panela'] } }] }] }],
    salesNotices: [{ products: ['• Panela de pressão — 1 venda(s)'] }, { products: ['• Panela de pressão — 1 venda(s)'] }] }
  const discovery = { dailyDiscoveryKeywords: (_, base, round) => round === 0 ? ['panela'] : [] }
  const result = evaluate(data, discovery, '2026-11-11', 1).audiences.domestica
  assert.equal(result.observations.matches, 5)
  assert.equal(result.uniqueProducts.matches, 4)
  const keyword = result.perKeyword[0]
  assert.equal(keyword.matches, 3)
  assert.equal(keyword.qualified, 1)
  assert.equal(keyword.qualityUnknown, 1)
  assert.equal(keyword.offAudience, 1)
  assert.equal(keyword.rejected, 1)
  assert.equal(keyword.reserve, 1)
  assert.equal(keyword.directlyAttributedCards, 1)
  assert.equal(keyword.observedSaleProducts, 1)
  assert.equal(result.attributedKeywords[0].qualified, 1)
})

test('offline quality gates reject political, temporary and malformed signals', () => {
  const { metrics } = require('../scripts/evaluate-daily-keywords.cjs')
  const row = { title: 'Panela', fit: 85, score: 80, signals: { rating: 4.8, soldCount: 100 } }
  assert.equal(metrics([row]).qualified, 1)
  assert.equal(metrics([{ ...row, title: 'Camiseta Bolsonaro Presidente' }]).qualified, 0)
  assert.equal(metrics([{ ...row, signals: { ...row.signals, timeLimited: true } }]).qualified, 0)
  assert.equal(metrics([{ ...row, signals: { rating: '4.8', soldCount: 100 } }]).qualified, 0)
  assert.equal(metrics([{ ...row, fit: undefined }]).offAudienceRate, null)
})
