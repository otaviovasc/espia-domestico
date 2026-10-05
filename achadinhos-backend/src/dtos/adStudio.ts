import { z } from 'zod'
import {
  AdProjectConfigSchema,
  AdCarouselSlideSchema,
  AdTextStyleSchema,
  AdVisualEffectsSchema,
  AdHookSchema,
  AdTransitionSchema,
} from './adProject'
const ids = z.array(z.number().int().positive()).max(50).default([])
const name = z.string().trim().min(1).max(120)
export const StudioKindSchema = z.enum(['brand', 'template', 'preset', 'publication'])
export const BrandSchema = z.object({
  name,
  textStyle: AdTextStyleSchema,
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  signature: z.string().max(150).default(''),
})
export const TemplateSchema = z.object({
  name,
  config: AdProjectConfigSchema,
  slideLayouts: z
    .array(AdCarouselSlideSchema.omit({ assetId: true }))
    .max(20)
    .default([]),
})
export const PresetSchema = z.object({
  id: z.string().max(100),
  name,
  visualEffects: AdVisualEffectsSchema,
  hook: AdHookSchema,
  transition: AdTransitionSchema,
  timing: AdProjectConfigSchema.innerType().shape.timing,
})
export const MetricsSchema = z
  .object({
    impressions: z.number().int().min(0).max(1e12),
    clicks: z.number().int().min(0).max(1e12),
    saves: z.number().int().min(0).max(1e12),
    likes: z.number().int().min(0).max(1e12),
    comments: z.number().int().min(0).max(1e12),
    sales: z.number().int().min(0).max(1e12).nullable().default(null),
    revenue: z.number().min(0).max(1e12).nullable().default(null),
    attribution: z.string().max(500).default(''),
    observedAt: z.string().datetime(),
    source: z.literal('manual').default('manual'),
  })
  .superRefine((v, c) => {
    if ((v.sales !== null || v.revenue !== null) && !v.attribution.trim())
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attribution'],
        message: 'Informe a fonte da atribuição de vendas',
      })
  })
export const PublicationSchema = z
  .object({
    name,
    projectId: z.number().int().positive(),
    jobId: z.number().int().positive().nullable().default(null),
    scheduledAt: z.string().datetime().nullable().default(null),
    timeZone: z.string().max(100).default('America/Sao_Paulo'),
    status: z.enum(['draft', 'scheduled', 'exported', 'published']).default('draft'),
    caption: z.string().max(2200).default(''),
    productIds: ids,
    postUrl: z.string().url().max(2048).nullable().default(null),
    publishedAt: z.string().datetime().nullable().default(null),
    metrics: MetricsSchema.nullable().default(null),
  })
  .superRefine((v, c) => {
    if (v.status === 'scheduled' && !v.scheduledAt)
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledAt'],
        message: 'Informe a data agendada',
      })
    if (v.status === 'published' && (!v.postUrl || !v.publishedAt))
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['postUrl'],
        message: 'Informe o link e a data da publicação',
      })
  })
export const StudioSaveSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  expectedRevision: z.number().int().min(0).optional(),
  payload: z.unknown(),
})
export const LibraryMetadataSchema = z.object({
  name,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  productIds: ids,
})
