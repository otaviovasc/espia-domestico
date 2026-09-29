import 'reflect-metadata'
import '@/types/express'
import '@/config/env'
import { logger } from '@/utils/logger'
import { assertDatabaseConnection } from '@/database'
import { registerAssociations } from '@/database/models'
import { startScheduler, stopScheduler } from '@/jobs/scheduler'

/**
 * Dedicated worker process: runs the campaign scheduler and send loop, with NO
 * HTTP server. Deploy this as its own Railway service so deploying the API or
 * frontend never kills an in-flight campaign. The worker's own restarts are
 * recovered by the campaign heartbeat + auto-resume logic.
 */
async function main(): Promise<void> {
  registerAssociations()
  await assertDatabaseConnection()

  startScheduler()
  logger.info('achadinhos worker started (campaign scheduler + sender)')

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Worker shutting down')
    stopScheduler()
    // Give in-flight DB writes a moment, then exit.
    setTimeout(() => process.exit(0), 2_000)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.error({ error }, 'Fatal worker boot error')
  process.exit(1)
})
