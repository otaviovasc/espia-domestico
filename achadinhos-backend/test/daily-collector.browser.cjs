const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')
const { DailyProductCollector } = require('../dist/services/DailyProductCollector')

test('real Chromium runs vendored share/exclusion scripts and closes after both audience collections', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-collector-'))
  const statePath = path.join(temp, 'state.json')
  await fs.writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }), { mode: 0o600 })
  const previousState = process.env.DAILY_BROWSER_STATE_PATH
  const previousCdp = process.env.DAILY_BROWSER_CDP_URL
  process.env.DAILY_BROWSER_STATE_PATH = statePath
  delete process.env.DAILY_BROWSER_CDP_URL
  const originalLaunch = chromium.launch.bind(chromium)
  let browser
  let navigations = 0
  let failSecondAudience = false
  chromium.launch = async options => {
    browser = await originalLaunch(options)
    const originalNewContext = browser.newContext.bind(browser)
    browser.newContext = async contextOptions => {
      const context = await originalNewContext(contextOptions)
      await context.addCookies([{ name: 'qa_rotated_session', value: 'fixture-only', domain: '.mercadolivre.com.br', path: '/', secure: true }])
      const originalNewPage = context.newPage.bind(context)
      context.newPage = async () => {
        const page = await originalNewPage()
        await page.route('**/*', route => {
          assert.equal(new URL(route.request().url()).pathname, '/afiliados/hub')
          navigations++
          if (failSecondAudience && navigations === 2) return route.abort('failed')
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="utf-8"></head><body><ul>${['MLB12345678', 'MLB87654321', 'MLB87654322'].map((id, i) => `
            <li class="poly-card"><a class="poly-component__title" href="https://www.mercadolivre.com.br/p/${id}">Panela de pressão ${i}</a>
            <input data-testid="form-data-id" value="${id}"><p>Classificação 4.8 de 5 estrelas. Mais de 50mil produtos vendidos. GANHOS 10%</p>
            <span class="poly-price__current"><span class="andes-money-amount"><span class="andes-money-amount__currency-symbol">R$</span><span class="andes-money-amount__fraction">100</span></span></span>
            <a href="https://www.mercadolivre.com.br/sec/proof?origin_url=${encodeURIComponent(`https://www.mercadolivre.com.br/p/${id}`)}">Link atribuído</a></li>`).join('')}</ul></body></html>` })
        })
        return page
      }
      return context
    }
    return browser
  }
  try {
    const payloads = await new DailyProductCollector().collect(['domestica', 'masculino'].map(slug => ({ slug,
      options: { limit: 1, keywords: ['panela'], excludePolitical: true, excludeProductIds: ['MLB12345678'], quality: { minRating: 4.5, minSoldCount: 100 } },
    })), new AbortController().signal)
    assert.equal(navigations, 2)
    assert.equal(payloads.length, 2)
    for (const [index, payload] of payloads.entries()) {
      assert.equal(payload.json.cards.length, 1, JSON.stringify({ qualityRejected: payload.json.qualityRejected, discovered: payload.json.discoveredCards, discovery: payload.json.discovery, search: payload.json.search }))
      assert.equal(payload.json.cards[0].productId, index === 0 ? 'MLB87654321' : 'MLB87654322')
      assert.equal(payload.json.cards[0].commissionedUrlStatus, 'present_on_card')
      assert.equal(payload.json.excludedPreviouslyUsed, index + 1)
      assert.equal(payload.json.search.excludePolitical, true)
      assert.equal(payload.json.cards[0].raw, undefined)
    }
    const restored = JSON.parse(await fs.readFile(statePath, 'utf8'))
    assert.ok(restored.cookies.some(cookie => cookie.name === 'qa_rotated_session'))
    assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600)
    assert.equal(browser.isConnected(), false)
    // The first authenticated audience's rotation must survive a later failure.
    await fs.writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }), { mode: 0o600 })
    navigations = 0
    failSecondAudience = true
    const completed = []
    await assert.rejects(new DailyProductCollector().collect(['domestica', 'masculino'].map(slug => ({ slug,
      options: { limit: 1, keywords: ['panela'] },
    })), new AbortController().signal, async payload => { completed.push(payload.targetAudienceSlug) }), { code: 'COLLECTION_FAILED' })
    assert.equal(navigations, 2)
    assert.deepEqual(completed, ['domestica'])
    assert.ok(JSON.parse(await fs.readFile(statePath, 'utf8')).cookies.some(cookie => cookie.name === 'qa_rotated_session'))
    assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600)
    assert.equal(browser.isConnected(), false)
  } finally {
    chromium.launch = originalLaunch
    await browser?.close().catch(() => {})
    if (previousState === undefined) delete process.env.DAILY_BROWSER_STATE_PATH
    else process.env.DAILY_BROWSER_STATE_PATH = previousState
    if (previousCdp !== undefined) process.env.DAILY_BROWSER_CDP_URL = previousCdp
    await fs.rm(temp, { recursive: true, force: true })
  }
})
