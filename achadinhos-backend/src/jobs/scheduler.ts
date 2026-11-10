import { container } from 'tsyringe'
import { CampaignService } from '@/services/CampaignService'
import { SmartCampaignService } from '@/services/SmartCampaignService'
import { SmartCampaignSender } from '@/services/SmartCampaignSender'
import { DailyAutomationAlerts } from '@/services/DailyAutomationAlerts'
import { DailyAutomationService } from '@/services/DailyAutomationService'
import { readDailyAutomationConfig, dailyWindow } from '@/config/dailyAutomation'
import { logger } from '@/utils/logger'
import { env } from '@/config/env'
import { AffiliateSalesObserver, affiliateSalesErrorCode } from '@/services/AffiliateSalesObserver'
import { DailySessionRefresher } from '@/services/DailySessionRefresher'
import { MlLoginRecovery } from '@/services/MlLoginRecovery'
import { AffiliateSalesNotifications } from '@/services/AffiliateSalesNotifications'
import { MlAuthChallengeService } from '@/services/MlAuthChallengeService'

const POLL_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null
let bootTimer: NodeJS.Timeout | null = null
let generation = 0
let tickingGeneration: number | null = null
let analyzingGeneration: number | null = null
let collectingGeneration: number | null = null
let alertingGeneration: number | null = null
let dailyAutomation: DailyAutomationService | null = null
let sessionRefresher: DailySessionRefresher | null = null

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
  const alerts = dailyConfig ? container.resolve(DailyAutomationAlerts) : null
  const problem = async (code: string): Promise<void> => {
    if (!alerts || !dailyConfig) return
    const window = dailyWindow(dailyConfig)
    const date = code === 'DAILY_AUTOMATION_TICK_FAILED' ? window.targetDate : window.date
    try { await alerts.enqueue(dailyConfig, date, `scheduler:${code}`, code) }
    catch { logger.warn('Daily scheduler problem could not be persisted') }
  }
  const daily = dailyAutomation
  const sales = env.DAILY_SALES_OBSERVATION_ENABLED ? new AffiliateSalesObserver() : null
  const salesNotices = sales ? new AffiliateSalesNotifications() : null
  const login = dailyConfig ? container.resolve(MlLoginRecovery) : null
  const challenges = dailyConfig ? container.resolve(MlAuthChallengeService) : null
  sessionRefresher = dailyConfig && login ? new DailySessionRefresher(page => login.recover(page, dailyConfig!)) : null
  const sessions = sessionRefresher
  const isCurrent = (): boolean => generation === currentGeneration && timer !== null

  const tick = async (): Promise<void> => {
    if (!isCurrent()) return
    // Own guard: long sends, collection, and AI never suppress alert monitoring.
    if (alerts && dailyConfig && alertingGeneration === null) {
      alertingGeneration = currentGeneration
      void (async () => { try { await alerts.monitor(dailyConfig) } finally { await alerts.dispatch(dailyConfig) } })()
        .catch(() => logger.warn('Daily alert monitoring failed; verify database and worker health'))
        .finally(() => { if (alertingGeneration === currentGeneration) alertingGeneration = null })
    }
    if (tickingGeneration !== null) return
    tickingGeneration = currentGeneration
    try {
      try {
        await campaignService.runDueScheduled()
      } catch (error) {
        logger.warn({ error }, 'Campaign scheduler tick failed')
        void problem('CAMPAIGN_SCHEDULER_FAILED')
      }
      if (!isCurrent()) return
      try {
        await smartSender.processDue()
      } catch (error) {
        logger.warn({ error }, 'Smart campaign delivery tick failed')
        void problem('SMART_DELIVERY_TICK_FAILED')
      }
    } finally {
      if (tickingGeneration === currentGeneration) tickingGeneration = null
    }
    if (!isCurrent()) return
    // Browsing is independent of sends and AI analysis; never block a send tick.
    if (daily && dailyConfig && collectingGeneration === null) {
      collectingGeneration = currentGeneration
      void daily.tick(dailyConfig)
        .catch(() => { logger.warn('Daily automation tick failed; verify migration and configuration'); void problem('DAILY_AUTOMATION_TICK_FAILED') })
        .then(async () => {
          if (!sales || !isCurrent() || !dailyConfig) return
          try { await sales.tick(dailyConfig); await salesNotices?.tick(dailyConfig) }
          catch (error) { const code = affiliateSalesErrorCode(error); logger.warn({ code }, 'Affiliate sales observation failed'); void problem(code) }
        })
        .then(async () => {
          if (!sessions || !isCurrent()) return
          try { await challenges?.expire(); await sessions.tick() }
          catch (error) { const code = error instanceof Error && /^ML_SESSION_[A-Z_]+$/.test(error.message) ? error.message : 'ML_SESSION_REFRESH_FAILED'; logger.warn({ code }, 'Mercado Livre session refresh failed'); if (isCurrent()) void problem(code) }
        })
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
        .catch((error: unknown) => { logger.warn({ error }, 'Smart campaign analysis failed'); void problem('SMART_ANALYSIS_TICK_FAILED') })
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
  sessionRefresher?.stop()
  sessionRefresher = null
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (bootTimer) {
    clearTimeout(bootTimer)
    bootTimer = null
  }
}
