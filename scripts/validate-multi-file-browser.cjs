#!/usr/bin/env node
// Run against validate-bulk-import.cjs --serve and the frontend on port 5273.
// Requires Playwright. PLAYWRIGHT_MODULE can point to an existing installation.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const frontend = process.env.BULK_QA_FRONTEND || 'http://127.0.0.1:5273'
const api = 'http://127.0.0.1:3100'
const offer = (i) => ({
  title: i === 7 || i === 101 ? `Falha temporária MultiBrowser ${i}` : `MultiBrowser Panela ${i}`,
  discountedPrice: 79.9, originalPrice: 119.9,
  affiliateUrl: `https://meli.la/multi-browser-${i}`,
  commissionPercent: '12%', commissioned: true,
  source: 'mercadolivre', productId: `MultiBrowser-${i}`,
})
const card = (o) => ({
  productId: o.productId, title: o.title,
  productUrl: 'https://www.mercadolivre.com.br/p/MLB1234567',
  commissionedUrl: o.affiliateUrl, commissionedUrlStatus: 'present_on_card',
  pricing: { currentAmount: o.discountedPrice, originalAmount: o.originalPrice, currency: 'BRL' },
  commissionPercent: o.commissionPercent,
})
const files = [
  { name: 'browser-generic-a.json', json: [...Array.from({ length: 101 }, (_, i) => offer(i)), { title: 'Invalid missing price and URL' }] },
  { name: 'browser-mercadolivre.json', json: { sourceUrl: 'https://www.mercadolivre.com.br/afiliados/hub', cards: [card(offer(0)), ...Array.from({ length: 24 }, (_, i) => card(offer(i + 101)))] } },
  { name: 'browser-generic-b.json', json: { products: [offer(2), offer(101), offer(125)] } },
]
const upload = (f) => ({ name: f.name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f.json)) })
const stats = async () => (await fetch(`${api}/__qa/stats`)).json()

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.BULK_QA_CHROMIUM ? { executablePath: process.env.BULK_QA_CHROMIUM } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const requests = []
    const responses = []
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (r) => { if (r.url().includes('/campaigns/import-offers')) requests.push(r.postDataJSON()) })
    page.on('response', async (r) => { if (r.url().includes('/campaigns/import-offers') && r.ok()) responses.push((await r.json()).data) })
    await page.goto(`${frontend}/painel/login`)
    await page.locator('input[type=email]').fill('bulk-qa@example.invalid')
    await page.locator('input[type=password]').fill('Bulk-qa-2026-only')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL((url) => !url.pathname.endsWith('/login'))
    await page.goto(`${frontend}/painel/products`)
    await page.getByText('Adicionar arquivos JSON', { exact: true }).waitFor()
    const before = await stats()
    const input = page.locator('input[type=file]')
    assert.equal(await input.getAttribute('multiple'), '')
    await input.setInputFiles(upload(files[0]))
    await page.getByText(/browser-generic-a.json.*Pronto/).waitFor()
    await input.setInputFiles([...files.slice(1).map(upload), { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{bad') }])
    await page.getByText('JSON inválido em broken.json. Corrija o arquivo antes de classificar.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Classificar produtos', exact: true }).isDisabled(), true)
    assert.equal(requests.length, 0)
    assert.equal((await stats()).totalCalls, before.totalCalls)
    await page.getByRole('button', { name: 'Remover arquivo broken.json', exact: true }).click()
    await page.locator('textarea').fill(JSON.stringify([offer(125)]))
    await page.getByRole('button', { name: 'Classificar produtos', exact: true }).click()
    await page.getByText(/124 classificado\(s\) · 2 falha\(s\)/).waitFor({ timeout: 60000 })
    const parsed = responses.find((r) => Array.isArray(r.files) && r.files.length === 4)
    assert.ok(parsed, 'parse-only result includes three files plus pasted JSON')
    assert.equal(parsed.totalSeen, 131)
    assert.equal(parsed.offers.length, 126)
    assert.equal(parsed.duplicateCount, 4)
    assert.equal(parsed.errors.length, 1)
    assert.deepEqual(parsed.files.slice(0, 3).map((f) => f.name), files.map((f) => f.name))
    assert.deepEqual(parsed.offerIndexes.slice(-2), [126, 129])
    assert.equal(parsed.provenance.at(-1).fileName, 'browser-generic-b.json')
    assert.equal(parsed.provenance.at(-1).itemIndex, 2)
    const first = await stats()
    assert.equal(first.totalCalls - before.totalCalls, 126)
    const table = page.getByRole('table').filter({ has: page.getByText('Resumo e progresso de cada arquivo', { exact: true }) })
    const progressBeforeRetry = await table.innerText()
    assert.match(progressBeforeRetry, /browser-mercadolivre.json/)
    await page.getByText('Falhas da classificação (2)', { exact: true }).click()
    assert.match(await page.locator('body').innerText(), /browser-mercadolivre.json · item 2/)
    const selected = page.getByRole('checkbox', { name: 'Salvar MultiBrowser Panela 0', exact: true })
    await selected.check()
    assert.equal(await selected.isChecked(), true)
    await page.getByRole('button', { name: 'Tentar falhas novamente', exact: true }).click()
    await page.getByText(/126 classificado\(s\) · 0 falha\(s\)/).waitFor({ timeout: 60000 })
    assert.equal(await selected.isChecked(), true)
    const after = await stats()
    assert.equal(after.totalCalls - before.totalCalls, 128)
    const evaluated = Object.entries(after.calls).filter(([title]) => title.includes('MultiBrowser'))
    assert.equal(evaluated.length, 126)
    assert.equal(evaluated.filter(([, count]) => count === 2).length, 2)
    assert.equal(evaluated.filter(([, count]) => count > 2).length, 0)
    const progressAfterRetry = await table.innerText()
    await page.getByRole('button', { name: 'Selecionar filtrados (126)', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar 126 selecionado(s)', exact: true }).click()
    await page.getByText('Salvamento: 126 concluído(s), 0 falha(s), 0 pendente(s).', { exact: true }).waitFor({ timeout: 60000 })
    const saved = await page.evaluate(async () => {
      const result = await fetch('/api/v1/saved-products?limit=100&offset=0', {
        headers: { authorization: `Bearer ${sessionStorage.getItem('achadinhos_token')}` },
      })
      return (await result.json()).data
    })
    assert.equal(saved.total, 311)
    await page.getByText('Mostrando 100 de 311 produtos.', { exact: true }).waitFor()
    for (const count of [200, 300, 311]) {
      await page.getByRole('button', { name: 'Carregar mais', exact: true }).click()
      await page.getByText(`${count} resultado(s) entre ${count} produto(s) carregado(s).${count < 311 ? ' Carregue mais para pesquisar o restante do catálogo.' : ' Todo o catálogo está carregado.'}`, { exact: true }).waitFor()
    }
    await page.getByText('311 resultado(s) entre 311 produto(s) carregado(s). Todo o catálogo está carregado.', { exact: true }).waitFor()
    assert.deepEqual(pageErrors, [])
    console.log(JSON.stringify({ rawItems: 131, uniqueItems: 126, files: 3, pastedPayloads: 1, duplicates: 4, invalid: 1, firstPassFailures: 2, evaluations: 128, saved: 126, catalog: saved.total, malformedRequests: 0, selectionPreservedOnRetry: true, progressBeforeRetry, progressAfterRetry }, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
