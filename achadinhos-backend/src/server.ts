import 'reflect-metadata'
import '@/types/express'
import bcrypt from 'bcrypt'
import { createApp } from '@/app'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { assertDatabaseConnection } from '@/database'
import { registerAssociations, User } from '@/database/models'
import { USER_ROLE_ENUM } from '@/database/models/User'
import { startScheduler } from '@/jobs/scheduler'

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

  startScheduler()

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    logger.info(`achadinhos-backend listening on http://localhost:${env.PORT}${env.API_PREFIX}`)
  })

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down')
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.error({ error }, 'Fatal boot error')
  process.exit(1)
})
