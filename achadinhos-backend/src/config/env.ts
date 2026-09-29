import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3100'),
  API_PREFIX: z.string().default('/api/v1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // CORS / Frontend
  CORS_ORIGIN: z.string().default('http://localhost:5273'),
  FRONTEND_URL: z.string().default('http://localhost:5273'),

  // Database
  DATABASE_URL: z
    .string()
    .regex(/^postgresql:\/\/.+/, 'Must be a valid PostgreSQL connection URL (postgresql://...)'),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  // First-run bootstrap admin (optional)
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional().or(z.literal('')),

  // UAZAPI — backend only
  UAZAPI_ADMIN_TOKEN: z.string().optional(),
  UAZAPI_BASE_URL: z.string().url().default('https://free.uazapi.com'),

  // Public URL for webhook registration (optional in local dev)
  API_BASE_URL: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format())
  process.exit(1)
}

export const env = parsed.data
