const { test } = require('node:test')
const assert = require('node:assert/strict')
const { visibleSignals } = require('../dist/ingestors/MercadoLivreIngestor')

test('live Brazilian hub sales labels preserve quantity, rating and lower-bound evidence', () => {
  assert.deepEqual(visibleSignals('4.8 | +50mil vendidos\nClassificação 4.8 de 5 estrelas. Mais de 50mil produtos vendidos.'), { rating: 4.8, soldCount: 50000, soldCountIsLowerBound: true })
  assert.deepEqual(visibleSignals('Classificação 4,9 de 5 estrelas. Mais de 1,5 mil produtos vendidos.'), { rating: 4.9, soldCount: 1500, soldCountIsLowerBound: true })
  assert.equal(visibleSignals('+10mil vendidos').soldCount, 10000)
  assert.equal(visibleSignals('Mais de 2 milhões produtos vendidos').soldCount, 2000000)
  assert.equal(visibleSignals('+1.000 vendidos').soldCount, 1000)
  assert.equal(visibleSignals('Sem informação de vendas'), undefined)
  assert.equal(visibleSignals('Aspirador 5000W com 50 acessórios'), undefined)
  assert.deepEqual(visibleSignals('4.8 | +50mil vendidos'), { rating: 4.8, soldCount: 50000, soldCountIsLowerBound: true })
})

test('browser and ingestor demand parsing agree on lower bounds, badges and time-limited deals', () => {
  const { marketplaceSignals } = require('../vendor/affiliate-hub/extractor')
  for (const text of ['4.8 | +50mil vendidos', 'Mais de 1,5 mil produtos vendidos. Classificação 4,9 de 5 estrelas.', 'MAIS VENDIDO. +100 vendidos', 'Oferta relâmpago termina em 01:30', 'Sem avaliação', '+1.5 milhões vendidos']) {
    assert.deepEqual(marketplaceSignals(text), visibleSignals(text))
  }
})
