import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z
  .object({
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
    // Run the campaign scheduler/sender inside THIS process. In production the
    // dedicated worker service sets this true; the API service leaves it false
    // so campaign sending survives API/frontend deploys. Defaults true so local
    // `npm run dev` (single process) still sends.
    RUN_SCHEDULER: z
      .enum(['true', 'false'])
      .default(['production', 'staging'].includes(process.env.NODE_ENV ?? '') ? 'false' : 'true')
      .transform((v) => v === 'true'),
    OPENROUTER_KEY: z.string().min(1).optional().or(z.literal('')),
    AI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    CLASSIFICATION_MODEL: z.string().trim().min(3).default('deepseek/deepseek-v4.1-flash'),
    SMART_CLASSIFICATION_MODEL: z.string().trim().min(3).default('deepseek/deepseek-v4.1-flash'),
    SMART_KEYWORD_MODEL: z.string().trim().min(3).default('deepseek/deepseek-v4.1-flash'),
    SMART_COPY_MODEL: z.string().trim().min(3).default('deepseek/deepseek-v4.1-flash'),
    AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100000).default(1000),
    AI_DAILY_INPUT_TOKEN_LIMIT: z.coerce.number().int().min(1000).max(100000000).default(2000000),
    AI_DAILY_OUTPUT_TOKEN_LIMIT: z.coerce.number().int().min(1000).max(10000000).default(250000),
    AI_DAILY_COST_LIMIT_USD: z.coerce.number().positive().max(1000).default(2),
    AI_GLOBAL_DAILY_COST_LIMIT_USD: z.coerce.number().positive().max(10000).default(5),
    AI_REQUEST_COST_LIMIT_USD: z.coerce.number().positive().max(10).default(0.02),
    AI_INPUT_COST_USD_PER_MILLION: z.coerce.number().positive().max(100).default(0.2),
    AI_OUTPUT_COST_USD_PER_MILLION: z.coerce.number().positive().max(100).default(0.8),
    AI_CACHE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
    AI_MAX_INPUT_TOKENS: z.coerce.number().int().min(1000).max(50000).default(12000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(8000).default(4000),

    // Ad library media. Local storage is intended for development; Railway
    // deployments should use a private S3-compatible Storage Bucket.
    AD_MEDIA_DIR: z.string().default('./data/ad-media'),
    AD_MAX_CLIP_MB: z.coerce.number().int().min(1).max(500).default(100),
    AD_MAX_MUSIC_MB: z.coerce.number().int().min(1).max(200).default(50),
    AD_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    AD_FONT_FILE: z.string().optional().or(z.literal('')),
    AD_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    AD_S3_BUCKET: z.string().min(1).optional(),
    AD_S3_ENDPOINT: z.string().url().optional(),
    AD_S3_REGION: z.string().min(1).optional(),
    AD_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    AD_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    AD_S3_FORCE_PATH_STYLE: z
      .string()
      .default('false')
      .transform((value) => value.toLowerCase() === 'true'),

    // Railway Bucket variables and AWS SDK preset aliases. AD_S3_* takes
    // precedence when both forms are present.
    BUCKET: z.string().min(1).optional(),
    ENDPOINT: z.string().url().optional(),
    REGION: z.string().min(1).optional(),
    ACCESS_KEY_ID: z.string().min(1).optional(),
    SECRET_ACCESS_KEY: z.string().min(1).optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.AI_ENABLED) {
      for (const key of [
        'OPENROUTER_KEY',
        'AI_INPUT_COST_USD_PER_MILLION',
        'AI_OUTPUT_COST_USD_PER_MILLION',
      ] as const) {
        if (!process.env[key]?.trim())
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must be explicitly configured when AI_ENABLED=true`,
          })
      }
    }
    if (value.AD_STORAGE_DRIVER !== 's3') return
    const required = [
      ['AD_S3_BUCKET or BUCKET', value.AD_S3_BUCKET ?? value.BUCKET],
      ['AD_S3_ENDPOINT or ENDPOINT', value.AD_S3_ENDPOINT ?? value.ENDPOINT],
      ['AD_S3_REGION or REGION', value.AD_S3_REGION ?? value.REGION],
      [
        'AD_S3_ACCESS_KEY_ID, ACCESS_KEY_ID or AWS_ACCESS_KEY_ID',
        value.AD_S3_ACCESS_KEY_ID ?? value.ACCESS_KEY_ID ?? value.AWS_ACCESS_KEY_ID,
      ],
      [
        'AD_S3_SECRET_ACCESS_KEY, SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY',
        value.AD_S3_SECRET_ACCESS_KEY ?? value.SECRET_ACCESS_KEY ?? value.AWS_SECRET_ACCESS_KEY,
      ],
    ] as const
    for (const [name, configured] of required) {
      if (!configured) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AD_STORAGE_DRIVER'],
          message: `${name} is required when AD_STORAGE_DRIVER=s3`,
        })
      }
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format())
  process.exit(1)
}

export const env = parsed.data
