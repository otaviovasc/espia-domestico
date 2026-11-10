import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AffiliateSale } from './AffiliateSalesObserver'

export interface SalesReportRange { from: string; to: string }
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})
const Sale = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/), productId: z.string().regex(/^MLBU?\d+$/),
  title: z.string().max(300), saleDateLabel: z.string().nullable(),
  observedCategory: z.string().max(120).nullable().optional(),
  saleDate: IsoDate.nullable().optional(), saleValueBRL: z.number().finite().nullable(),
  commissionBRL: z.number().finite().nullable(), commissionRatePercent: z.number().min(0).max(100).nullable().optional(),
  units: z.number().int().positive().nullable().optional(), status: z.string().max(80),
  observationAmbiguous: z.boolean().optional(), observationStatuses: z.array(z.string().max(80)).optional(), attribution: z.enum(['direct', 'indirect', 'unknown']),
  firstSeenAt: z.string().datetime(), lastSeenAt: z.string().datetime(),
})
const Capture = z.object({
  generationId: z.string().uuid(), userId: z.number().int().positive(), observedAt: z.string().datetime(),
  reportRange: z.object({ from: IsoDate, to: IsoDate }), complete: z.boolean(),
  rows: z.number().int().nonnegative(), malformedRows: z.number().int().nonnegative(), sales: z.array(Sale),
})
export type SalesCapture = z.infer<typeof Capture>
export type SalesStatus = 'pending' | 'cancelled' | 'settled' | 'unknown' | 'ambiguous'

/** Known pending label and explicit cancellation/return labels. Unknown never means paid. */
export function affiliateSalesStatus(value: string): SalesStatus {
  const status = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (status === 'EM REVISAO') return 'pending'
  if (['CANCELADA', 'CANCELADO', 'CANCELADA POR DEVOLUCAO', 'DEVOLVIDA', 'DEVOLVIDO', 'REEMBOLSADA', 'REEMBOLSADO'].includes(status)) return 'cancelled'
  return 'unknown'
}

/** Resolve a year only when exactly one valid date falls inside the observed report range. */
export function resolveAffiliateSaleDate(label: string | null, range: SalesReportRange): string | null {
  const match = label?.toLowerCase().match(/^(\d{1,2})\/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)$/)
  if (!match || range.from > range.to) return null
  const month = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].indexOf(match[2]) + 1
  const years = [Number(range.from.slice(0, 4)), Number(range.to.slice(0, 4))]
  const candidates = [...new Set(years)].map(year => `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`)
    .filter(date => {
      const parsed = new Date(`${date}T12:00:00Z`)
      return date >= range.from && date <= range.to && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    })
  return candidates.length === 1 ? candidates[0] : null
}

function observationIdentity(sale: AffiliateSale): string {
  return JSON.stringify([sale.productId, sale.title, sale.saleDateLabel, sale.saleDate, sale.saleValueBRL,
    sale.commissionBRL, sale.commissionRatePercent, sale.units, sale.status, sale.attribution, sale.observedCategory, sale.observationStatuses])
}

export function reconcileAffiliateSales(previous: AffiliateSale[], observed: AffiliateSale[]) {
  const variants = new Map<string, Map<string, AffiliateSale>>()
  let identicalDuplicateRows = 0
  for (const sale of observed) {
    const group = variants.get(sale.key) ?? new Map<string, AffiliateSale>()
    const fingerprint = observationIdentity(sale)
    if (group.has(fingerprint)) identicalDuplicateRows++
    group.set(fingerprint, sale); variants.set(sale.key, group)
  }
  const ledger = new Map(previous.map(sale => [sale.key, sale]))
  const changes: Array<{ key: string; productId: string; kind: 'newly_observed' | 'changed'; fieldsChanged: string[]; previousStatus: string | null; status: string; previousCommissionBRL: number | null; commissionBRL: number | null }> = []
  const collisions: Array<{ key: string; productId: string; variants: AffiliateSale[] }> = []
  for (const [key, group] of variants) {
    const choices = [...group.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, sale]) => sale)
    const old = ledger.get(key)
    // Conflicting rows could be line items or status variants. Do not silently add or pick a winner.
    const sale = { ...choices[0], observationAmbiguous: choices.length > 1,
      observationStatuses: choices.length > 1 ? [...new Set(choices.map(choice => choice.status))].sort() : undefined,
      firstSeenAt: old?.firstSeenAt ?? choices[0].firstSeenAt }
    if (choices.length > 1) collisions.push({ key, productId: sale.productId, variants: choices })
    if (!old || observationIdentity(old) !== observationIdentity(sale) || Boolean(old.observationAmbiguous) !== sale.observationAmbiguous) {
      const fieldsChanged = old ? (['status', 'commissionBRL', 'saleValueBRL', 'saleDate', 'commissionRatePercent', 'units', 'observedCategory', 'observationAmbiguous', 'observationStatuses'] as const)
        .filter(field => JSON.stringify(old[field]) !== JSON.stringify(sale[field])) : ['observedPurchase']
      changes.push({ key, productId: sale.productId, kind: old ? 'changed' : 'newly_observed', fieldsChanged, previousStatus: old?.status ?? null,
        status: sale.status, previousCommissionBRL: old?.commissionBRL ?? null, commissionBRL: sale.commissionBRL })
    }
    ledger.set(key, sale)
  }
  return { sales: [...ledger.values()].sort((a, b) => a.key.localeCompare(b.key)), changes, collisions, identicalDuplicateRows }
}

export function summarizeAffiliateSales(sales: AffiliateSale[], range?: SalesReportRange, latestObservedAt?: string) {
  const totals = Object.fromEntries(['pending', 'cancelled', 'settled', 'unknown', 'ambiguous'].map(status =>
    [status, { orders: 0, knownCommissionCents: 0, missingCommissionOrders: 0 }])) as Record<SalesStatus, { orders: number; knownCommissionCents: number; missingCommissionOrders: number }>
  let unresolvedOutsideCoverage = 0, unresolvedNotInLatestCapture = 0, unknownSaleDate = 0
  const unknownStatuses: Record<string, number> = Object.create(null)
  const demand = { observedPurchases: 0, ambiguousPurchases: 0, pendingPurchases: 0, indirectPurchases: 0,
    products: Object.create(null) as Record<string, number>, priceBands: { affordable: 0, middle: 0, premium: 0, unknown: 0 },
    categories: Object.create(null) as Record<string, number> }
  for (const sale of sales) {
    const status = sale.observationAmbiguous ? 'ambiguous' : affiliateSalesStatus(sale.status)
    totals[status].orders++
    if (status !== 'ambiguous' && sale.commissionBRL !== null) totals[status].knownCommissionCents += Math.round(sale.commissionBRL * 100)
    else totals[status].missingCommissionOrders++
    if (status === 'unknown') unknownStatuses[sale.status] = (unknownStatuses[sale.status] ?? 0) + 1
    if (!sale.saleDate) unknownSaleDate++
    const unresolved = ['pending', 'unknown', 'ambiguous'].includes(status)
    if (range && unresolved && (sale.saleDate ?? sale.lastSeenAt.slice(0, 10)) < range.from) unresolvedOutsideCoverage++
    if (unresolved && latestObservedAt && new Date(sale.lastSeenAt).getTime() < new Date(latestObservedAt).getTime()) unresolvedNotInLatestCapture++
    // A real purchase is useful immediately. Approval is a commission-accounting state, not a prerequisite for demand.
    const ambiguousDemand = status === 'ambiguous' && Boolean(sale.observationStatuses?.length) && sale.observationStatuses!.every(value => affiliateSalesStatus(value) !== 'cancelled')
    if (status !== 'cancelled' && (status !== 'ambiguous' || ambiguousDemand)) {
      demand.observedPurchases++
      if (ambiguousDemand) demand.ambiguousPurchases++
      if (status === 'pending' || ambiguousDemand && sale.observationStatuses!.every(value => affiliateSalesStatus(value) === 'pending')) demand.pendingPurchases++
      if (!ambiguousDemand && sale.attribution === 'indirect') demand.indirectPurchases++
      demand.products[sale.productId] = (demand.products[sale.productId] ?? 0) + 1
      const price = ambiguousDemand || sale.saleValueBRL === null || !sale.units ? null : sale.saleValueBRL / sale.units
      demand.priceBands[price === null ? 'unknown' : price <= 100 ? 'affordable' : price > 500 ? 'premium' : 'middle']++
      const category = ambiguousDemand ? 'unknown' : sale.observedCategory || 'unknown'
      demand.categories[category] = (demand.categories[category] ?? 0) + 1
    }
  }
  return { observedOrders: sales.length, totals, demand, unknownStatuses, unknownSaleDate, unresolvedOutsideCoverage, unresolvedNotInLatestCapture,
    attribution: 'unknown' as const, paidEarningsKnown: false as const }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temporary, file) }
  finally { await unlink(temporary).catch(() => undefined) }
}

const Generation = z.object({ schemaVersion: z.literal(2), capture: Capture, sales: z.array(Sale), changes: z.array(z.unknown()),
  collisions: z.array(z.unknown()), identicalDuplicateRows: z.number().int().nonnegative(), previousGenerationId: z.string().uuid().nullable() })
type Generation = z.infer<typeof Generation>

/** The pointer is the only publication boundary; orphaned writes cannot masquerade as complete data. */
export class AffiliateSalesState {
  constructor(readonly directory: string, readonly userId: number) {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('INVALID_SALES_CONTEXT')
  }

  async readGeneration(): Promise<Generation | null> {
    let raw: string
    try { raw = await readFile(path.join(this.directory, 'current.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const pointer = z.object({ generationId: z.string().uuid(), userId: z.literal(this.userId), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(JSON.parse(raw))
    const data = await readFile(path.join(this.directory, 'generations', `${pointer.generationId}.json`), 'utf8')
    if (createHash('sha256').update(data).digest('hex') !== pointer.sha256) throw new Error('SALES_STATE_INTEGRITY_FAILED')
    const result = Generation.parse(JSON.parse(data))
    if (result.capture.userId !== this.userId || result.capture.generationId !== pointer.generationId || !result.capture.complete) throw new Error('SALES_STATE_INTEGRITY_FAILED')
    return result
  }

  async baseline(): Promise<AffiliateSale[]> {
    const current = await this.readGeneration()
    if (current) return current.sales
    try {
      const legacy = z.object({ userId: z.literal(this.userId), sales: z.array(Sale) }).parse(JSON.parse(await readFile(path.join(this.directory, 'ledger.json'), 'utf8')))
      return legacy.sales
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }

  async publish(input: SalesCapture, beforePointer?: () => Promise<void>) {
    const capture = Capture.parse(input)
    if (capture.userId !== this.userId || capture.complete && capture.malformedRows > 0 || capture.rows !== capture.sales.length + capture.malformedRows) throw new Error('INVALID_SALES_CAPTURE')
    await mkdir(path.join(this.directory, 'generations'), { recursive: true, mode: 0o700 })
    const previous = await this.readGeneration()
    const reconciled = reconcileAffiliateSales(previous?.sales ?? await this.baseline(), capture.sales)
    const generation: Generation = { schemaVersion: 2, capture, ...reconciled, previousGenerationId: previous?.capture.generationId ?? null }
    // Partial observations are retained, but never replace the last complete report.
    const file = path.join(this.directory, 'generations', `${capture.generationId}.json`)
    await writeFile(file, JSON.stringify(generation), { mode: 0o600, flag: 'wx' })
    if (capture.complete) {
      await beforePointer?.()
      const data = await readFile(file)
      await atomicJson(path.join(this.directory, 'current.json'), { generationId: capture.generationId, userId: this.userId, sha256: createHash('sha256').update(data).digest('hex') })
    }
    return { generationId: capture.generationId, newRows: reconciled.changes.filter(change => change.kind === 'newly_observed').length,
      changedRows: reconciled.changes.filter(change => change.kind === 'changed').length,
      identicalDuplicateRows: reconciled.identicalDuplicateRows, ambiguousOrders: reconciled.collisions.length }
  }

  async report(now = new Date()) {
    const generation = await this.readGeneration()
    // Old data remains useful immediately, but its separately-written files are not a committed generation.
    const legacy = generation ? [] : await this.baseline()
    const Attempt = z.object({ userId: z.literal(this.userId), date: IsoDate, startedAt: z.string().datetime(),
      status: z.enum(['running', 'complete', 'partial', 'failed']), completedAt: z.string().datetime().optional(),
      code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(), generationId: z.string().uuid().optional() })
    let attempt: z.infer<typeof Attempt> | null = null
    try { attempt = Attempt.parse(JSON.parse(await readFile(path.join(this.directory, 'last-attempt.json'), 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    let latestPartial = null
    if (attempt?.status === 'partial' && attempt.generationId) {
      const partial = Generation.parse(JSON.parse(await readFile(path.join(this.directory, 'generations', `${attempt.generationId}.json`), 'utf8')))
      if (partial.capture.userId !== this.userId || partial.capture.generationId !== attempt.generationId || partial.capture.complete) throw new Error('SALES_STATE_INTEGRITY_FAILED')
      latestPartial = { generationId: partial.capture.generationId, observedAt: partial.capture.observedAt, unverified: true,
        rows: partial.capture.rows, malformedRows: partial.capture.malformedRows,
        summary: summarizeAffiliateSales(reconcileAffiliateSales([], partial.capture.sales).sales, partial.capture.reportRange, partial.capture.observedAt) }
    }
    const ageHours = generation ? Math.max(0, (now.getTime() - new Date(generation.capture.observedAt).getTime()) / 3_600_000) : null
    return { userId: this.userId, generationId: generation?.capture.generationId ?? null,
      completeness: generation ? 'complete' : legacy.length ? 'legacy_unverified' : 'unavailable', lastCompleteObservedAt: generation?.capture.observedAt ?? null,
      ageHours, stale: ageHours === null || ageHours > 36, attempt,
      attemptStale: attempt?.status === 'running' && now.getTime() - new Date(attempt.startedAt).getTime() > 120_000, latestPartial,
      summary: generation ? summarizeAffiliateSales(generation.sales, generation.capture.reportRange, generation.capture.observedAt) : legacy.length ? summarizeAffiliateSales(legacy) : null,
      changes: generation?.changes ?? [], collisions: generation?.collisions ?? [],
      note: 'Newly observed is not sold today. Ambiguous non-cancelled identities contribute at least one demand observation, never summed money. Partial observations are separate unverified lower bounds. Commissions are not proven payments or campaign attribution.' }
  }
}
