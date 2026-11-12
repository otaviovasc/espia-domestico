import type { OfferInput } from '@/dtos/campaign'
import { collectedSmartCommissionRate } from '@/utils/smartProductEligibility'
import { dailyDemandScore } from '@/utils/dailyProductSelection'
import { dailyCategoryKey, dailyVariantKey } from '@/utils/dailyAssortment'

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
export function dailyMixedPriceOrder<T extends { score: number; product: { discountedPrice: number; title?: string }; category?: string }>(
  input: T[], target: number, maxPerType = 2,
): T[] {
  const remaining = [...input].sort((a, b) => b.score - a.score)
  const variants = new Set<string>()
  const duplicates: T[] = []
  for (const item of [...remaining]) {
    const variant = dailyVariantKey(item.product)
    if (variant && variants.has(variant)) { duplicates.push(item); remaining.splice(remaining.indexOf(item), 1) }
    else if (variant) variants.add(variant)
  }
  const picked: T[] = []
  const categories = new Map<string, number>()
  const quota = target >= 2 ? Math.max(1, Math.floor(target * 0.2)) : 0
  const key = (item: T) => dailyCategoryKey(item.category, item.product.title)
  let limit = maxPerType
  while (picked.length < Math.min(target, input.length) && remaining.length) {
    const available = remaining.filter(item => (categories.get(key(item)) ?? 0) < limit)
    if (!available.length) { limit++; continue }
    const needed = (['affordable', 'premium'] as const).find(band =>
      picked.filter(item => dailyPriceBand(item.product.discountedPrice) === band).length < quota
      && available.some(item => dailyPriceBand(item.product.discountedPrice) === band))
    const best = (needed && available.find(item => dailyPriceBand(item.product.discountedPrice) === needed)) || available[0]
    picked.push(best)
    remaining.splice(remaining.indexOf(best), 1)
    categories.set(key(best), (categories.get(key(best)) ?? 0) + 1)
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
  return [...spread, ...remaining, ...duplicates]
}
