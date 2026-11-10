import type { DailyAutomationConfig } from '@/config/dailyAutomation'
import { dailyRequiredItems } from '@/config/dailyAutomation'
import { smartZonedInstant } from '@/services/SmartCampaignService'

export function dailyPlanCoverage(items: Array<Record<string, unknown>>, config: DailyAutomationConfig, date: string) {
  const required = dailyRequiredItems(config)
  const audiences = ['domestica', 'masculino'].map(slug => {
    const selected = items.filter(i => i.state === 'SELECTED' && i.audienceSlug === slug)
    const slots = selected.map(i => new Date(typeof i.scheduledAt === 'string' ? i.scheduledAt : '').getTime()).sort((a, b) => a - b)
    const start = smartZonedInstant(date, config.startTime, config.timezone).getTime()
    const end = smartZonedInstant(date, config.endTime, config.timezone).getTime() - 120_000
    const completeSchedule = config.planningDaysAhead !== 1 || !config.requireFullWindow || (
      slots.every(Number.isFinite) && slots[0] >= start && slots[0] <= start + 60_000
      && slots[slots.length - 1] >= end - 60_000 && slots[slots.length - 1] <= end
      && slots.slice(1).every((slot, index) => slot - slots[index] >= config.minIntervalMinutes * 60_000 && slot - slots[index] <= config.maxIntervalMinutes * 60_000)
    )
    return { slug, selected: selected.length, required, missing: Math.max(0, required - selected.length), completeSchedule }
  })
  return { ready: audiences.every(a => a.missing === 0 && a.completeSchedule), audiences }
}
