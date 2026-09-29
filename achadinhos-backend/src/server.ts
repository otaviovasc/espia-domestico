import 'reflect-metadata'
import '@/types/express'
import bcrypt from 'bcrypt'
import { createApp } from '@/app'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { assertDatabaseConnection } from '@/database'
import { registerAssociations, User } from '@/database/models'
import { USER_ROLE_ENUM } from '@/database/models/User'
import { startScheduler, stopScheduler } from '@/jobs/scheduler'
import { ensureAdMediaDirectories } from '@/services/AdMediaService'
import { startAdRenderQueue, stopAdRenderQueue } from '@/services/AdRenderQueue'

/**
 * Optionally create the first admin from env if the users table is empty.
 * Convenient for local/dev; in production create users via the API instead.
 */
async function bootstrapAdmin(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL
  const password = env.BOOTSTRAP_ADMIN_PASSWORD
  if (!email || !password) return
  const count = await User.count()
  if (count > 0) return
  const passwordHash = await bcrypt.hash(password, 12)
  await User.create({
    name: 'Admin',
    email: email.toLowerCase(),
    passwordHash,
    role: USER_ROLE_ENUM.ADMIN,
  })
  logger.info({ email }, 'Bootstrap admin user created')
}

async function main(): Promise<void> {
  registerAssociations()
  await assertDatabaseConnection()
  await bootstrapAdmin()
  await ensureAdMediaDirectories()
  await startAdRenderQueue()

  // The dedicated worker service runs the campaign scheduler in production.
  // The API only runs it when RUN_SCHEDULER=true (default for single-process
  // local dev), so deploying the API/frontend never kills an in-flight campaign.
  if (env.RUN_SCHEDULER) {
    startScheduler()
  } else {
    logger.info('Campaign scheduler disabled in API process (handled by worker service)')
  }

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    logger.info(`achadinhos-backend listening on http://localhost:${env.PORT}${env.API_PREFIX}`)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Shutting down')
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeIdleConnections()
    stopScheduler()
    await stopAdRenderQueue()
    await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 5_000))])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.error({ error }, 'Fatal boot error')
  process.exit(1)
})
