import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { browserSessionHash, checkpointBrowserSession } from './PrivateBrowserSession'

const INTERVAL_MS = 4 * 60 * 60_000

/** One browser visit per four-hour bucket. No collection, classification, send or daily rearm. */
export class DailySessionRefresher {
  private browser?: Browser
  private stopped = false
  constructor(private readonly recover?: (page: Page) => Promise<boolean>) {}

  stop(): void { this.stopped = true; void this.browser?.close().catch(() => undefined) }

  async tick(now = new Date()): Promise<void> {
    const file = process.env.DAILY_BROWSER_STATE_PATH
    if (!file || this.stopped) return
    const directory = path.join(path.dirname(file), 'session-refresh')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const marker = path.join(directory, `${Math.floor(now.getTime() / INTERVAL_MS)}.json`)
    const receipt = { startedAt: now.toISOString(), status: 'running' }
    try { await writeFile(marker, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return; throw error }
    let code = 'ML_SESSION_REFRESH_FAILED'
    let timeout = setTimeout(() => { void this.browser?.close().catch(() => undefined) }, 60_000)
    try {
      const raw = await readFile(file, 'utf8')
      this.browser = process.env.DAILY_BROWSER_CDP_URL
        ? await chromium.connectOverCDP(process.env.DAILY_BROWSER_CDP_URL, { timeout: 20_000 })
        : await chromium.launch({ headless: true, timeout: 20_000,
          proxy: process.env.DAILY_BROWSER_PROXY_SERVER ? { server: process.env.DAILY_BROWSER_PROXY_SERVER, username: process.env.DAILY_BROWSER_PROXY_USERNAME, password: process.env.DAILY_BROWSER_PROXY_PASSWORD } : undefined })
      const context = await this.browser.newContext({ storageState: JSON.parse(raw),
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.browser.version()} Safari/537.36`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
      await context.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue())
      const page = await context.newPage()
      await page.goto('https://www.mercadolivre.com.br/afiliados/hub', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      try { await page.waitForSelector('.poly-card', { timeout: 15_000 }) }
      catch {
        const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')
        if (/login|auth|captcha|challenge|security|account-verification/i.test(new URL(page.url()).pathname) || /entre na sua conta|inicie sess[aã]o|verifique que voc[eê]|confirme que voc[eê]/i.test(body)) code = 'ML_SESSION_AUTH_REQUIRED'
        if (code !== 'ML_SESSION_AUTH_REQUIRED' || !this.recover) throw new Error(code)
        clearTimeout(timeout)
        timeout = setTimeout(() => { void this.browser?.close().catch(() => undefined) }, 6 * 60_000)
        if (!await this.recover(page)) throw new Error(code)
      }
      if (this.stopped) return
      const result = await checkpointBrowserSession(file, browserSessionHash(raw), await context.storageState({ indexedDB: true }))
      await writeFile(marker, JSON.stringify({ ...receipt, status: result.saved ? 'refreshed' : 'superseded', finishedAt: new Date().toISOString() }), { mode: 0o600 })
    } catch (error) {
      if (error instanceof Error && /^ML_SESSION_[A-Z_]+$/.test(error.message)) code = error.message
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') code = 'ML_SESSION_AUTH_REQUIRED'
      await writeFile(marker, JSON.stringify({ ...receipt, status: 'failed', code, finishedAt: new Date().toISOString() }), { mode: 0o600 }).catch(() => undefined)
      if (!this.stopped) throw new Error(code)
    } finally { clearTimeout(timeout); await this.browser?.close().catch(() => undefined); this.browser = undefined }
  }
}
