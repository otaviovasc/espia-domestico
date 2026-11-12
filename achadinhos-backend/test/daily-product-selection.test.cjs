const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { dailyDemandScore, dailySelectionReasons } = require('../dist/utils/dailyProductSelection')
const { SmartCampaignService } = require('../dist/services/SmartCampaignService')
const policy = { minRating: 4.5, minSoldCount: 100, minFitScore: 80, minCommercialScore: 70 }
const offer = (signals, extra = {}) => ({ title: 'Panela de pressão', discountedPrice: 100, originalPrice: 130, commissionRate: 10,
  extensionEvidence: { extractedAt: new Date().toISOString(), visibleSignals: signals }, ...extra })

test('visible popularity is useful, but absent evidence is never a high demand score', () => {
  assert.equal(dailyDemandScore(offer(undefined)), 0)
  assert.ok(dailyDemandScore(offer({ rating: 4.8, soldCount: 50000, bestSeller: true })) > dailyDemandScore(offer({ rating: 4.8, soldCount: 100 })))
  assert.ok(dailyDemandScore(offer({ rating: 4.8, soldCount: 100 })) > dailyDemandScore(offer({ rating: 4.8, soldCount: 0 })))
})

test('missing/weak sales evidence and poor audience fit cannot qualify on commission alone', () => {
  assert.ok(dailySelectionReasons(offer(undefined, { commissionRate: 90 }), 95, 90, policy).some(reason => /Vendas/.test(reason)))
  assert.ok(dailySelectionReasons(offer({ rating: 4.0, soldCount: 50000 }), 95, 90, policy).some(reason => /Avaliação abaixo/.test(reason)))
  assert.ok(dailySelectionReasons(offer({ rating: 4.9, soldCount: 50000 }), 60, 90, policy).some(reason => /Afinidade/.test(reason)))
  assert.deepEqual(dailySelectionReasons(offer({ rating: 4.8, soldCount: 50000 }), 95, 85, policy), [])
})

test('daily scoring ranks strong audience/demand evidence over a larger affiliate payout', () => {
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const now = new Date().toISOString()
  const winner = service.commercialScore(offer({ rating: 4.9, soldCount: 50000, bestSeller: true }, { commissionRate: 5 }), 95, 50, now, { dailySelection: policy })
  const payout = service.commercialScore(offer({ rating: 4.5, soldCount: 100 }, { commissionRate: 50 }), 80, 50, now, { dailySelection: policy })
  assert.ok(winner.total > payout.total)
  assert.ok(winner.components.observedDemand > payout.components.observedDemand)
})

test('good non-discounted products can qualify; time-limited deals do not enter an all-day queue', () => {
  const { DailyAutomationConfigSchema } = require('../dist/config/dailyAutomation')
  const config = DailyAutomationConfigSchema.parse({ userId: 1 })
  const offerPolicy = { ...policy, minCommercialScore: config.minCommercialScore }
  const service = new SmartCampaignService({}, {}, {}, {}, {})
  const product = offer({ rating: 4.7, soldCount: 500 }, { originalPrice: undefined })
  const result = service.commercialScore(product, 85, 50, new Date().toISOString(), { dailySelection: offerPolicy })
  assert.deepEqual(dailySelectionReasons(product, 85, result.total, offerPolicy), [])
  assert.ok(dailySelectionReasons(offer({ rating: 4.9, soldCount: 50000, timeLimited: true }), 95, 95, offerPolicy).some(reason => /temporária/.test(reason)))
})

const { dailyCommercialValue, dailyMixedPriceOrder, dailyPriceBand } = require('../dist/utils/dailyCommercialValue')
test('daily commission uses actual BRL price and discounts expensive goods sellability', () => {
  const signals = { rating: 4.9, soldCount: 50000, bestSeller: true }
  const expensive = dailyCommercialValue(offer(signals, { discountedPrice: 1000, commissionRate: 3 }), 95)
  const cheap = dailyCommercialValue(offer(signals, { discountedPrice: 20, commissionRate: 20 }), 95)
  assert.equal(expensive.grossCommissionBrl, 30)
  assert.equal(cheap.grossCommissionBrl, 4)
  assert.ok(expensive.saleEaseIndex < cheap.saleEaseIndex)
  assert.ok(expensive.adjustedCommissionBrl > cheap.adjustedCommissionBrl)
  const sameGross = dailyCommercialValue(offer(signals, { discountedPrice: 100, commissionRate: 30 }), 95)
  assert.equal(sameGross.grossCommissionBrl, expensive.grossCommissionBrl)
  assert.ok(sameGross.adjustedCommissionBrl > expensive.adjustedCommissionBrl)
})

test('mixed daily selection preserves affordable/premium ends and fills all 30 slots', () => {
  const item = (id, price, score) => ({ id, product: { discountedPrice: price }, score, category: 'same' })
  const pool = Array.from({ length: 50 }, (_, i) => item(i, 200, 100 - i / 100))
    .concat(Array.from({ length: 8 }, (_, i) => item(100 + i, 20, 70)))
    .concat(Array.from({ length: 8 }, (_, i) => item(200 + i, 1000, 69)))
  const original = [...pool]
  const ordered = dailyMixedPriceOrder(pool, 30)
  const selected = ordered.slice(0, 30)
  assert.equal(selected.length, 30)
  assert.equal(selected.filter(i => dailyPriceBand(i.product.discountedPrice) === 'affordable').length, 6)
  assert.equal(selected.filter(i => dailyPriceBand(i.product.discountedPrice) === 'premium').length, 6)
  assert.ok(selected.slice(0, 10).some(i => i.product.discountedPrice > 500))
  assert.ok(selected.slice(20).some(i => i.product.discountedPrice <= 100))
  assert.deepEqual(pool, original)
  assert.equal(new Set(ordered.map(i => i.id)).size, pool.length)
  const sparse = pool.filter(i => i.product.discountedPrice !== 1000).concat(item(999, 1000, 1))
  const filled = dailyMixedPriceOrder(sparse, 30).slice(0, 30)
  assert.equal(filled.length, 30)
  assert.ok(filled.some(i => i.id === 999))
  assert.equal(dailyMixedPriceOrder(pool.filter(i => i.product.discountedPrice === 200), 30).slice(0, 30).length, 30)
})

test('daily assortment keeps one Boombox colour variant and promotes another qualified product', () => {
  const row = (id, title, score) => ({ id, product: { title, discountedPrice: 600 }, category: 'Eletrônicos', score })
  const values = [row('blue', 'Caixa de Som JBL Boombox 4 Bluetooth Portátil 210W Bivolt Azul', 95),
    row('orange', 'Jbl Boombox 4 Caixa De Som Com Bluetooth Cor Laranja', 94),
    row('black', 'Caixa de Som Bluetooth Portátil JBL Boombox 4 JBL Pro Sound 210W até 34h de Bateria Preta', 93),
    row('other', 'Projetor HY320 Hardline Smart TV', 80)]
  assert.deepEqual(new Set(dailyMixedPriceOrder(values, 2).slice(0, 2).map(i => i.id)), new Set(['blue', 'other']))
  const distinct = [...values.slice(0, 1), row('older', 'JBL Boombox 3 Preto', 93),
    row('accessory', 'Capa para JBL Boombox 4 Preto', 92), row('kit', 'Kit JBL Boombox 4 e microfone', 91)]
  assert.equal(dailyMixedPriceOrder(distinct, 4).slice(0, 4).length, 4)
})

test('daily diversity counts spelling variants together and defers excess when other categories qualify', () => {
  const categories = ['Eletrônicos', 'ELETRONICOS', 'eletrônicos', 'Eletronicos']
  const values = Array.from({ length: 12 }, (_, id) => ({ id, product: { discountedPrice: 200 }, category: categories[id % 4], score: 98 }))
    .concat(['Ferramentas', 'Moda masculina', 'Perfume masculino'].flatMap((category, n) => Array.from({ length: 4 }, (_, i) => ({ id: 100+n*10+i, product: { discountedPrice: 200 }, category, score: 70 }))))
  const selected = dailyMixedPriceOrder(values, 12).slice(0, 12)
  assert.equal(selected.filter(i => i.id < 100).length, 3)
  assert.equal(selected.length, 12)
})

const { dailyCategoryKey, dailyVariantKey, dailySpacedOrder } = require('../dist/utils/dailyAssortment')
const { reconcileDailyApproval } = require('../dist/services/dailyApprovalReconciliation')
const assortmentRow = (id, title, score = 90, extra = {}) => ({ id, product: { title, discountedPrice: 200 }, category: 'utilidades', score, warnings: [], ...extra })

test('same product variants ignore colour, size, voltage, pack count, seller and price noise', () => {
  const pairs = [
    ['Jogo De Lençol Queen Micropercal 400 Fios 3pç Cor Rosa', 'Jogo De Lençol King Micropercal 400 Fios 4 Peças Verde'],
    ['Tênis Esportivo Corrida Olympikus Cor Preto Tamanho 42 Br', 'Tênis Esportivo Corrida Olympikus Azul 40 Br'],
    ['Chaleira Elétrica Inox Mondial 127v Vendido por Loja A', 'Chaleira Elétrica Inox Mondial 220v'],
    ['Coberdrom Casal Queen Size Sherpa Dupla Face R$179,98', 'Coberdrom Sherpa Dupla Face Casal Queen Size R$199,99'],
    ['Lixeira Inteligente Sensor 16L Branco', 'Lixeira Inteligente Sensor 16L Cor Preta'],
    ['Lixeira Inteligente Smart 16l Automática Recarregável Preto Sensor Banheiro E Cozinha Moderna',
      'Lixeira Com Sensor Automático 16 Litros Branco Inteligente Abre Fácil Toque Cesto Quarto Banheiro Cozinha'],
    ['Jogo De Lençol Queen Micropercal 400 Fios Sofisticado 3pç Verde Liso',
      'Jogo De Lençol Queen Micropercal 400 Fios Sofisticado 3pç Cor Rosa Desenho do tecido Liso'],
    ['Coberdrom Casal Queen Size Sherpa Cobertor Edredom Inverno Pele Lã Carneiro Super Macio Suave Confortável Luxo Cor Caqui',
      'Coberdrom Casal Queen Size Sherpa Cobertor Edredom Inverno Pele Lã Carneiro Super Macio Suave Confortável Luxo Cor Cinza'],
    ['Chaleira Elétrica Inox Mondial 127/220v', 'Chaleira Elétrica Inox Mondial Bivolt'],
    ['Kit Furadeira Impacto Modelo X10 127v', 'Kit Furadeira Impacto Modelo X10 Bivolt'],
    ['Kit 3 Bermuda Sarja Cor Preto Tamanho GG', 'Kit 2 Bermuda Sarja Cor Azul Tamanho P'],
  ]
  for (const [a,b] of pairs) assert.equal(dailyVariantKey({ title: a }), dailyVariantKey({ title: b }), `${a} / ${b}`)
  assert.notEqual(dailyVariantKey({ title: 'Lixeira Inteligente Sensor 16L' }), dailyVariantKey({ title: 'Lixeira Inteligente Sensor 20L' }))
  assert.notEqual(dailyVariantKey({ title: 'Furadeira Bosch GSB 180' }), dailyVariantKey({ title: 'Furadeira Bosch GSB 185' }))
})

test('title product types override broad AI categories and synonyms share a cap', () => {
  const pairs = [['Kit Furadeira Parafusadeira', 'Parafusadeira elétrica'], ['Smartwatch Esportivo', 'Relógio Masculino'],
    ['Jogo de Lençol', 'Jogo de Cama'], ['Coberdrom Sherpa', 'Edredom Casal']]
  for (const [a,b] of pairs) assert.equal(dailyCategoryKey('utilidades', a), dailyCategoryKey('Eletrônicos', b))
  assert.notEqual(dailyCategoryKey('ferramentas', 'Compressor de ar'), dailyCategoryKey('ferramentas', 'Parafusadeira'))
  assert.equal(dailyCategoryKey('ferramentas', 'Jogo De Ferramentas 169 Peças E Furadeira Parafusadeira 21v'), dailyCategoryKey('ferramentas', 'Parafusadeira'))
  assert.equal(dailyCategoryKey('cama', 'Kit 6 Sacos Edredom Organizadores Guarda Roupa'), 'organizador')
})

test('type caps use qualified alternatives before relaxing, even across price bands', () => {
  const rows = Array.from({ length: 5 }, (_,i) => assortmentRow(`drill-${i}`, `Parafusadeira Bosch modelo ${i}`, 99, { product: { title: `Parafusadeira Bosch modelo ${i}`, discountedPrice: 50 } }))
    .concat(Array.from({ length: 8 }, (_,i) => assortmentRow(`other-${i}`, `Produto distinto modelo ${i}`, 70, { category: `type-${i}` })))
  const chosen = dailyMixedPriceOrder(rows, 8, 2).slice(0,8)
  assert.equal(chosen.filter(i => i.id.startsWith('drill')).length, 2)
  assert.equal(dailyMixedPriceOrder(rows.slice(0,5), 5, 2).slice(0,5).length, 5)
})

test('spacing avoids adjacent types whenever feasible and keeps fresh before repeats', () => {
  const rows = ['Parafusadeira Bosch 100', 'Parafusadeira Bosch 200', 'Compressor de ar 100', 'Compressor de ar 200', 'Smartwatch Digital 100', 'Smartwatch Digital 200'].map((title,i) => assortmentRow(String(i),title))
  const ordered = dailySpacedOrder(rows)
  for (let i=1;i<ordered.length;i++) assert.notEqual(dailyCategoryKey(ordered[i-1].category,ordered[i-1].product.title), dailyCategoryKey(ordered[i].category,ordered[i].product.title))
  const fresh = dailySpacedOrder([...rows.map(i => ({ ...i, repeatFallback: true })), ...rows.map(i => ({ ...i, id: `fresh-${i.id}` }))])
  assert.ok(fresh.slice(0,6).every(i => !i.repeatFallback))
})

test('automatic approval replaces duplicate and excess types, fills capacity, and spaces promotions', async () => {
  const rows = Array.from({ length: 5 }, (_,i) => assortmentRow(`drill-${i}`, `Parafusadeira Bosch modelo ${i}`, 99-i, { state: 'SELECTED', sendOrder: i }))
    .concat(assortmentRow('variant', 'Parafusadeira Bosch modelo 0 Cor Azul', 99, { state: 'SELECTED' }))
    .concat(['Compressor de ar 100', 'Smartwatch Digital 100', 'Tênis Corrida 100', 'Barbeador Philips 100', 'Chaleira Inox 100'].map((title,i) => assortmentRow(`reserve-${i}`, title, 70, { state: 'RESERVE' })))
  const retained = await reconcileDailyApproval({ items: rows, capacity: 6, maxPerType: 2, invalid: () => false, conflict: () => false,
    repeatsReady: true, aliases: i => [dailyVariantKey(i.product)], occupied: new Set(), schedule: n => Array.from({length:n},() => new Date()), fresh: () => true, maxStandouts: 0 })
  assert.equal(retained.length,6)
  assert.equal(new Set(retained.map(i=>dailyVariantKey(i.product))).size,6)
  assert.equal(retained.filter(i=>i.id.startsWith('drill')).length,2)
  for (let i=1;i<retained.length;i++) assert.notEqual(dailyCategoryKey(retained[i-1].category,retained[i-1].product.title), dailyCategoryKey(retained[i].category,retained[i].product.title))
})


test('configured type caps and scarce single-type inventories preserve distinct products', () => {
  const rows = ['Parafusadeira Bosch 100', 'Parafusadeira Bosch 200', 'Compressor de ar 100', 'Smartwatch Digital 100'].map((title,i) => assortmentRow(String(i),title))
  assert.equal(dailyMixedPriceOrder(rows, 3, 1).slice(0,3).filter(i => i.product.title.includes('Parafusadeira')).length, 1)
})


test('spacing considers the boundary between fresh stock and cooled repeats', () => {
  const rows = [assortmentRow('fresh-a','',90,{category:'A'}), assortmentRow('fresh-b','',90,{category:'B'}),
    assortmentRow('repeat-b','',90,{category:'B',repeatFallback:true})]
  assert.deepEqual(dailySpacedOrder(rows).map(i=>i.id),['fresh-b','fresh-a','repeat-b'])
})


test('spacing reserves a separator when neither end of a greedy fresh block is usable', () => {
  const rows = ['A','B','C','C'].map((category,i)=>assortmentRow(`fresh-${i}`,'',90,{category}))
    .concat(assortmentRow('repeat-c','',90,{category:'C',repeatFallback:true}))
  const result=dailySpacedOrder(rows)
  for(let i=1;i<result.length;i++)assert.notEqual(result[i-1].category,result[i].category)
  assert.equal(result.at(-1).id,'repeat-c')
})
