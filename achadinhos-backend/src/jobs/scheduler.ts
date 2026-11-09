import { container } from 'tsyringe'
import { CampaignService } from '@/services/CampaignService'
import { SmartCampaignService } from '@/services/SmartCampaignService'
import { SmartCampaignSender } from '@/services/SmartCampaignSender'
import { DailyAutomationService } from '@/services/DailyAutomationService'
import { readDailyAutomationConfig } from '@/config/dailyAutomation'
import { logger } from '@/utils/logger'

const POLL_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null
let bootTimer: NodeJS.Timeout | null = null
let generation = 0
let tickingGeneration: number | null = null
let analyzingGeneration: number | null = null
let collectingGeneration: number | null = null
let dailyAutomation: DailyAutomationService | null = null

/**
 * Lightweight in-process scheduler. Every 30s it asks the CampaignService to
 * start any scheduled campaigns whose time has come. Good enough for a small
 * internal tool; for multi-instance deployments swap for a job queue.
 */
export function startScheduler(): void {
  if (timer) return
  const currentGeneration = ++generation
  const campaignService = container.resolve(CampaignService)
  const smartCampaigns = container.resolve(SmartCampaignService)
  const smartSender = container.resolve(SmartCampaignSender)
  let dailyConfig: ReturnType<typeof readDailyAutomationConfig> = null
  try { dailyConfig = readDailyAutomationConfig() }
  catch { logger.error('Invalid daily configuration; daily automation disabled while the existing sender stays active') }
  dailyAutomation = dailyConfig ? container.resolve(DailyAutomationService) : null
  const daily = dailyAutomation
  const isCurrent = (): boolean => generation === currentGeneration && timer !== null

  const tick = async (): Promise<void> => {
    if (!isCurrent() || tickingGeneration !== null) return
    tickingGeneration = currentGeneration
    try {
      try {
        await campaignService.runDueScheduled()
      } catch (error) {
        logger.warn({ error }, 'Campaign scheduler tick failed')
      }
      if (!isCurrent()) return
      try {
        await smartSender.processDue()
      } catch (error) {
        logger.warn({ error }, 'Smart campaign delivery tick failed')
      }
    } finally {
      if (tickingGeneration === currentGeneration) tickingGeneration = null
    }
    if (!isCurrent()) return
    // Browsing is independent of sends and AI analysis; never block a send tick.
    if (daily && dailyConfig && collectingGeneration === null) {
      collectingGeneration = currentGeneration
      void daily.tick(dailyConfig)
        .catch(() => logger.warn('Daily automation tick failed; verify migration and configuration'))
        .finally(() => {
          if (collectingGeneration === currentGeneration) collectingGeneration = null
        })
    }
    // Paid analysis can take minutes. Keep it independent of delivery ticks
    // and persist its lease/progress so sends never wait behind an AI batch.
    if (analyzingGeneration === null) {
      analyzingGeneration = currentGeneration
      void smartCampaigns
        .processPendingAnalysis()
        .catch((error: unknown) => logger.warn({ error }, 'Smart campaign analysis failed'))
        .finally(() => {
          if (analyzingGeneration === currentGeneration) analyzingGeneration = null
        })
    }
  }

  timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Campaign scheduler started')
  // Run once shortly after boot.
  bootTimer = setTimeout(() => {
    bootTimer = null
    if (isCurrent()) void tick()
  }, 5_000)
}

export function stopScheduler(): void {
  generation++
  dailyAutomation?.stop()
  dailyAutomation = null
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (bootTimer) {
    clearTimeout(bootTimer)
    bootTimer = null
  }
}
