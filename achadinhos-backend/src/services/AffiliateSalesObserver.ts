import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { dailyWindow, type DailyAutomationConfig } from '@/config/dailyAutomation'
import { normalizedMercadoLivreProductId } from '@/utils/offerIdentity'

interface ObservedSalesRow { cells: string[]; productLinks: string[] }
export interface AffiliateSale {
  key: string
  productId: string
  title: string
  saleDateLabel: string | null
  saleValueBRL: number | null
  commissionBRL: number | null
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
export function affiliateSale(row: ObservedSalesRow, userId: number, observedAt: string): AffiliateSale | null {
  if (row.cells.length !== 5) return null
  const order = row.cells[0].match(/#\s*(\d{8,30})/)?.[1]
  const productId = row.productLinks.map(url => url.match(/\b(MLBU?-?\d{5,})\b/i)?.[1])
    .map(id => id ? normalizedMercadoLivreProductId(id) : undefined).find(Boolean)
  if (!order || !productId) return null
  const title = row.cells[0].split(new RegExp(`#\\s*${order}`))[1]?.split(/Categoria:/i)[0].trim().replace(/\s+/g, ' ').slice(0, 300)
  if (!title || !row.cells[4].trim()) return null
  return {
    key: createHash('sha256').update(`${userId}:mercadolivre:${order}:${productId}`).digest('hex'),
    productId, title, saleDateLabel: row.cells[0].match(/\b\d{1,2}\/[a-zç]{3}\b/i)?.[0] ?? null,
    saleValueBRL: money(row.cells[2]), commissionBRL: money(row.cells[3]), status: row.cells[4].trim().slice(0, 80),
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
    try { await writeFile(path.join(directory, `${date}-last90.attempt`), new Date().toISOString(), { mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null; throw error }
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
      const table = page.locator('table').first()
      await table.waitFor({ timeout: 20_000 })
      // This UI selection was verified on the authenticated dashboard. No private API replay.
      await page.locator('main button').filter({ hasText: /\d.+\/(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i }).first().click({ timeout: 5000 })
      await page.getByText('Últimos 90 dias', { exact: true }).click({ timeout: 5000 })
      await page.locator('main button').filter({ hasText: /^Últimos 90 dias$/ }).first().waitFor({ timeout: 5000 })
      await page.waitForTimeout(1500)
      const headers = await table.locator('th').allTextContents()
      if (headers.map(x => x.trim()).join('|') !== 'Produtos|Loja|Valor da venda|Ganho por venda|Estado') throw new Error('SALES_REPORT_SCHEMA_CHANGED')
      const observedAt = new Date().toISOString()
      const sales: AffiliateSale[] = []
      let malformedRows = 0, complete = false
      const seenPages = new Set<string>()
      for (let index = 0; index < 10; index++) {
        const raw = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
          cells: [...row.querySelectorAll('td')].map(cell => (cell as HTMLElement).innerText.trim()),
          productLinks: [...row.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).href),
        })))
        const fingerprint = createHash('sha256').update(JSON.stringify(raw)).digest('hex')
        if (seenPages.has(fingerprint)) throw new Error('SALES_PAGINATION_STALLED')
        seenPages.add(fingerprint)
        for (const row of raw) { const sale = affiliateSale(row, userId, observedAt); if (sale) sales.push(sale); else malformedRows++ }
        const next = page.locator('.andes-pagination__button--next a, .andes-pagination__button--next button').first()
        if (!await next.count() || !await next.isVisible() || !await next.isEnabled() || await next.getAttribute('aria-disabled') === 'true') { complete = true; break }
        await next.click({ timeout: 5000 }); await page.waitForTimeout(750)
      }
      const file = path.join(directory, 'ledger.json')
      let previous: AffiliateSale[] = []
      try { previous = JSON.parse(await readFile(file, 'utf8')).sales }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const merged = mergeAffiliateSales(previous, sales)
      const snapshot = { schemaVersion: 1, userId, observedAt, report: 'last_90_completed_days', complete: complete && malformedRows === 0,
        malformedRows, rows: sales.length, sales, attributionNote: 'Product-level affiliate sales; group, caption and model causality are unknown. Pending/reviewed sales are not confirmed earnings.' }
      await atomicJson(path.join(directory, `${date}-last90.json`), snapshot)
      await atomicJson(file, { schemaVersion: 1, userId, updatedAt: observedAt, sales: merged })
      // Only a successfully authenticated/parsed report can replace rotated login state.
      await atomicJson(statePath, await context.storageState({ indexedDB: true }))
      return { rows: sales.length, newRows: merged.length - previous.length, complete: snapshot.complete }
    } finally { clearTimeout(timeout); await browser?.close().catch(() => undefined) }
  }
}
