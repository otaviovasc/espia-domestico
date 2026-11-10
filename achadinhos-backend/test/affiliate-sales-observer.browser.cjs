const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')
const { AffiliateSalesObserver } = require('../dist/services/AffiliateSalesObserver')
const { AffiliateSalesState } = require('../dist/services/AffiliateSalesState')

for (const initialPeriod of ['2 até 8/nov', 'Últimos 7 dias']) test(`Chromium waits for delayed report pages from ${initialPeriod}, records collisions and preserves the last good generation after login expiry`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sales-browser-'))
  const statePath = path.join(directory, 'daily-auth/session.json')
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(statePath, '{"cookies":[],"origins":[]}', { mode: 0o600 })
  const previousState = process.env.DAILY_BROWSER_STATE_PATH
  process.env.DAILY_BROWSER_STATE_PATH = statePath
  const originalLaunch = chromium.launch.bind(chromium)
  let launches = 0, loginExpired = false
  const row = (order, product, commission = 10, status = 'EM REVISÃO') => `<tr><td>09/nov #${order} Panela Categoria: Cozinha<a href="https://produto.mercadolivre.com.br/MLB-${product}-panela-_JM">Produto</a></td><td>Loja</td><td>R$ 100,00 1 unidade</td><td>R$ ${commission},00 Venda direta: 10%</td><td>${status}</td></tr>`
  const first = row('111111111111', '123456789') + row('222222222222', '987654321')
  const second = row('111111111111', '123456789') + row('111111111111', '123456789', 0, 'CANCELADA')
  chromium.launch = async options => {
    launches++
    const browser = await originalLaunch(options)
    const originalContext = browser.newContext.bind(browser)
    browser.newContext = async config => {
      const context = await originalContext(config)
      const originalPage = context.newPage.bind(context)
      context.newPage = async () => {
        const page = await originalPage()
        const originalGoto = page.goto.bind(page)
        page.goto = async (...args) => {
          const response = await originalGoto(...args)
          await page.waitForTimeout(800) // The old document is already idle before the report-period click.
          return response
        }
        await page.route('**/*', async route => {
          const url = new URL(route.request().url())
          if (url.hostname !== 'www.mercadolivre.com.br') return route.abort()
          if (url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<input type="password">' })
          if (url.pathname === '/qa-sales') {
            await new Promise(resolve => setTimeout(resolve, 1800))
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rows: url.searchParams.get('page') === '2' ? second : first }) })
          }
          assert.equal(url.pathname, '/afiliados/dashboard')
          if (loginExpired) return route.fulfill({ status: 302, headers: { location: 'https://www.mercadolivre.com.br/login' }, body: '' })
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main><button id="period" onclick="document.querySelector('#choice').hidden=false">${initialPeriod}</button>
            <button id="choice" hidden onclick="load(1);document.querySelector('#period').textContent='Últimos 90 dias';this.hidden=true">Últimos 90 dias</button>
            <table><thead><tr>${['Produtos','Loja','Valor da venda','Ganho por venda','Estado'].map(x=>'<th>'+x+'</th>').join('')}</tr></thead><tbody>${row('999999999999', '999999999')}</tbody></table>
            <div class="andes-pagination__button--next" id="next"><button onclick="load(2)">Próxima</button></div>
            <script>async function load(page){const r=await fetch('/qa-sales?page='+page);const d=await r.json();document.querySelector('tbody').innerHTML=d.rows;if(page===2){document.querySelector('#next').setAttribute('aria-disabled','true');}}</script></main>` })
        })
        return page
      }
      return context
    }
    return browser
  }
  try {
    const observer = new AffiliateSalesObserver()
    const captured = await observer.capture(1, '2026-11-10')
    assert.deepEqual(captured, { rows: 4, newRows: 2, complete: true })
    const store = new AffiliateSalesState(path.join(directory, 'affiliate-sales/account-1'), 1)
    const firstGeneration = await store.readGeneration()
    assert.equal(firstGeneration.identicalDuplicateRows, 1)
    assert.equal(firstGeneration.collisions.length, 1)
    assert.equal(firstGeneration.sales.length, 2)
    assert.equal((await store.report()).summary.demand.observedPurchases, 1)
    assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600)
    assert.equal(await observer.capture(1, '2026-11-10'), null)
    assert.equal(launches, 1, 'The durable attempt marker prevents duplicate browsing')
    loginExpired = true
    await assert.rejects(observer.capture(1, '2026-11-11'), /AUTH_REQUIRED/)
    const report = await store.report()
    assert.equal(report.generationId, firstGeneration.capture.generationId)
    assert.equal(report.attempt.status, 'failed')
    assert.equal(report.attempt.code, 'AFFILIATE_SALES_AUTH_REQUIRED')
  } finally {
    chromium.launch = originalLaunch
    if (previousState === undefined) delete process.env.DAILY_BROWSER_STATE_PATH
    else process.env.DAILY_BROWSER_STATE_PATH = previousState
    await fs.rm(directory, { recursive: true, force: true })
  }
})
