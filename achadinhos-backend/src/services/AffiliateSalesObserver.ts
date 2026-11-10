import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { dailyWindow, dailyDateOffset, type DailyAutomationConfig } from '@/config/dailyAutomation'
import { normalizedMercadoLivreProductId } from '@/utils/offerIdentity'
import { AffiliateSalesState, resolveAffiliateSaleDate, type SalesReportRange } from './AffiliateSalesState'

interface ObservedSalesRow { cells: string[]; productLinks: string[] }
export interface AffiliateSale {
  key: string
  productId: string
  title: string
  saleDateLabel: string | null
  saleDate?: string | null
  observedCategory?: string | null
  saleValueBRL: number | null
  commissionBRL: number | null
  commissionRatePercent?: number | null
  units?: number | null
  observationAmbiguous?: boolean
  observationStatuses?: string[]
  status: string
  attribution: 'direct' | 'indirect' | 'unknown'
  firstSeenAt: string
  lastSeenAt: string
}

function money(text: string): number | null {
  const value = text.match(/R\$\s*([\d.]+)(?:\s*,\s*(\d{2}))?/)
  return value ? Number(`${value[1].replace(/\./g, '')}.${value[2] ?? '00'}`) : null
}

/** No buyer data or raw order identifiers are retained. Never infer audience attribution. */
export function affiliateSale(row: ObservedSalesRow, userId: number, observedAt: string, range?: SalesReportRange): AffiliateSale | null {
  if (row.cells.length !== 5) return null
  const order = row.cells[0].match(/#\s*(\d{8,30})/)?.[1]
  const productId = row.productLinks.map(url => url.match(/\b(MLBU?-?\d{5,})\b/i)?.[1])
    .map(id => id ? normalizedMercadoLivreProductId(id) : undefined).find(Boolean)
  if (!order || !productId) return null
  const title = row.cells[0].split(new RegExp(`#\\s*${order}`))[1]?.split(/Categoria:/i)[0].trim().replace(/\s+/g, ' ').slice(0, 300)
  if (!title || !row.cells[4].trim()) return null
  const saleDateLabel = row.cells[0].match(/\b\d{1,2}\/[a-zç]{3}\b/i)?.[0] ?? null
  const rate = row.cells[3].match(/Venda (?:direta|indireta):\s*([\d.,]+)\s*%/i)?.[1]
  const units = row.cells[2].match(/\b(\d+)\s+unidades?\b/i)?.[1]
  return {
    key: createHash('sha256').update(`${userId}:mercadolivre:${order}:${productId}`).digest('hex'),
    productId, title, saleDateLabel, saleDate: range ? resolveAffiliateSaleDate(saleDateLabel, range) : null,
    observedCategory: row.cells[0].split(/Categoria:/i)[1]?.trim().slice(0, 120) || null,
    saleValueBRL: money(row.cells[2]), commissionBRL: money(row.cells[3]), status: row.cells[4].trim().slice(0, 80),
    commissionRatePercent: rate && Number.isFinite(Number(rate.replace(',', '.'))) && Number(rate.replace(',', '.')) <= 100 ? Number(rate.replace(',', '.')) : null,
    units: units && Number.isSafeInteger(Number(units)) && Number(units) > 0 ? Number(units) : null,
    attribution: /venda indireta/i.test(row.cells[3]) ? 'indirect' : /venda direta/i.test(row.cells[3]) ? 'direct' : 'unknown',
    firstSeenAt: observedAt, lastSeenAt: observedAt,
  }
}

export function mergeAffiliateSales(previous: AffiliateSale[], observed: AffiliateSale[]): AffiliateSale[] {
  const rows = new Map(previous.map(row => [row.key, row]))
  for (const row of observed) rows.set(row.key, { ...row, firstSeenAt: rows.get(row.key)?.firstSeenAt ?? row.firstSeenAt })
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key))
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temporary, file) }
  finally { await unlink(temporary).catch(() => undefined) }
}

export function affiliateSalesErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const codes: Record<string, string> = {
    AUTH_REQUIRED: 'AFFILIATE_SALES_AUTH_REQUIRED', SALES_REPORT_SCHEMA_CHANGED: 'AFFILIATE_SALES_SCHEMA_CHANGED',
    SALES_PAGINATION_STALLED: 'AFFILIATE_SALES_PAGINATION_STALLED', SALES_REPORT_INCOMPLETE: 'AFFILIATE_SALES_INCOMPLETE',
    SALES_STATE_INTEGRITY_FAILED: 'AFFILIATE_SALES_STATE_INVALID',
  }
  return codes[message] ?? (error instanceof Error && error.name === 'TimeoutError' ? 'AFFILIATE_SALES_TIMEOUT' : 'AFFILIATE_SALES_OBSERVATION_FAILED')
}

async function waitForLoadedSales(page: Page): Promise<void> {
  // Headers, a selected preset and absent pagination do not prove data has loaded.
  // No live empty-state marker has been verified: preserve prior data instead of certifying zero.
  await page.waitForFunction(() => [...document.querySelectorAll('table tbody tr')].some(row => {
    const cells = [...row.querySelectorAll('td')].map(cell => (cell as HTMLElement).innerText.trim())
    return cells.length === 5 && /#\s*\d{8,30}\b/.test(cells[0]) && /R\$/.test(cells[2]) && Boolean(cells[4])
  }), undefined, { timeout: 10_000 })
}

/** Observational ledger only. It cannot approve, change rankings or send messages. */
export class AffiliateSalesObserver {
  async tick(config: DailyAutomationConfig, now = new Date()): Promise<void> {
    const date = dailyWindow(config, now).date
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now)
    if (time < config.collectTime) return
    const result = await this.capture(config.userId, date)
    if (result && !result.complete) throw new Error('SALES_REPORT_INCOMPLETE')
  }

  async capture(userId: number, date: string): Promise<{ rows: number; newRows: number; complete: boolean } | null> {
    if (!Number.isSafeInteger(userId) || userId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_SALES_CONTEXT')
    const statePath = process.env.DAILY_BROWSER_STATE_PATH
    if (!statePath) throw new Error('AUTH_REQUIRED')
    const directory = path.join(path.dirname(statePath), '..', 'affiliate-sales', `account-${userId}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // Claim before browsing. A crash/failure cannot trigger a browser allocation every 30 seconds.
    const attemptPath = path.join(directory, `${date}-last90.attempt`)
    const startedAt = new Date().toISOString()
    const attempt = { userId, date, startedAt, status: 'running' }
    try { await writeFile(attemptPath, JSON.stringify(attempt), { mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null; throw error }
    await atomicJson(path.join(directory, 'last-attempt.json'), attempt)
    let browser: Browser | undefined
    const timeout = setTimeout(() => { void browser?.close().catch(() => undefined) }, 90_000)
    try {
      browser = await chromium.launch({ headless: true, timeout: 30_000 })
      const context = await browser.newContext({ storageState: JSON.parse(await readFile(statePath, 'utf8')),
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
        locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
      await context.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue())
      const page = await context.newPage()
      await page.goto('https://www.mercadolivre.com.br/afiliados/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 })
      if (!new URL(page.url()).pathname.startsWith('/afiliados') || await page.locator('input[type="password"]').count()) throw new Error('AUTH_REQUIRED')
      const table = page.locator('table').first()
      await table.waitFor({ timeout: 20_000 })
      await waitForLoadedSales(page)
      // This UI selection was verified on the authenticated dashboard. No private API replay.
      const selectedPeriod = page.locator('main button').filter({ hasText: /^Últimos 90 dias$/ }).first()
      if (!await selectedPeriod.count() || !await selectedPeriod.isVisible()) {
        const previousPeriodView = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('table tbody, .andes-pagination')].map(node => node.textContent)))
        await page.locator('main button').filter({ hasText: /\d.+\/(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)|^últimos\s+\d+\s+dias$|^este\s+mês$|^hoje$|^ontem$/i }).first().click({ timeout: 5000 })
        await page.getByText('Últimos 90 dias', { exact: true }).click({ timeout: 5000 })
        await selectedPeriod.waitFor({ timeout: 5000 })
        await page.waitForFunction(previous => Boolean((document.querySelector('table tbody') as HTMLElement | null)?.innerText.trim()) && JSON.stringify([...document.querySelectorAll('table tbody, .andes-pagination')].map(node => node.textContent)) !== previous, previousPeriodView, { timeout: 10_000 })
      }
      // Tracking requests may never go idle; the explicit table transition above certifies reload.
      await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => undefined)
      const headers = await table.locator('th').allTextContents()
      if (headers.map(x => x.trim()).join('|') !== 'Produtos|Loja|Valor da venda|Ganho por venda|Estado') throw new Error('SALES_REPORT_SCHEMA_CHANGED')
      const observedAt = new Date().toISOString()
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(observedAt))
      const reportRange = { from: dailyDateOffset(localDate, -90), to: dailyDateOffset(localDate, -1) }
      const sales: AffiliateSale[] = []
      let malformedRows = 0, complete = false
      const seenPages = new Set<string>()
      for (let index = 0; index < 10; index++) {
        await waitForLoadedSales(page)
        const raw = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
          cells: [...row.querySelectorAll('td')].map(cell => (cell as HTMLElement).innerText.trim()),
          productLinks: [...row.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).href),
        })))
        const fingerprint = createHash('sha256').update(JSON.stringify(raw)).digest('hex')
        if (seenPages.has(fingerprint)) throw new Error('SALES_PAGINATION_STALLED')
        seenPages.add(fingerprint)
        for (const row of raw) { const sale = affiliateSale(row, userId, observedAt, reportRange); if (sale) sales.push(sale); else malformedRows++ }
        const next = page.locator('.andes-pagination__button--next a, .andes-pagination__button--next button').first()
        const disabled = await next.count() ? await next.evaluate(node => Boolean(node.closest('[aria-disabled="true"], .andes-pagination__button--disabled'))) : false
        if (!await next.count() || !await next.isVisible() || !await next.isEnabled() || disabled) { complete = true; break }
        const previousPage = await table.locator('tbody').innerText()
        await next.click({ timeout: 5000 })
        await page.waitForFunction(previous => Boolean((document.querySelector('table tbody') as HTMLElement | null)?.innerText.trim()) && (document.querySelector('table tbody') as HTMLElement).innerText !== previous, previousPage, { timeout: 10_000 })
        await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => undefined)
      }
      // Only a successfully authenticated/parsed report can replace rotated login state.
      await atomicJson(statePath, await context.storageState({ indexedDB: true }))
      const state = new AffiliateSalesState(directory, userId)
      const result = await state.publish({ generationId: randomUUID(), userId, observedAt, reportRange, complete: complete && malformedRows === 0,
        malformedRows, rows: sales.length + malformedRows, sales })
      const finished = { ...attempt, status: complete && malformedRows === 0 ? 'complete' : 'partial',
        completedAt: new Date().toISOString(), code: complete && malformedRows === 0 ? 'SUCCESS' : 'AFFILIATE_SALES_INCOMPLETE', ...result }
      await atomicJson(attemptPath, finished)
      await atomicJson(path.join(directory, 'last-attempt.json'), finished)
      return { rows: sales.length, newRows: result.newRows, complete: complete && malformedRows === 0 }
    } catch (error) {
      const failed = { ...attempt, status: 'failed', completedAt: new Date().toISOString(), code: affiliateSalesErrorCode(error) }
      await atomicJson(attemptPath, failed).catch(() => undefined)
      await atomicJson(path.join(directory, 'last-attempt.json'), failed).catch(() => undefined)
      throw error
    } finally { clearTimeout(timeout); await browser?.close().catch(() => undefined) }
  }
}
