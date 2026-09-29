import { z } from 'zod'

export const ClassificationProfileIdSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^(default|[1-9]\d*)$/, 'ID de perfil de classificação inválido')

export const ClassificationWeightsSchema = z
  .object({
    relevance: z.number().min(0).max(100),
    discount: z.number().min(0).max(100),
    commission: z.number().min(0).max(100),
  })
  .strict()
  .refine(
    ({ relevance, discount, commission }) =>
      Math.abs(relevance + discount + commission - 100) < 0.000001,
    'Os pesos de relevância, desconto e comissão devem somar 100',
  )

export const ClassificationThresholdsSchema = z
  .object({
    aScore: z.number().min(0).max(100),
    aRelevance: z.number().min(0).max(100),
    aDiscount: z.number().min(0).max(100),
    aCommission: z.number().min(0).max(100),
    bScore: z.number().min(0).max(100),
    bRelevance: z.number().min(0).max(100),
    cScore: z.number().min(0).max(100),
    dRelevance: z.number().min(0).max(100),
  })
  .strict()

export const ClassificationProfileInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
    nicheDescription: z.string().trim().min(1, 'Descrição do nicho é obrigatória').max(1000),
    relevanceInstructions: z
      .string()
      .trim()
      .min(1, 'Instruções de relevância são obrigatórias')
      .max(2000),
    weights: ClassificationWeightsSchema,
    discountCap: z.number().positive().max(100),
    commissionCap: z.number().positive().max(100),
    thresholds: ClassificationThresholdsSchema,
  })
  .strict()
  .superRefine((profile, ctx) => {
    const thresholds = profile.thresholds
    if (!(thresholds.aScore > thresholds.bScore && thresholds.bScore > thresholds.cScore)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds', 'aScore'],
        message: 'Os cortes de pontuação devem seguir A > B > C',
      })
    }
    if (!(
      thresholds.aRelevance > thresholds.bRelevance && thresholds.bRelevance > thresholds.dRelevance
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds', 'aRelevance'],
        message: 'Os cortes de relevância devem seguir A > B > D',
      })
    }
    if (thresholds.aDiscount > profile.discountCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds', 'aDiscount'],
        message: 'O desconto mínimo de A não pode superar o teto de desconto',
      })
    }
    if (thresholds.aCommission > profile.commissionCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds', 'aCommission'],
        message: 'A comissão mínima de A não pode superar o teto de comissão',
      })
    }
  })

export type ClassificationProfileInput = z.infer<typeof ClassificationProfileInputSchema>

export interface ClassificationProfile extends ClassificationProfileInput {
  id: string
  builtIn: boolean
}

export const DEFAULT_CLASSIFICATION_PROFILE: ClassificationProfile = {
  id: 'default',
  name: 'Doméstico',
  nicheDescription:
    'Produtos para casa, cozinha, limpeza, organização, conforto, móveis, eletrodomésticos e manutenção doméstica.',
  relevanceInstructions:
    'Cosméticos, moda, veículos e itens de uso pessoal não são domésticos apenas por poderem ser usados em casa.',
  weights: { relevance: 60, discount: 25, commission: 15 },
  discountCap: 50,
  commissionCap: 20,
  thresholds: {
    aScore: 75,
    aRelevance: 75,
    aDiscount: 15,
    aCommission: 10,
    bScore: 55,
    bRelevance: 50,
    cScore: 35,
    dRelevance: 25,
  },
  builtIn: true,
}
