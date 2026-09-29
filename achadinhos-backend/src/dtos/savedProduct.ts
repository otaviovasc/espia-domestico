import { z } from 'zod'
import { OfferSchema } from './campaign'

/** Only presentation and commercial fields can be edited; marketplace identity and AI score are immutable. */
export const SavedProductOfferPatchSchema = z
  .object({
    title: OfferSchema.shape.title,
    originalPrice: OfferSchema.shape.originalPrice.nullable(),
    discountedPrice: OfferSchema.shape.discountedPrice,
    currency: OfferSchema.shape.currency,
    description: OfferSchema.shape.description.nullable(),
    affiliateUrl: OfferSchema.shape.affiliateUrl.max(2048),
    imageUrl: OfferSchema.shape.imageUrl.nullable(),
    coupon: OfferSchema.shape.coupon.nullable(),
    installmentLabel: OfferSchema.shape.installmentLabel.nullable(),
    commissionPercent: OfferSchema.shape.commissionPercent.nullable(),
    commissioned: OfferSchema.shape.commissioned.nullable(),
    category: z.enum(['A', 'B', 'C', 'D']),
    discountPercent: OfferSchema.shape.discountPercent.nullable(),
    commissionRate: OfferSchema.shape.commissionRate.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para editar')

export type SavedProductOfferPatch = z.infer<typeof SavedProductOfferPatchSchema>

export interface SavedProductClassification {
  category: 'A' | 'B' | 'C' | 'D'
  relevanceScore?: number
  profileName: string
  discountPercent?: number
  commissionRate?: number
  classifiedAt: string
}

export type SavedProductClassifications = Record<string, SavedProductClassification>

export const SavedProductMembershipUpdateSchema = z
  .object({
    productIds: z.array(z.number().int().positive()).min(1).max(500),
    groupIds: z.array(z.number().int().positive()).max(100),
    mode: z.enum(['add', 'remove', 'set']),
  })
  .strict()
