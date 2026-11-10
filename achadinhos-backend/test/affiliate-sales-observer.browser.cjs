const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')
const { AffiliateSalesObserver } = require('../dist/services/AffiliateSalesObserver')
const { dailyDateOffset } = require('../dist/config/dailyAutomation')
const { AffiliateSalesState } = require('../dist/services/AffiliateSalesState')

for (const initialPeriod of ['pagination disappears before rows', 'pagination arrives after rows', 'empty default week', 'Últimos 90 dias']) test(`Chromium waits for delayed report pages from ${initialPeriod}, records collisions and preserves the last good generation after login expiry`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sales-browser-'))
  const statePath = path.join(directory, 'daily-auth/session.json')
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(statePath, '{"cookies":[],"origins":[]}', { mode: 0o600 })
  const previousState = process.env.DAILY_BROWSER_STATE_PATH
  process.env.DAILY_BROWSER_STATE_PATH = statePath
  const originalLaunch = chromium.launch.bind(chromium)
  let launches = 0, loginExpired = false, emptyReport = false, mismatchReport = false
  const row = (order, product, commission = 10, status = 'EM REVISÃO') => `<tr><td>09/nov #${order} Panela Categoria: Cozinha<a href="https://produto.mercadolivre.com.br/MLB-${product}-panela-_JM">Produto</a></td><td>Loja</td><td>R$ 100,00 1 unidade</td><td>R$ ${commission},00 Venda direta: 10%</td><td>${status}</td></tr>`
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const todayRange = `${today}T00:00:00.000-03:00--${dailyDateOffset(today,1)}T00:00:00.000-03:00`
  const range = `${dailyDateOffset(today, -90)}T00:00:00.000-03:00--${today}T00:00:00.000-03:00`
  const first = row('111111111111', '123456789') + row('222222222222', '987654321')
  const second = row('111111111111', '123456789') + row('111111111111', '123456789', 0, 'CANCELADA\nPor devolução')
  chromium.launch = async options => {
    launches++
    const browser = await originalLaunch(options)
    const originalContext = browser.newContext.bind(browser)
    browser.newContext = async config => {
      const context = await originalContext(config)
      const originalPage = context.newPage.bind(context)
      context.newPage = async () => {
        const page = await originalPage()
        const originalWait = page.waitForFunction.bind(page)
        page.waitForFunction = (fn, arg, options) => originalWait(fn, arg, (emptyReport || mismatchReport) ? { ...options, timeout: 200 } : options)
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
          if (url.pathname === '/qa-default') {
            await new Promise(resolve => setTimeout(resolve, 1800))
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rows: row('999999999999', '999999999') }) })
          }
          if (url.pathname === '/affiliate-program/api/dashboard/sales/general') {
            await new Promise(resolve => setTimeout(resolve, initialPeriod === 'Últimos 90 dias' && url.searchParams.get('page') === '1' ? 3000 : 1800))
            if(url.searchParams.get('filter_time_range')===todayRange)return route.fulfill({contentType:'application/json',body:JSON.stringify({page:1,items_per_page:2,total_results:1,filter_time_range:todayRange.split('--').map(x=>Date.parse(x.slice(0,10)+'T00:00:00Z')).join('--'),item_list:[{id:'555555555555',status:'IN_REVIEW'}],rows:row('555555555555','555555555').replace('09/nov',today.slice(-2)+'/'+['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(today.slice(5,7))-1])})})
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ page: Number(url.searchParams.get('page')), items_per_page: 2, total_results: emptyReport ? 0 : 4, filter_time_range: range.split('--').map(x => Date.parse(x.slice(0,10)+'T00:00:00Z')).join('--'), item_list: (emptyReport ? [] : url.searchParams.get('page') === '2' ? ['111111111111','111111111111'] : ['111111111111','222222222222']).map((purchaseId,index) => ({ id: purchaseId, ...(index === 0 ? { purchaseId: Number(purchaseId) } : {}), status: mismatchReport || url.searchParams.get('page') === '2' && index === 1 ? 'CANCELLED' : 'IN_REVIEW' })), rows: emptyReport ? '' : url.searchParams.get('page') === '2' ? second : first }) })
          }
          assert.equal(url.pathname, '/afiliados/dashboard')
          if (loginExpired) return route.fulfill({ status: 302, headers: { location: 'https://www.mercadolivre.com.br/login' }, body: '' })
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main><button id="period" onclick="document.querySelector('#choice').hidden=false;document.querySelector('#today').hidden=false">${initialPeriod === 'Últimos 90 dias' ? initialPeriod : 'Últimos 7 dias'}</button>
            <button id="choice" hidden onclick="load(1);document.querySelector('#period').textContent='Últimos 90 dias';this.hidden=true;document.querySelector('#today').hidden=true">Últimos 90 dias</button>
            <button id="today" hidden onclick="load(1,true);document.querySelector('#period').textContent='Hoje';this.hidden=true;document.querySelector('#choice').hidden=true">Hoje</button>
            <table><thead><tr>${['Produtos','Loja','Valor da venda','Ganho por venda','Estado'].map(x=>'<th>'+x+'</th>').join('')}</tr></thead><tbody>${initialPeriod === 'Últimos 90 dias' || initialPeriod === 'empty default week' ? '' : initialPeriod === 'pagination arrives after rows' ? first : row('999999999999','999999999')}</tbody></table>
            <nav class="andes-pagination"><span id="pages">1</span><div class="andes-pagination__button--next" id="next" ${initialPeriod === 'Últimos 90 dias' ? 'hidden' : ''}><button onclick="load(2)">Próxima</button></div></nav>
            <script>async function load(page,isToday=false){
              const head=document.querySelector('thead'),headHtml=head.innerHTML;head.innerHTML='';const nav=document.querySelector('nav'), saved=nav.innerHTML;if(${JSON.stringify(initialPeriod)}==='pagination disappears before rows')nav.innerHTML='';
              const r=await fetch('/affiliate-program/api/dashboard/sales/general?filter_time_range='+encodeURIComponent(isToday?${JSON.stringify(todayRange)}:${JSON.stringify(range)})+'&page='+page);const d=await r.json();
              const render=()=>{head.innerHTML=headHtml;document.querySelector('tbody').innerHTML=d.rows;};
              const pagination=()=>{if(!document.querySelector('#next'))nav.innerHTML=saved;document.querySelector('nav').hidden=false;document.querySelector('#pages').textContent='2';document.querySelector('#next').hidden=false;document.querySelector('#next').setAttribute('aria-disabled',page===2?'true':'false');};
              if(${JSON.stringify(initialPeriod)}==='pagination disappears before rows'&&page===1){document.querySelector('nav').hidden=true;setTimeout(()=>{render();pagination();},1800);}
              else{render();setTimeout(pagination,${initialPeriod === 'pagination arrives after rows' ? 1300 : 50});}
            }${initialPeriod === 'Últimos 90 dias' ? 'load(1)' : ''}</script></main>` })
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
    if (initialPeriod === 'Últimos 90 dias') {
      mismatchReport = true
      await assert.rejects(observer.capture(1, '2026-11-09'), /SALES_ROWS_NOT_LOADED/)
      assert.equal((await store.report()).generationId, firstGeneration.capture.generationId)
      assert.equal((await store.report()).attempt.code, 'AFFILIATE_SALES_ROWS_NOT_LOADED')
      mismatchReport = false
      emptyReport = true
      assert.deepEqual(await observer.capture(1, '2026-11-11'), { rows: 0, newRows: 0, complete: true })
      const empty = await store.report()
      assert.notEqual(empty.generationId, firstGeneration.capture.generationId, 'Verified zero response is complete')
      assert.equal(empty.attempt.code, 'SUCCESS')
      emptyReport = false
      assert.deepEqual(await observer.capture(1,'2026-11-13',{slot:'h6-12',includeToday:true}),{rows:5,newRows:1,complete:true})
      const withToday=await store.readGeneration()
      assert.equal(withToday.capture.reportRange.to,today)
      assert.equal(withToday.sales.find(s=>s.productId==='MLB555555555').saleDate,today)
    }
    const currentId = (await store.report()).generationId
    loginExpired = true
    await assert.rejects(observer.capture(1, '2026-11-12'), /AUTH_REQUIRED/)
    const report = await store.report()
    assert.equal(report.generationId, currentId)
    assert.equal(report.attempt.status, 'failed')
    assert.equal(report.attempt.code, 'AFFILIATE_SALES_AUTH_REQUIRED')
  } finally {
    chromium.launch = originalLaunch
    if (previousState === undefined) delete process.env.DAILY_BROWSER_STATE_PATH
    else process.env.DAILY_BROWSER_STATE_PATH = previousState
    await fs.rm(directory, { recursive: true, force: true })
  }
})
