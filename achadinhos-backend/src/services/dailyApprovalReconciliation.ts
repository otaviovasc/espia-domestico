import type { SmartPlanItem } from '@/dtos/smartCampaign'
import { dailyMixedPriceOrder, dailyPriceBand } from '@/utils/dailyCommercialValue'

export async function reconcileDailyApproval(input: {
  items: SmartPlanItem[]
  capacity: number
  invalid: (item: SmartPlanItem) => boolean
  conflict: (item: SmartPlanItem) => boolean
  repeatsReady: boolean
  aliases: (item: SmartPlanItem) => string[]
  occupied: Set<string>
  schedule: (count: number) => Date[]
  fresh: (item: SmartPlanItem, slot: Date) => boolean
  maxStandouts: number
}): Promise<SmartPlanItem[]> {
  const { items, occupied } = input
  const original = items.filter(item => item.state === 'SELECTED')
  let wanted = Math.min(original.length, input.capacity)
  const rejected = new Set<string>()
  const removed: SmartPlanItem[] = []
  const drop = (item: SmartPlanItem, code: string) => {
    item.state = 'RESERVE'
    item.scheduledAt = undefined
    item.warnings = [...new Set([...(item.warnings ?? []), code])]
    if (!['DAILY_ITEM_CAPACITY', 'DAILY_ITEM_DUPLICATE'].includes(code)) { rejected.add(item.id); removed.push(item) }
  }
  const repeatOrder = (a: SmartPlanItem, b: SmartPlanItem) => Number(Boolean(a.repeatFallback)) - Number(Boolean(b.repeatFallback))
  const ranked = (a: SmartPlanItem, b: SmartPlanItem) => repeatOrder(a, b) || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.score - a.score || a.id.localeCompare(b.id)
  let mixedOrder = new Map<string, number>()
  const ordered = (a: SmartPlanItem, b: SmartPlanItem) => repeatOrder(a, b) || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || (a.sendOrder ?? Number.MAX_SAFE_INTEGER) - (b.sendOrder ?? Number.MAX_SAFE_INTEGER) || (mixedOrder.get(a.id) ?? 0) - (mixedOrder.get(b.id) ?? 0) || b.score - a.score || a.id.localeCompare(b.id)
  let selected: SmartPlanItem[] = []
  const local = new Set<string>()
  for (const item of [...original].sort(ranked)) {
    if (item.repeatFallback) { drop(item, input.repeatsReady ? 'DAILY_ITEM_CAPACITY' : 'DAILY_ITEM_REPEAT_NOT_READY'); continue }
    if (input.invalid(item)) { drop(item, 'DAILY_ITEM_ELIGIBILITY'); continue }
    if (input.aliases(item).some(alias => occupied.has(alias)) || input.conflict(item)) {
      drop(item, 'DAILY_ITEM_NOVELTY'); continue
    }
    if (input.aliases(item).some(alias => local.has(alias))) { drop(item, 'DAILY_ITEM_DUPLICATE'); continue }
    if (selected.length >= wanted) { drop(item, 'DAILY_ITEM_CAPACITY'); continue }
    selected.push(item)
    input.aliases(item).forEach(alias => local.add(alias))
  }
  for (let iteration = 0; iteration <= items.length * 2 + 1; iteration++) {
    while (selected.length < wanted) {
      const band = removed.shift()
      const mixed = dailyMixedPriceOrder(items.filter(item => item.state === 'RESERVE' && !rejected.has(item.id)), wanted - selected.length)
      const reserves = [...mixed].sort((a, b) => repeatOrder(a, b) || Number(Boolean(band && dailyPriceBand(b.product.discountedPrice) === dailyPriceBand(band.product.discountedPrice)))
        - Number(Boolean(band && dailyPriceBand(a.product.discountedPrice) === dailyPriceBand(band.product.discountedPrice))))
      let promoted = false
      for (const item of reserves) {
        if (item.repeatFallback && !input.repeatsReady) { drop(item, 'DAILY_ITEM_REPEAT_NOT_READY'); continue }
        if (input.invalid(item)) { drop(item, 'DAILY_ITEM_ELIGIBILITY'); continue }
        const aliases = new Set(selected.flatMap(input.aliases))
        if (input.aliases(item).some(alias => occupied.has(alias)) || input.conflict(item)) {
          drop(item, 'DAILY_ITEM_NOVELTY'); continue
        }
        if (input.aliases(item).some(alias => aliases.has(alias))) { drop(item, 'DAILY_ITEM_DUPLICATE'); continue }
        item.state = 'SELECTED'
        item.warnings = [...new Set([...(item.warnings ?? []), 'Reserva qualificada promovida para substituir item removido.'])]
        selected.push(item)
        promoted = true
        break
      }
      if (!promoted) break
    }
    mixedOrder = new Map(dailyMixedPriceOrder(selected, selected.length).map((item, index) => [item.id, index]))
    selected.sort(ordered)
    const slots = input.schedule(selected.length)
    if (slots.length < selected.length) {
      selected.slice(slots.length).forEach(item => drop(item, 'DAILY_ITEM_CAPACITY'))
      selected = selected.slice(0, slots.length)
      wanted = selected.length
      continue
    }
    let standouts = 0
    const failed = selected.filter((item, index) => {
      if (!input.fresh(item, slots[index])) { drop(item, 'DAILY_ITEM_FRESHNESS'); return true }
      if (item.standout && ++standouts > input.maxStandouts) { drop(item, 'DAILY_ITEM_STANDOUT_LIMIT'); return true }
      return false
    })
    if (!failed.length) {
      selected.forEach((item, index) => {
        item.sendOrder = index
        item.scheduledAt = slots[index].toISOString()
        input.aliases(item).forEach(alias => occupied.add(alias))
      })
      return selected
    }
    selected = selected.filter(item => item.state === 'SELECTED')
    for (const item of selected.filter(item => item.repeatFallback)) drop(item, 'DAILY_ITEM_CAPACITY')
    selected = selected.filter(item => item.state === 'SELECTED')
  }
  throw new Error('DAILY_RECONCILIATION_LIMIT')
}
