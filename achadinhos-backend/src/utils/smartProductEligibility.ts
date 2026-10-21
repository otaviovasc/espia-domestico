import type { SmartAudiencePolicy } from '@/database/models/SmartAudience'
import type { OfferInput } from '@/dtos/campaign'

type EligibilityPolicy = Partial<Pick<SmartAudiencePolicy,
  'excludePolitical' | 'minPrice' | 'maxPrice' | 'minCommissionPercent' | 'minEstimatedCommission'
>>
type EligibilityOffer = Pick<OfferInput,
  'title' | 'description' | 'discountedPrice' | 'currency' | 'commissionRate' | 'commissionPercent' | 'extensionEvidence'
>

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ')
}

function words(pattern: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'u')
}

// Best-effort lexical exclusion, not a political classification of people or sellers.
// Only explicit title/description text is inspected, independently per field. Ambiguous
// names/acronyms alone (Lula, PT, PL, Moro, etc.) are not evidence. Lula requires a nearby
// political cue; culinary/generic uses and substring matches are deliberately retained.
const EXPLICIT_POLITICAL = words([
  'politic[ao]s?', 'eleic(?:ao|oes)', 'eleitoral', 'campanha eleitoral',
  'partido politico', 'partido dos trabalhadores', 'partido liberal',
  'bolsonaro', 'bolsonarismo', 'bolsonarista[s]?', 'lulismo', 'lulista[s]?',
  'luiz inacio lula da silva', 'dilma rousseff', 'fernando henrique cardoso',
  'sergio moro', 'alexandre de moraes', 'donald trump', 'joe biden',
  'impeachment', 'comunismo', 'fascismo', 'socialismo',
].join('|'))
const LULA_CONTEXT = words([
  'lula(?:[\\s,.:;!?-]+[\\p{L}\\p{N}]+){0,3}[\\s,.:;!?-]+(?:presidente|presidencial|governo|pt|13|livre|ladrao)',
  '(?:presidente|presidencial|governo|voto|vote|fora|faz o l|pt)(?:[\\s,.:;!?-]+[\\p{L}\\p{N}]+){0,3}[\\s,.:;!?-]+lula',
].join('|'))

export function hasExplicitPoliticalMention(offer: Pick<OfferInput, 'title' | 'description'>): boolean {
  return [offer.title, offer.description].some((field) => {
    if (!field) return false
    const text = normalize(field)
    return EXPLICIT_POLITICAL.test(text) || LULA_CONTEXT.test(text)
  })
}

// Keep the existing collected-rate precedence and percent-string interpretation.
// Attribution, commission evidence and freshness remain separate lifecycle gates.
export function collectedSmartCommissionRate(offer: Pick<OfferInput, 'commissionRate' | 'commissionPercent' | 'extensionEvidence'>): number | null {
  if (typeof offer.commissionRate === 'number' && Number.isFinite(offer.commissionRate))
    return Math.max(0, Math.min(100, offer.commissionRate))
  const text = offer.commissionPercent?.trim() ?? ''
  if (/^\d+(?:[.,]\d+)?\s*%?$/.test(text)) {
    const parsed = Number(text.replace('%', '').replace(',', '.'))
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
  }
  const percent = offer.extensionEvidence?.commission?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? percent : null
}

export function smartCommissionRate(offer: EligibilityOffer): number {
  return collectedSmartCommissionRate(offer) ?? 0
}

/** All supplied policies must pass; live changes cannot relax the approved snapshot. */
export function evaluateSmartProductEligibility(offer: EligibilityOffer, ...policies: EligibilityPolicy[]) {
  const reasons = new Set<string>()
  const rate = collectedSmartCommissionRate(offer)
  const estimatedCommission = rate === null || !Number.isFinite(offer.discountedPrice)
    ? null : (offer.discountedPrice * rate) / 100
  for (const policy of policies) {
    if (policy.excludePolitical && hasExplicitPoliticalMention(offer))
      reasons.add('Menção política explícita no título ou descrição')
    const monetaryGate = policy.minPrice !== undefined || policy.maxPrice !== undefined ||
      (policy.minEstimatedCommission ?? 0) > 0
    if (monetaryGate && (offer.currency ?? 'BRL').toUpperCase() !== 'BRL')
      reasons.add('Limites monetários exigem preço em BRL')
    if (monetaryGate && (!Number.isFinite(offer.discountedPrice) || offer.discountedPrice < 0))
      reasons.add('Preço inválido para os limites monetários')
    if (policy.minPrice !== undefined && offer.discountedPrice < policy.minPrice)
      reasons.add('Preço abaixo do mínimo')
    if (policy.maxPrice !== undefined && offer.discountedPrice > policy.maxPrice)
      reasons.add('Preço acima do máximo')
    if (policy.minCommissionPercent !== undefined) {
      if (rate === null) reasons.add('Comissão não informada na coleta')
      else if (rate < policy.minCommissionPercent) reasons.add('Comissão abaixo do mínimo')
    }
    if (policy.minEstimatedCommission !== undefined) {
      if (estimatedCommission === null) reasons.add('Comissão estimada não disponível')
      else if (estimatedCommission < policy.minEstimatedCommission)
        reasons.add('Comissão estimada abaixo do mínimo')
    }
  }
  return { eligible: reasons.size === 0, reasons: [...reasons], rate, estimatedCommission }
}
