const { test } = require('node:test')
const assert = require('node:assert/strict')
const { affiliateSale, mergeAffiliateSales, affiliateSalesErrorCode } = require('../dist/services/AffiliateSalesObserver')
const row = {
  cells: ['09/nov\n#1234567890123456\nCartão Memória 128gb\nCategoria: Informática', 'Loja', 'R$\n98\n,\n77\n1 unidade', 'R$\n17\n,\n82\nVenda direta: 22%', 'EM REVISÃO'],
  productLinks: ['https://produto.mercadolivre.com.br/MLB-5516523337-cartao-_JM'],
}
test('observed multiline currency, order identity and pending status are preserved without buyer/order data', () => {
  const sale = affiliateSale(row, 1, '2026-11-10T12:00:00Z')
  assert.equal(sale.saleValueBRL, 98.77)
  assert.equal(sale.commissionBRL, 17.82)
  assert.equal(sale.status, 'EM REVISÃO')
  assert.equal(sale.productId, 'MLB5516523337')
  assert.equal(sale.title, 'Cartão Memória 128gb')
  assert.equal(sale.attribution, 'direct')
  assert.equal(sale.commissionRatePercent, 22)
  assert.equal(sale.units, 1)
  assert.equal(sale.observedCategory, 'Informática')
  assert.equal(affiliateSale(row, 1, sale.lastSeenAt, { from: '2026-08-12', to: '2026-11-09' }).saleDate, '2026-11-09')
  assert.doesNotMatch(JSON.stringify(sale), /1234567890123456|Loja/)
  assert.notEqual(sale.key, affiliateSale(row, 2, sale.lastSeenAt).key)
  assert.equal(affiliateSale({ ...row, cells: ['', ...row.cells.slice(1)] }, 1, sale.lastSeenAt), null)
  assert.equal(affiliateSale({ ...row, cells: [row.cells[0], 'Loja', 'R$\n166\n1 unidade', ...row.cells.slice(3)] }, 1, sale.lastSeenAt).saleValueBRL, 166)
})

test('sales failure receipts expose typed codes without copying exception details into alerts', () => {
  assert.equal(affiliateSalesErrorCode(new Error('AUTH_REQUIRED')), 'AFFILIATE_SALES_AUTH_REQUIRED')
  assert.equal(affiliateSalesErrorCode(new Error('SALES_REPORT_SCHEMA_CHANGED')), 'AFFILIATE_SALES_SCHEMA_CHANGED')
  assert.equal(affiliateSalesErrorCode(new Error('SALES_REPORT_INCOMPLETE')), 'AFFILIATE_SALES_INCOMPLETE')
  assert.equal(affiliateSalesErrorCode(new Error('secret-private-provider-message')), 'AFFILIATE_SALES_OBSERVATION_FAILED')
})
test('repeated observations do not double-count a sale and a later cancellation replaces its status', () => {
  const first = affiliateSale(row, 1, '2026-11-10T12:00:00Z')
  const updated = affiliateSale({ ...row, cells: [...row.cells.slice(0, 4), 'CANCELADA'] }, 1, '2026-11-11T12:00:00Z')
  const ledger = mergeAffiliateSales([first], [updated, updated])
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].status, 'CANCELADA')
  assert.equal(ledger[0].firstSeenAt, first.firstSeenAt)
  assert.equal(ledger[0].lastSeenAt, updated.lastSeenAt)
})
