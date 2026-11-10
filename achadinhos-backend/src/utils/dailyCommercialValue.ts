import type { OfferInput } from '@/dtos/campaign'
import { collectedSmartCommissionRate } from '@/utils/smartProductEligibility'
import { dailyDemandScore } from '@/utils/dailyProductSelection'

/** A ranking heuristic, not a measured purchase probability or revenue forecast. */
export function dailyCommercialValue(offer: OfferInput, fit: number) {
  const price = Math.max(0, offer.discountedPrice)
  const grossCommissionBrl = price * (collectedSmartCommissionRate(offer) ?? 0) / 100
  const affordability = 1 / Math.sqrt(1 + price / 250)
  const evidence = (0.4 + 0.6 * dailyDemandScore(offer) / 100)
    * (0.5 + 0.5 * Math.max(0, Math.min(100, fit)) / 100)
  const saleEaseIndex = affordability * evidence
  const adjustedCommissionBrl = grossCommissionBrl * saleEaseIndex
  return {
    grossCommissionBrl,
    saleEaseIndex,
    adjustedCommissionBrl,
    score: Math.min(100, 100 * Math.log1p(adjustedCommissionBrl) / Math.log1p(30)),
  }
}

export function dailyPriceBand(price: number): 'affordable' | 'middle' | 'premium' {
  return price <= 100 ? 'affordable' : price <= 500 ? 'middle' : 'premium'
}

/** Reserve 20% for each price end when available, then fill by quality/value.
 * No quota rejects qualified stock or admits an unqualified product. Spread the
 * resulting bands through the day rather than putting all expensive offers last.
 */
export function dailyMixedPriceOrder<T extends { score: number; product: { discountedPrice: number }; category?: string }>(
  input: T[], target: number,
): T[] {
  const remaining = [...input].sort((a, b) => b.score - a.score)
  const picked: T[] = []
  const take = (item: T) => { picked.push(item); remaining.splice(remaining.indexOf(item), 1) }
  const quota = target >= 2 ? Math.max(1, Math.floor(target * 0.2)) : 0
  for (const band of ['affordable', 'premium'] as const) {
    for (const item of remaining.filter(i => dailyPriceBand(i.product.discountedPrice) === band).slice(0, quota)) take(item)
  }
  const categories = new Map<string, number>()
  for (const item of picked) categories.set(item.category ?? 'outros', (categories.get(item.category ?? 'outros') ?? 0) + 1)
  const preferredCategoryLimit = Math.max(1, Math.ceil(target * 0.25))
  while (picked.length < Math.min(target, input.length)) {
    const best = [...remaining].sort((a, b) => {
      const adjusted = (i: T) => i.score - Math.max(0, (categories.get(i.category ?? 'outros') ?? 0) - preferredCategoryLimit + 1) * 5
      return adjusted(b) - adjusted(a)
    })[0]
    if (!best) break
    take(best)
    categories.set(best.category ?? 'outros', (categories.get(best.category ?? 'outros') ?? 0) + 1)
  }
  const bands = ['affordable', 'middle', 'premium'] as const
  const queues = bands.map(band => picked.filter(i => dailyPriceBand(i.product.discountedPrice) === band))
  const totals = queues.map(q => q.length)
  const used = [0, 0, 0]
  const spread: T[] = []
  while (spread.length < picked.length) {
    const available = [0, 1, 2].filter(i => queues[i].length)
    available.sort((a, b) => (used[a] + 0.5) / totals[a] - (used[b] + 0.5) / totals[b] || queues[b][0].score - queues[a][0].score)
    const index = available[0]
    spread.push(queues[index].shift()!)
    used[index]++
  }
  return [...spread, ...remaining]
}
