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

export function createApp(): Application {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())
  app.use(hpp())

  // Global, generous rate limit (login has its own tighter limiter).
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  const prefix = env.API_PREFIX
  app.use(`${prefix}/health`, healthRoutes)
  app.use(`${prefix}/auth`, authRoutes)
  app.use(`${prefix}/connection`, connectionRoutes)
  app.use(`${prefix}/groups`, groupRoutes)
  app.use(`${prefix}/campaigns`, campaignRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
