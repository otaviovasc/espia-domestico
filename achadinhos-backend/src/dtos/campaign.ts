import { z } from 'zod'

/**
 * A single product offer. Designed to be flexible so a real affiliate JSON
 * export slots in. `discountedPrice` is the price we advertise; `originalPrice`
 * (optional) drives the "X% OFF" line.
 *
 * Prices are plain numbers in the currency's major unit (e.g. 199.9 = R$199,90).
 */
export const OfferSchema = z.object({
  savedProductId: z.number().int().positive().optional(),
  title: z.string().min(1, 'Título é obrigatório').max(200),
  originalPrice: z.number().positive().optional(),
  discountedPrice: z.number().positive('Preço com desconto é obrigatório'),
  currency: z.string().min(1).max(8).default('BRL'),
  description: z.string().max(2000).optional(),
  affiliateUrl: z.string().url('Link de afiliado inválido').max(2048),
  imageUrl: z.string().url('URL de imagem inválida').max(2048).optional(),
  coupon: z.string().max(60).optional(),
  // Rich fields from marketplace ingestors (optional).
  installmentLabel: z.string().max(120).optional(),
  commissionPercent: z.string().max(20).optional(),
  productId: z.string().max(60).optional(),
  source: z.string().max(40).optional(),
  commissioned: z.boolean().optional(),
  /** Export evidence for the affiliate URL; a supplied URL alone is not verification. */
  commissionedUrlStatus: z.string().max(80).optional(),
  category: z.enum(['A', 'B', 'C', 'D']).optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  /** Snapshot of the niche configuration used for this A-D rating. */
  classificationProfileId: z.string().max(20).optional(),
  classificationProfileName: z.string().max(120).optional(),
})
export type OfferInput = z.infer<typeof OfferSchema>

/**
 * JSON import accepts either a bare array of offers or an object with an
 * `offers`/`products` array. Field aliases (snake_case, common affiliate names)
 * are normalized before validation by normalizeRawOffer().
 */
export const OfferImportArraySchema = z.array(OfferSchema).min(1, 'Importe ao menos um produto')

/** Safety controls for pacing a broadcast. */
export const SafetySchema = z.object({
  minDelaySeconds: z.number().int().min(1).max(3600).default(8),
  maxDelaySeconds: z.number().int().min(1).max(3600).default(25),
  shuffleGroups: z.boolean().default(true),
  shuffleOffers: z.boolean().default(true),
  maxPerHour: z.number().int().min(0).max(10000).default(120),
  warmupBatchSize: z.number().int().min(0).max(1000).default(0),
  warmupPauseFactor: z.number().min(1).max(20).default(3),
})
export type SafetyInput = z.infer<typeof SafetySchema>

export const GroupRefSchema = z.object({
  id: z.string().endsWith('@g.us', 'ID de grupo inválido'),
  name: z.string().min(1),
})

/** Create a campaign (offers + groups + safety + optional schedule). */
export const CreateCampaignSchema = z
  .object({
    name: z.string().min(1, 'Nome da campanha é obrigatório').max(200),
    offers: z.array(OfferSchema).min(1, 'Adicione ao menos um produto'),
    groups: z.array(GroupRefSchema).min(1, 'Selecione ao menos um grupo'),
    safety: SafetySchema,
    /** Optional custom message template with {placeholders}. */
    messageTemplate: z.string().max(4000).optional(),
    /** Send product image as media; false = text-only with link preview. */
    sendImages: z.boolean().default(true),
    /**
     * Explicit opt-in to resend pairs already SENT on this connection.
     * Selection wins for SENT pairs; SENDING pairs stay blocked.
     */
    allowResend: z.boolean().default(false),
    /** ISO datetime; when present the campaign is scheduled instead of run now. */
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((data) => data.safety.maxDelaySeconds >= data.safety.minDelaySeconds, {
    message: 'maxDelaySeconds deve ser >= minDelaySeconds',
    path: ['safety', 'maxDelaySeconds'],
  })
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>

/**
 * Update a campaign — all fields optional. Only allowed while the campaign is
 * editable (DRAFT / SCHEDULED / PAUSED / FAILED). Passing scheduledAt: null
 * clears the schedule (turns it into a draft).
 */
export const UpdateCampaignSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    offers: z.array(OfferSchema).min(1, 'Adicione ao menos um produto').optional(),
    groups: z.array(GroupRefSchema).min(1, 'Selecione ao menos um grupo').optional(),
    safety: SafetySchema.optional(),
    messageTemplate: z.string().max(4000).nullable().optional(),
    sendImages: z.boolean().optional(),
    allowResend: z.boolean().optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine((d) => !d.safety || d.safety.maxDelaySeconds >= d.safety.minDelaySeconds, {
    message: 'maxDelaySeconds deve ser >= minDelaySeconds',
    path: ['safety', 'maxDelaySeconds'],
  })
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>

/**
 * Normalize a raw imported product object into the OfferSchema shape, mapping
 * common alternative field names. Returns an unknown-typed object for the
 * schema to validate.
 */
export function normalizeRawOffer(raw: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k]
    }
    return undefined
  }
  const toNumber = (v: unknown): number | undefined => {
    if (v === undefined) return undefined
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      // Handle "R$ 1.299,90" and "1299.90"
      const cleaned = v
        .replace(/[^\d.,-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.')
      const n = Number.parseFloat(cleaned)
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }

  return {
    title: pick('title', 'name', 'nome', 'titulo', 'produto', 'product'),
    originalPrice: toNumber(
      pick('originalPrice', 'original_price', 'precoOriginal', 'preco_original', 'de', 'fullPrice'),
    ),
    discountedPrice: toNumber(
      pick(
        'discountedPrice',
        'discounted_price',
        'precoComDesconto',
        'preco_com_desconto',
        'price',
        'preco',
        'por',
        'salePrice',
      ),
    ),
    currency: pick('currency', 'moeda') ?? 'BRL',
    description: pick('description', 'descricao', 'desc', 'detalhes'),
    affiliateUrl: pick(
      'affiliateUrl',
      'affiliate_url',
      'link',
      'url',
      'linkAfiliado',
      'link_afiliado',
    ),
    imageUrl: pick('imageUrl', 'image_url', 'image', 'imagem', 'img', 'foto', 'thumbnail'),
    coupon: pick('coupon', 'cupom', 'couponCode', 'codigo'),
    commissionPercent:
      String(pick('commissionPercent', 'commission_percent', 'comissao') ?? '') || undefined,
    discountPercent: toNumber(pick('discountPercent', 'discount_percent', 'descontoPercentual')),
    commissioned: pick('commissioned', 'comissionado'),
    commissionedUrlStatus: pick('commissionedUrlStatus', 'commissioned_url_status'),
    productId: pick('productId', 'product_id', 'idProduto'),
    source: pick('source', 'origem'),
    installmentLabel: pick('installmentLabel', 'parcelamento'),
  }
}
