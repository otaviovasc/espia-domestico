import type { DailyAudienceSlug, DailyPayload } from '@/services/DailyProductCollector'
import { dailyVariantKey } from '@/utils/dailyAssortment'

export const DAILY_REJECTION_CODES = ['novelty', 'cooldown', 'variant', 'offAudience', 'freshness', 'price', 'quality', 'commission', 'attribution', 'historyUnclassified', 'repeatNotReady', 'other'] as const
type Rejections = Record<(typeof DAILY_REJECTION_CODES)[number], number>
export interface DailyCollectionObservation {
  keywordsTried: number
  candidatesReturned: number
  durationMs: number
  rejectedByReason: Rejections
}
export interface DailyCollectionMetrics {
  observations: Record<string, DailyCollectionObservation>
  durationMs?: number
  summaryLogged?: boolean
}

const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const emptyRejections = (): Rejections => Object.fromEntries(DAILY_REJECTION_CODES.map(code => [code, 0])) as Rejections

/** Numeric allowlist only: never copy search terms, cards, URLs or error text. */
export function dailyCollectionObservation(payload: DailyPayload, noveltyRejected = 0): DailyCollectionObservation {
  const search = object(payload.json.search)
  const telemetry = object(payload.json.dailyCollection)
  const rejectedByReason = emptyRejections()
  for (const code of DAILY_REJECTION_CODES) rejectedByReason[code] = count(object(telemetry.rejectedByReason)[code])
  // Legacy extractor counts cannot distinguish reservation, cooldown or same-run exclusions.
  rejectedByReason.historyUnclassified += count(payload.json.excludedPreviouslyUsed)
  rejectedByReason.novelty += noveltyRejected
  return {
    keywordsTried: Array.isArray(search.keywords) ? search.keywords.length : 0,
    candidatesReturned: Array.isArray(payload.json.cards) ? payload.json.cards.length : Array.isArray(payload.json.offers) ? payload.json.offers.length : 0,
    durationMs: count(payload.json.collectionDurationMs),
    rejectedByReason,
  }
}

/** Rejection counts are gate occurrences, not a disjoint count of unique products.
 * Plan counts are a current snapshot; collection observations are keyed by durable round.
 */
export function dailyCollectionSummary(metrics: DailyCollectionMetrics, items: Record<string, unknown>[], repeatCooldownDays = 0) {
  const audiences = Object.fromEntries((['domestica', 'masculino'] as const).map(slug => [slug, {
    keywordsTried: 0, candidatesReturned: 0, qualified: 0, freshSelected: 0, repeatSelected: 0,
    reservesKept: 0, collectionDurationMs: 0, rejectedByReason: emptyRejections(),
  }])) as Record<DailyAudienceSlug, { keywordsTried: number; candidatesReturned: number; qualified: number; freshSelected: number; repeatSelected: number; reservesKept: number; collectionDurationMs: number; rejectedByReason: Rejections }>
  for (const [key, observation] of Object.entries(metrics.observations)) {
    const slug = key.split(':').pop()
    if (slug !== 'domestica' && slug !== 'masculino') continue
    const audience = audiences[slug]
    audience.keywordsTried += count(observation.keywordsTried)
    audience.candidatesReturned += count(observation.candidatesReturned)
    audience.collectionDurationMs += count(observation.durationMs)
    for (const code of DAILY_REJECTION_CODES) audience.rejectedByReason[code] += count(observation.rejectedByReason[code])
  }
  const variant = (item: Record<string, unknown>) => {
    const title = object(item.product).title
    return dailyVariantKey({ title: typeof title === 'string' ? title : undefined })
  }
  const selectedVariants = new Set(items.filter(item => item.state === 'SELECTED').map(variant).filter(Boolean))
  for (const item of items) {
    if (item.audienceSlug !== 'domestica' && item.audienceSlug !== 'masculino') continue
    const audience = audiences[item.audienceSlug]
    if (item.state === 'SELECTED') {
      audience[item.repeatFallback ? 'repeatSelected' : 'freshSelected']++
      audience.qualified++
    } else if (item.state === 'RESERVE') {
      audience.reservesKept++
      // Reserves removed by approval gates are retained inventory, not qualified.
      if (!Array.isArray(item.warnings) || !item.warnings.some(w => /^DAILY_ITEM_(?:ELIGIBILITY|NOVELTY|FRESHNESS|REPEAT_NOT_READY)$/.test(String(w)))) audience.qualified++
    }
    if (item.state === 'SELECTED') continue
    const reason = item.state === 'REJECTED' && typeof item.reason === 'string' ? item.reason : ''
    const warnings = Array.isArray(item.warnings) ? item.warnings.filter(w => typeof w === 'string' && /^DAILY_ITEM_/.test(w)).join(' ') : ''
    const gates: Array<[(typeof DAILY_REJECTION_CODES)[number], boolean]> = [
      ['historyUnclassified', /reservado, incerto ou dentro do intervalo|DAILY_ITEM_NOVELTY/.test(`${reason} ${warnings}`)],
      ['repeatNotReady', /DAILY_ITEM_REPEAT_NOT_READY/.test(warnings) && repeatCooldownDays > 0],
      ['variant', /DAILY_ITEM_DUPLICATE|variante/i.test(`${reason} ${warnings}`) || (item.state === 'RESERVE' && selectedVariants.has(variant(item)))],
      ['offAudience', /afinidade|outro público/i.test(reason)],
      ['freshness', /antiga|temporária|observação ausente|DAILY_ITEM_FRESHNESS/.test(`${reason} ${warnings}`)],
      ['price', /[Pp]reço|monetários/.test(reason)],
      ['quality', /[Aa]valiação|[Vv]endas|[Pp]ontuação|DAILY_ITEM_ELIGIBILITY/.test(`${reason} ${warnings}`)],
      ['commission', /[Cc]omissão/.test(reason)],
      ['attribution', /[Aa]tribuição/.test(reason)],
    ]
    for (const [code, matched] of gates) if (matched) audience.rejectedByReason[code]++
    if (item.state === 'REJECTED' && !gates.some(([, matched]) => matched)) audience.rejectedByReason.other++
  }
  return { schemaVersion: 1, collectionDurationMs: metrics.durationMs ?? Object.values(audiences).reduce((sum, a) => sum + a.collectionDurationMs, 0), audiences }
}

/** Classify known operational text; arbitrary/provider text never leaves this function. */
export function dailySendReason(status: string, reason: string | null): string {
  if (status === 'SENDING') return 'SEND_SETTLEMENT_UNCONFIRMED'
  if (status === 'SENT') return 'PROVIDER_CONFIRMED'
  if (status === 'UNKNOWN') return 'PROVIDER_CONFIRMATION_UNKNOWN'
  if (status === 'FAILED') return 'ATTEMPTS_EXHAUSTED'
  const value = reason ?? ''
  if (/Falha interna/.test(value)) return 'INTERNAL_ERROR'
  if (/público.*desativado/i.test(value)) return 'AUDIENCE_DISABLED'
  if (/filtros/.test(value)) return 'AUDIENCE_POLICY'
  if (/conexão|WhatsApp indisponível/i.test(value)) return 'CONNECTION_UNAVAILABLE'
  if (/vinculado|Grupo indisponível/.test(value)) return 'DESTINATION_UNAVAILABLE'
  if (/Produto reservado ou entregue/.test(value)) return 'DAILY_PRODUCT_CONFLICT'
  if (/já foi enviado|Outro processo reservou/.test(value)) return 'DUPLICATE_DELIVERY'
  if (/Campanha manual/.test(value)) return 'MANUAL_CAMPAIGN_ACTIVE'
  if (/intervalo seguro ultrapassa/.test(value)) return 'GAP_EXCEEDS_WINDOW'
  if (/Intervalo de segurança/.test(value)) return 'SHARED_CADENCE'
  if (/Limite diário/.test(value)) return 'DAILY_CAP'
  if (/expirada|venceria|vencerá/.test(value)) return 'EVIDENCE_EXPIRED'
  if (/próxima janela segura/.test(value)) return 'NEXT_WINDOW'
  if (/janela diária|Janela|janela, evidência/i.test(value)) return 'WINDOW_CLOSED'
  if (/plano não está agendado/.test(value)) return 'PLAN_NOT_SCHEDULED'
  return 'STATE_CHANGED'
}
