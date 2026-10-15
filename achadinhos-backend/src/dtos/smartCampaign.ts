import { z } from 'zod'
import { OfferSchema } from './campaign'

export const SmartAudienceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,31}$/)

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido')
const TimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format()
      return true
    } catch {
      return false
    }
  }, 'Fuso horário inválido')
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Data inválida')

export const SmartAudienceDestinationSchema = z.object({
  groupId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => value.endsWith('@g.us'), 'JID inválido'),
  groupName: z.string().trim().min(1).max(255),
})

export const SmartAudienceProfileSchema = z.object({
  instructions: z.string().trim().min(20).max(2000),
  keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(20),
  negativeKeywords: z.array(z.string().trim().min(2).max(80)).max(20),
})

export const SmartAudiencePolicySchema = z
  .object({
    dailyCap: z.number().int().min(1).max(50).default(50),
    startTime: z.literal('09:00').default('09:00'),
    endTime: TimeSchema.default('21:00'),
    minGapSeconds: z.number().int().min(720).max(960).default(720),
    maxGapSeconds: z.number().int().min(720).max(960).default(960),
    maxStandouts: z.number().int().min(0).max(10).default(3),
    freshnessHours: z.number().int().min(1).max(24).default(24),
    timezone: TimezoneSchema.default('America/Sao_Paulo'),
    minCommissionPercent: z.number().min(0).max(100).optional(),
    minEstimatedCommission: z.number().min(0).max(1_000_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.startTime >= value.endTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'O fim deve ser depois do início',
      })
    }
    if (value.endTime > '21:00') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'O encerramento deve ser até 21:00',
      })
    }
    if (value.minGapSeconds > value.maxGapSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxGapSeconds'],
        message: 'O intervalo máximo deve ser maior ou igual ao mínimo',
      })
    }
  })

export const UpdateSmartAudienceSchema = z
  .object({
    active: z.boolean().optional(),
    enabled: z.boolean().optional(),
    profileId: z.string().max(20).nullable().optional(),
    classificationProfileId: z.string().max(20).nullable().optional(),
    destinationGroupIds: z.array(z.string().max(120)).max(20).optional(),
    destinations: z.array(SmartAudienceDestinationSchema).max(20).optional(),
    profile: SmartAudienceProfileSchema.partial().optional(),
    policy: SmartAudiencePolicySchema.innerType().partial().optional(),
    description: z.string().trim().min(10).max(1000).optional(),
    dailyCap: z.number().int().min(1).max(50).optional(),
    startTime: z.literal('09:00').optional(),
    endTime: TimeSchema.optional(),
    minIntervalMinutes: z.number().int().min(12).max(16).optional(),
    maxIntervalMinutes: z.number().int().min(12).max(16).optional(),
    minCommissionPercent: z.number().min(0).max(100).nullable().optional(),
    minEstimatedCommission: z.number().min(0).max(1_000_000).nullable().optional(),
    maxStandoutMessages: z.number().int().min(0).max(10).optional(),
  })
  .strict()

export const SmartKeywordsRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  date: IsoDateSchema,
  days: z.number().int().min(1).max(3).default(1),
  audienceSlugs: z.array(SmartAudienceSlugSchema).min(1).max(5).optional(),
})

export const CreateSmartPlanSchema = z
  .object({
    // Required idempotency key: retries after a lost HTTP response must return
    // the original plan instead of starting another paid analysis.
    requestId: z.string().uuid(),
    date: IsoDateSchema,
    days: z.number().int().min(1).max(3).default(1),
    audienceSlugs: z.array(SmartAudienceSlugSchema).min(1).max(5),
    rawJson: z.union([z.string().min(2), z.array(z.unknown()), z.record(z.unknown())]).optional(),
    payloads: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(255),
          json: z.unknown().refine((value) => value !== undefined, 'JSON é obrigatório'),
          source: z.string().trim().max(40).optional(),
          targetAudienceSlug: SmartAudienceSlugSchema.optional(),
        }),
      )
      .min(1)
      .max(50)
      .optional(),
    settings: SmartAudiencePolicySchema.innerType().partial().optional(),
  })
  .refine((value) => (value.rawJson === undefined) !== (value.payloads === undefined), {
    message: 'Informe rawJson ou payloads, exclusivamente',
  })

export const SmartPlanItemStateSchema = z.enum(['SELECTED', 'RESERVE', 'REJECTED'])

export const SmartPlanItemSchema = z.object({
  id: z.string().min(1).max(160),
  audienceSlug: SmartAudienceSlugSchema,
  date: IsoDateSchema,
  state: SmartPlanItemStateSchema,
  product: OfferSchema,
  savedProductId: z.number().int().positive().optional(),
  score: z.number().min(0).max(100),
  fitScore: z.number().min(0).max(100).optional(),
  estimatedCommission: z.number().min(0).optional(),
  freshnessHours: z.number().min(0).optional(),
  reason: z.string().max(2000),
  category: z.string().max(120).optional(),
  warnings: z.array(z.string().max(500)).max(20).default([]),
  scheduledAt: z.string().datetime().optional(),
  standout: z.boolean().default(false),
  customMessage: z.string().trim().max(800).nullable().optional(),
  pinned: z.boolean().optional(),
  observedAt: z.string().datetime(),
  scores: z.record(z.number()).optional(),
})
export type SmartPlanItem = z.infer<typeof SmartPlanItemSchema>

export const UpdateSmartPlanSchema = z.object({
  revision: z.number().int().positive(),
  items: z
    .array(
      z
        .object({
          id: z.string().min(1).max(160),
          state: SmartPlanItemStateSchema.optional(),
          date: IsoDateSchema.optional(),
          scheduledAt: z.string().datetime().nullable().optional(),
          standout: z.boolean().optional(),
          customMessage: z.string().trim().max(800).nullable().optional(),
          pinned: z.boolean().optional(),
        })
        .strict(),
    )
    .min(1)
    .max(5000),
})

export const SmartPlanActionSchema = z.object({ revision: z.number().int().positive() }).strict()
export const SmartPlanRetrySchema = z
  .object({
    revision: z.number().int().positive(),
    requestId: z.string().uuid().optional(),
  })
  .strict()
export const ResolveSmartSendSchema = z.object({
  resolution: z.enum(['sent', 'retry', 'skip']),
})

export type UpdateSmartAudienceInput = z.infer<typeof UpdateSmartAudienceSchema>
export type CreateSmartPlanInput = z.infer<typeof CreateSmartPlanSchema>
export type UpdateSmartPlanInput = z.infer<typeof UpdateSmartPlanSchema>
