const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { chromium } = require('playwright')
require('reflect-metadata')
const { DailySessionRefresher } = require('../dist/services/DailySessionRefresher')
const { MlLoginRecovery } = require('../dist/services/MlLoginRecovery')

test('worker refresh saves rotated state, survives a fresh instance and does not overwrite it on auth expiry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-refresh-'))
  const file = path.join(directory, 'state.json'), previous = process.env.DAILY_BROWSER_STATE_PATH
  process.env.DAILY_BROWSER_STATE_PATH = file
  await fs.writeFile(file, '{"cookies":[],"origins":[]}', { mode: 0o600 })
  const launch = chromium.launch.bind(chromium)
  let launches = 0, expired = false
  chromium.launch = async options => {
    launches++
    const browser = await launch(options), newContext = browser.newContext.bind(browser)
    browser.newContext = async config => {
      const context = await newContext(config), newPage = context.newPage.bind(context)
      context.newPage = async () => {
        const page = await newPage(), wait = page.waitForSelector.bind(page)
        page.waitForSelector = (selector, options) => wait(selector, expired ? { ...options, timeout: 150 } : options)
        await page.route('**/*', async route => {
          const url = new URL(route.request().url())
          if (url.hostname !== 'www.mercadolivre.com.br') return route.abort()
          if (expired && url.pathname.includes('/afiliados')) return route.fulfill({ status: 302, headers: { location: '/login/identification' }, body: '' })
          if (expired) return route.fulfill({ contentType: 'text/html', body: '<p>Entre na sua conta</p><input id="user_id">' })
          await context.addCookies([{ name: 'qa_rotated', value: 'fixture-session', domain: '.mercadolivre.com.br', path: '/', secure: true }])
          return route.fulfill({ contentType: 'text/html', body: '<script>localStorage.setItem("device","rotated")</script><div class="poly-card">Produto</div>' })
        })
        return page
      }
      return context
    }
    return browser
  }
  try {
    const now = new Date('2026-11-10T12:00:00Z')
    await new DailySessionRefresher().tick(now)
    const saved = await fs.readFile(file, 'utf8'), state = JSON.parse(saved)
    assert.ok(state.cookies.some(c => c.name === 'qa_rotated'))
    assert.equal(state.origins[0].localStorage[0].value, 'rotated')
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    await new DailySessionRefresher().tick(now)
    assert.equal(launches, 1, 'Durable bucket marker survives scheduler/process recreation')
    expired = true
    const next = new Date(now.getTime() + 4 * 60 * 60_000)
    await assert.rejects(new DailySessionRefresher().tick(next), /ML_SESSION_AUTH_REQUIRED/)
    assert.equal(await fs.readFile(file, 'utf8'), saved)
    await new DailySessionRefresher().tick(next)
    assert.equal(launches, 2, 'Failed authentication cannot allocate a browser every scheduler tick')
  } finally {
    chromium.launch = launch
    if (previous === undefined) delete process.env.DAILY_BROWSER_STATE_PATH; else process.env.DAILY_BROWSER_STATE_PATH = previous
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('email challenge submits one group-provided code to its own browser and never resends automatically', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-code-browser-'))
  const previous = process.env.DAILY_BROWSER_STATE_PATH
  process.env.DAILY_BROWSER_STATE_PATH = path.join(directory, 'session.json')
  await fs.writeFile(path.join(directory, 'login.json'), '{"email":"qa@example.invalid"}', { mode: 0o600 })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname !== 'www.mercadolivre.com.br') return route.abort()
      let body
      if (url.pathname === '/login/identification') body = '<input id="user_id" name="user_id"><button onclick="location.href=\'/login/email\'">Continuar</button>'
      else if (url.pathname === '/login/email') body = '<button onclick="location.href=\'/login/code\'">Enviar código por e-mail</button>'
      else if (url.pathname === '/login/code') body = '<p>Enviamos o código ao seu e-mail</p><input autocomplete="one-time-code"><button onclick="window.resent=true">Reenviar código por e-mail</button><button onclick="if(document.querySelector(\'input\').value===\'012345\')location.href=\'/afiliados/hub\'">Confirmar</button>'
      else body = '<div class="poly-card">Produto autenticado</div>'
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body })
    })
    await page.goto('https://www.mercadolivre.com.br/login/identification')
    let requests = 0, takes = 0, finished
    const challenges = {
      preflight: async () => {},
      begin: async () => { requests++; assert.ok(page.url().endsWith('/login/code')); assert.equal(await page.evaluate(() => Boolean(window.resent)), false); return { id: 'fixture', expiresAt: new Date(Date.now()+5000) } },
      take: async () => { takes++; return '012345' },
      finish: async (_challenge, success) => { finished = success },
    }
    assert.equal(await new MlLoginRecovery(challenges).recover(page, { userId: 1 }), true)
    assert.equal(requests, 1); assert.equal(takes, 1); assert.equal(finished, true)
    assert.ok(page.url().endsWith('/afiliados/hub'))
  } finally {
    await browser.close()
    if (previous === undefined) delete process.env.DAILY_BROWSER_STATE_PATH; else process.env.DAILY_BROWSER_STATE_PATH = previous
    await fs.rm(directory, { recursive: true, force: true })
  }
})
