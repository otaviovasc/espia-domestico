import { z } from 'zod'

export const NicheSlugSchema = z.enum(['domestica', 'masculino', 'natal', 'pesca', 'pet'])
export type NicheSlug = z.infer<typeof NicheSlugSchema>

export const NicheIntelligenceOverrideSchema = z
  .object({
    description: z.string().trim().min(1).max(1000).optional(),
    instructions: z.string().trim().min(1).max(2000).optional(),
    keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(20).optional(),
    negativeKeywords: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
  })
  .strict()
export type NicheIntelligenceOverride = z.infer<typeof NicheIntelligenceOverrideSchema>
export type NicheIntelligenceOverrides = Partial<Record<NicheSlug, NicheIntelligenceOverride>>

export const KeywordPackSchema = z
  .object({
    slug: NicheSlugSchema,
    keywords: z.array(z.string().trim().min(2).max(80)).min(8).max(12),
    reason: z.string().trim().min(1).max(600),
  })
  .strict()
export type KeywordPack = z.infer<typeof KeywordPackSchema>

export const SmartProductFitSchema = z
  .object({
    slug: NicheSlugSchema,
    score: z.number().int().min(0).max(100),
    reason: z.string().trim().min(1).max(500),
    category: z.string().trim().min(1).max(80),
    seasonalScore: z.number().int().min(0).max(100),
  })
  .strict()
export type SmartProductFit = z.infer<typeof SmartProductFitSchema>

export const SmartProductAnalysisSchema = z
  .object({
    index: z.number().int().nonnegative(),
    fits: z.array(SmartProductFitSchema).min(1).max(5),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8),
  })
  .strict()
export type SmartProductAnalysis = z.infer<typeof SmartProductAnalysisSchema>

export const SmartAnalysisResponseSchema = SmartProductAnalysisSchema.omit({ index: true })
export const SmartKeywordResponseSchema = z
  .object({ packs: z.array(KeywordPackSchema).min(1).max(5) })
  .strict()
export const SmartStandoutCopySchema = z.object({ intro: z.string().trim().max(220) }).strict()
