import 'reflect-metadata'
import '@/types/express'
import express, { Application } from 'express'
import 'express-async-errors'
import cors from 'cors'
import helmet from 'helmet'
import hpp from 'hpp'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { env } from '@/config/env'
import { errorHandler, notFoundHandler } from '@/middleware/Error/errorHandler'
import { healthRoutes } from '@/routes/healthRoutes'
import { authRoutes } from '@/routes/authRoutes'
import { connectionRoutes } from '@/routes/connectionRoutes'
import { groupRoutes } from '@/routes/groupRoutes'
import { campaignRoutes } from '@/routes/campaignRoutes'
import { savedProductRoutes } from '@/routes/savedProductRoutes'
import { classificationProfileRoutes } from '@/routes/classificationProfileRoutes'
import { productGroupRoutes } from '@/routes/productGroupRoutes'
import { adProjectRoutes } from '@/routes/adProjectRoutes'
import { webhookRoutes } from '@/routes/webhookRoutes'
import { smartCampaignRoutes } from '@/routes/smartCampaignRoutes'
import { authenticate } from '@/middleware/auth'

export function createApp(): Application {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  // Allow one or more comma-separated origins. Each is trimmed and any trailing
  // slash removed, so "a.com, https://b.com/" still matches the browser Origin.
  const allowedOrigins =
    env.CORS_ORIGIN === '*'
      ? true
      : env.CORS_ORIGIN.split(',')
          .map((o) => o.trim().replace(/\/+$/, ''))
          .filter(Boolean)
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  )
  app.use(cookieParser())

  // Global, generous rate limit (login has its own tighter limiter).
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  // Reject unauthenticated large imports before allocating/parsing their body.
  // The global IP limit also runs before every body parser.
  const importLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => `import:${request.user!.userId}`,
  })
  app.post(
    `${env.API_PREFIX}/campaigns/import-offers`,
    authenticate,
    importLimiter,
    express.json({ limit: '32mb' }),
  )
  app.post(
    `${env.API_PREFIX}/smart-campaigns/plans`,
    authenticate,
    importLimiter,
    express.json({ limit: '32mb' }),
  )
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(hpp())

  const prefix = env.API_PREFIX
  app.use(`${prefix}/health`, healthRoutes)
  app.use(`${prefix}/auth`, authRoutes)
  app.use(`${prefix}/webhook`, webhookRoutes)
  app.use(`${prefix}/connection`, connectionRoutes)
  app.use(`${prefix}/groups`, groupRoutes)
  app.use(`${prefix}/campaigns`, campaignRoutes)
  app.use(`${prefix}/saved-products`, savedProductRoutes)
  app.use(`${prefix}/classification-profiles`, classificationProfileRoutes)
  app.use(`${prefix}/product-groups`, productGroupRoutes)
  app.use(`${prefix}/smart-campaigns`, smartCampaignRoutes)
  app.use(`${prefix}/ad-projects`, adProjectRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
