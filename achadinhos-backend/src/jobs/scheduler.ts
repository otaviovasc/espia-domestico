import { container } from 'tsyringe'
import { CampaignService } from '@/services/CampaignService'
import { logger } from '@/utils/logger'

const POLL_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null

/**
 * Lightweight in-process scheduler. Every 30s it asks the CampaignService to
 * start any scheduled campaigns whose time has come. Good enough for a small
 * internal tool; for multi-instance deployments swap for a job queue.
 */
export function startScheduler(): void {
  if (timer) return
  const campaignService = container.resolve(CampaignService)

  const tick = async (): Promise<void> => {
    try {
      await campaignService.runDueScheduled()
    } catch (error) {
      logger.warn({ error }, 'Scheduler tick failed')
    }
  }

  timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Campaign scheduler started')
  // Run once shortly after boot.
  setTimeout(() => void tick(), 5_000)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
