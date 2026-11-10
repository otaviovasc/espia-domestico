import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page, type Response } from 'playwright'
import { env } from '@/config/env'
import { dailyDateOffset, type DailyAutomationConfig } from '@/config/dailyAutomation'
import { normalizedMercadoLivreProductId } from '@/utils/offerIdentity'
import { AffiliateSalesState, resolveAffiliateSaleDate, type SalesReportRange } from './AffiliateSalesState'
import { browserSessionHash, checkpointBrowserSession } from './PrivateBrowserSession'

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
    SALES_ROWS_NOT_LOADED: 'AFFILIATE_SALES_ROWS_NOT_LOADED', SALES_REPORT_NOT_LOADED: 'AFFILIATE_SALES_REPORT_NOT_LOADED',
    SALES_STATE_INTEGRITY_FAILED: 'AFFILIATE_SALES_STATE_INVALID',
  }
  return codes[message] ?? (error instanceof Error && error.name === 'TimeoutError' ? 'AFFILIATE_SALES_TIMEOUT' : 'AFFILIATE_SALES_OBSERVATION_FAILED')
}

interface LoadedSalesReport {
  page: number; perPage: number; total: number
  items: Array<{ order: string; status: string }>
}

/** Observe only the page's own requests. Never replay the private report API. */
function observeSalesReports(page: Page, range: SalesReportRange): { wait: (number: number) => Promise<LoadedSalesReport> } {
  const from = new Date(`${range.from}T00:00:00-03:00`).getTime()
  const until = new Date(`${dailyDateOffset(range.to, 1)}T00:00:00-03:00`).getTime()
  // Response metadata encodes calendar boundaries at UTC midnight; request dates use -03:00.
  const responseRange = `${Date.parse(`${range.from}T00:00:00Z`)}--${Date.parse(`${dailyDateOffset(range.to, 1)}T00:00:00Z`)}`
  const reports = new Map<number, LoadedSalesReport>()
  const receive = async (response: Response): Promise<void> => {
    const url = new URL(response.url())
    if (url.origin !== 'https://www.mercadolivre.com.br' || url.pathname !== '/affiliate-program/api/dashboard/sales/general' || !response.ok()) return
    const queryRange = url.searchParams.get('filter_time_range')?.split('--').map(value => new Date(value).getTime())
    if (queryRange?.length !== 2 || queryRange[0] !== from || queryRange[1] !== until) return
    const body = await response.json()
    const { page: number, items_per_page: perPage, total_results: total, item_list: items } = body
    if (body.filter_time_range !== responseRange || !Number.isSafeInteger(number) || number < 1 ||
      !Number.isSafeInteger(perPage) || perPage < 1 || !Number.isSafeInteger(total) || total < 0 || !Array.isArray(items) ||
      items.length !== Math.min(perPage, Math.max(0, total - (number - 1) * perPage))) return
    const parsed: LoadedSalesReport['items'] = []
    for (const item of items) {
      // Direct rows expose purchaseId; indirect rows display id instead (verified live).
      const order = item.purchaseId ?? item.id
      if ((!Number.isSafeInteger(order) && typeof order !== 'string') || !/^\d{8,30}$/.test(String(order)) || typeof item.status !== 'string' || !item.status.trim()) return
      const status = item.status === 'IN_REVIEW' ? 'EM REVISÃO' : ['CANCELLED', 'CANCELED'].includes(item.status) ? 'CANCELADA' : item.status
      parsed.push({ order: String(order), status })
    }
    reports.set(number, { page: number, perPage, total, items: parsed })
  }
  page.on('response', response => { void receive(response).catch(() => undefined) })
  return { wait: async number => {
    const deadline = Date.now() + 15_000
    while (!reports.has(number) && !page.isClosed() && Date.now() < deadline) await page.waitForTimeout(100)
    const report = reports.get(number)
    if (!report) throw new Error('SALES_REPORT_NOT_LOADED')
    return report
  } }
}

async function waitForLoadedSales(page: Page, report: LoadedSalesReport): Promise<void> {
  // The response certifies empty reports and page totals. DOM rows must match its identities
  // and statuses, so loading placeholders or previous-period rows cannot certify freshness.
  if (!report.items.length) return
  try {
    await page.waitForFunction(expected => {
      const rows = [...document.querySelectorAll('table tbody tr')]
      const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
      return rows.length === expected.length && rows.every((row, index) => {
        const cells = [...row.querySelectorAll('td')].map(cell => (cell as HTMLElement).innerText.trim())
        return cells.length === 5 && cells[0].match(/#\s*(\d{8,30})\b/)?.[1] === expected[index].order &&
          /R\$/.test(cells[2]) && (normalize(cells[4]) === normalize(expected[index].status) || expected[index].status === 'CANCELADA' && normalize(cells[4]).startsWith('CANCELADA '))
      })
    }, report.items, { timeout: 10_000 })
  } catch { throw new Error('SALES_ROWS_NOT_LOADED') }
}

export function affiliateSalesSlot(now: Date, hours: number): { date: string; key: string; start: Date } {
  if (![3, 6, 12].includes(hours)) throw new Error('INVALID_SALES_INTERVAL')
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', hour: '2-digit' }).format(now))
  const boundary = String(Math.floor(hour / hours) * hours).padStart(2, '0')
  return { date, key: `h${hours}-${boundary}`, start: new Date(`${date}T${boundary}:00:00-03:00`) }
}

async function selectSalesPeriod(page: Page, label: string): Promise<void> {
  const selected = page.locator('main button').filter({ hasText: new RegExp(`^${label}$`) }).first()
  if (await selected.count() && await selected.isVisible()) return
  await page.locator('main button').filter({ hasText: /\d.+\/(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)|^últimos\s+\d+\s+dias$|^este\s+mês$|^hoje$|^ontem$/i }).first().click({ timeout: 5000 })
  await page.getByText(label, { exact: true }).click({ timeout: 5000 })
  await selected.waitFor({ timeout: 5000 })
}

async function readSalesPeriod(page: Page, responses: ReturnType<typeof observeSalesReports>, userId: number, observedAt: string, range: SalesReportRange) {
  const table = page.locator('table').first(), sales: AffiliateSale[] = []
  let malformedRows = 0, complete = false, expectedTotal: number | undefined, expectedPerPage: number | undefined
  const seenPages = new Set<string>()
  for (let index = 0; index < 10; index++) {
    const report = await responses.wait(index + 1)
    expectedTotal ??= report.total
    expectedPerPage ??= report.perPage
    if (report.total !== expectedTotal || report.perPage !== expectedPerPage) throw new Error('SALES_REPORT_INCOMPLETE')
    await waitForLoadedSales(page, report)
    if (report.items.length) {
      const headers = await table.locator('th').allTextContents()
      if (headers.map(x => x.trim()).join('|') !== 'Produtos|Loja|Valor da venda|Ganho por venda|Estado') throw new Error('SALES_REPORT_SCHEMA_CHANGED')
    }
    const raw = report.items.length ? await table.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
      cells: [...row.querySelectorAll('td')].map(cell => (cell as HTMLElement).innerText.trim()),
      productLinks: [...row.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).href),
    }))) : []
    const fingerprint = createHash('sha256').update(JSON.stringify(raw)).digest('hex')
    if (seenPages.has(fingerprint)) throw new Error('SALES_PAGINATION_STALLED')
    seenPages.add(fingerprint)
    for (const row of raw) { const sale = affiliateSale(row, userId, observedAt, range); if (sale) sales.push(sale); else malformedRows++ }
    if ((index + 1) * report.perPage >= report.total) { complete = sales.length + malformedRows === report.total; break }
    const next = page.locator('.andes-pagination__button--next a, .andes-pagination__button--next button').first()
    await next.waitFor({ state: 'visible', timeout: 10_000 })
    await next.click({ timeout: 5000 })
  }
  return { sales, malformedRows, complete }
}

/** Observational ledger only. It cannot approve, change rankings or send messages. */
export class AffiliateSalesObserver {
  async tick(config: DailyAutomationConfig, now = new Date()): Promise<void> {
    const slot = affiliateSalesSlot(now, env.DAILY_SALES_ALERT_INTERVAL_HOURS)
    const result = await this.capture(config.userId, slot.date, { slot: slot.key, includeToday: true })
    if (result && !result.complete) throw new Error('SALES_REPORT_INCOMPLETE')
  }

  async capture(userId: number, date: string, options: { slot?: string; includeToday?: boolean } = {}): Promise<{ rows: number; newRows: number; complete: boolean } | null> {
    if (!Number.isSafeInteger(userId) || userId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_SALES_CONTEXT')
    if (options.slot && !/^[a-z0-9-]{1,60}$/.test(options.slot)) throw new Error('INVALID_SALES_CONTEXT')
    const statePath = process.env.DAILY_BROWSER_STATE_PATH
    if (!statePath) throw new Error('AUTH_REQUIRED')
    const directory = path.join(path.dirname(statePath), '..', 'affiliate-sales', `account-${userId}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // Claim before browsing. A crash/failure cannot trigger a browser allocation every 30 seconds.
    const attemptPath = path.join(directory, `${date}-${options.slot ?? 'last90'}.attempt`)
    const startedAt = new Date().toISOString()
    const attempt = { userId, date, startedAt, status: 'running' }
    try { await writeFile(attemptPath, JSON.stringify(attempt), { mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null; throw error }
    await atomicJson(path.join(directory, 'last-attempt.json'), attempt)
    let browser: Browser | undefined
    const timeout = setTimeout(() => { void browser?.close().catch(() => undefined) }, 90_000)
    try {
      browser = await chromium.launch({ headless: true, timeout: 30_000 })
      const sessionRaw = await readFile(statePath, 'utf8')
      const context = await browser.newContext({ storageState: JSON.parse(sessionRaw),
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
        locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
      await context.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue())
      const page = await context.newPage()
      const observedAt = new Date().toISOString()
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(observedAt))
      const historicalRange = { from: dailyDateOffset(localDate, -90), to: dailyDateOffset(localDate, -1) }
      const todayRange = { from: localDate, to: localDate }
      const reportRange = { ...historicalRange, to: options.includeToday ? localDate : historicalRange.to }
      const responses = observeSalesReports(page, historicalRange)
      const todayResponses = options.includeToday ? observeSalesReports(page, todayRange) : null
      await page.goto('https://www.mercadolivre.com.br/afiliados/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 })
      if (!new URL(page.url()).pathname.startsWith('/afiliados') || await page.locator('input[type="password"]').count()) throw new Error('AUTH_REQUIRED')
      const table = page.locator('table').first()
      await table.waitFor({ timeout: 20_000 })
      await selectSalesPeriod(page, 'Últimos 90 dias')
      const historical = await readSalesPeriod(page, responses, userId, observedAt, historicalRange)
      let { sales, malformedRows, complete } = historical
      if (todayResponses) {
        await selectSalesPeriod(page, 'Hoje')
        const today = await readSalesPeriod(page, todayResponses, userId, observedAt, todayRange)
        sales = [...sales, ...today.sales]
        malformedRows += today.malformedRows
        complete = complete && today.complete
      }
      // Only a successfully authenticated/parsed report can replace rotated login state.
      await checkpointBrowserSession(statePath, browserSessionHash(sessionRaw), await context.storageState({ indexedDB: true }))
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
