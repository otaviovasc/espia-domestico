import type { OfferInput } from '@/dtos/campaign'

export interface DailySelectionPolicy {
  maxPerType?: number
  minRating: number
  minSoldCount: number
  minFitScore: number
  minCommercialScore: number
}

/** Current card observations are popularity proxies, never sales-per-day claims. */
export function dailyDemandScore(offer: OfferInput): number {
  const signals = offer.extensionEvidence?.visibleSignals
  const sold = signals?.soldCount
  const rating = signals?.rating
  const sales = sold === undefined ? 0 : Math.min(100, (Math.log10(sold + 1) / 5) * 100)
  const quality = rating === undefined ? 0 : Math.max(0, Math.min(100, ((rating - 3) / 2) * 100))
  return Math.round((0.55 * sales + 0.3 * quality + (signals?.bestSeller ? 15 : 0)) * 10) / 10
}

export function dailyEvidenceReasons(offer: OfferInput, policy: DailySelectionPolicy): string[] {
  const signals = offer.extensionEvidence?.visibleSignals
  const reasons: string[] = []
  if (signals?.timeLimited) reasons.push('Oferta temporária exige atualização antes do envio')
  if (signals?.rating === undefined) reasons.push('Avaliação de compradores não observada')
  else if (signals.rating < policy.minRating) reasons.push('Avaliação abaixo do mínimo diário')
  if (signals?.soldCount === undefined) reasons.push('Vendas acumuladas não observadas')
  else if (signals.soldCount < policy.minSoldCount)
    reasons.push('Evidência de vendas abaixo do mínimo diário')
  return reasons
}

export function dailySelectionReasons(
  offer: OfferInput,
  fit: number,
  score: number,
  policy: DailySelectionPolicy,
): string[] {
  const reasons = dailyEvidenceReasons(offer, policy)
  if (fit < policy.minFitScore) reasons.push('Afinidade insuficiente para a seleção diária')
  if (score < policy.minCommercialScore)
    reasons.push('Pontuação insuficiente para a seleção diária')
  return reasons
}
