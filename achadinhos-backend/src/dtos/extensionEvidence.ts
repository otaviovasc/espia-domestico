import { z } from 'zod'

const text = z.string().max(2048)
const filters = z.object({
  minPercent: z.number().min(0).max(100).nullable().optional(),
  maxPercent: z.number().min(0).max(100).nullable().optional(),
  minEstimatedBrl: z.number().min(0).max(1000000).nullable().optional(),
})
const keywords = z.array(z.string().max(200)).max(20)
const match = z.object({ keywords: keywords.optional(), matchMode: z.enum(['any', 'all']).optional(), commission: filters.nullable().optional() })

/** Evidence only. Local filenames and source URLs never trigger a server-side fetch. */
export const ExtensionEvidenceSchema = z.object({
  productUrl: z.string().url().max(4096).optional(),
  extractedAt: z.string().max(80).optional(),
  commission: z.object({
    percent: z.number().min(0).max(100).nullable(),
    priceBrl: z.number().nonnegative().nullable(),
    estimatedBrl: z.number().nonnegative().nullable(),
    basis: z.literal('visible_current_price_times_displayed_percent'),
    guaranteed: z.literal(false),
  }).optional(),
  searchMatch: match.optional(),
  selection: match.extend({
    method: z.string().max(60).optional(),
    sourceUrl: z.string().max(4096).nullable().optional(),
    addedAt: z.string().max(80).optional(),
    evidenceStatus: z.string().max(100).optional(),
    keyword: z.string().max(4200).optional(),
  }).optional(),
  reviewVideos: z.object({
    source: z.literal('mercado_livre_product_page'),
    requested: z.number().int().min(1).max(20).optional(),
    status: z.string().max(80),
    error: text.nullable().optional(),
    found: z.number().int().min(0).max(10000).optional(),
    scanScope: z.literal('loaded_product_page').optional(),
    videos: z.array(z.object({
      url: z.string().url().max(4096),
      kind: z.enum(['customer_review', 'product_video']).optional(),
      // Not-yet-started entries have no status; restored native downloads can be interrupted.
      status: z.enum(['pending', 'downloading', 'complete', 'failed', 'cancelled', 'interrupted']).default('pending'),
      format: z.string().max(20).optional(),
      // Do not retain the downloader's absolute workstation path.
      filename: z.string().max(4096).transform(value => value.split(/[\\/]/).pop() || '').optional(),
      reused: z.boolean().optional(),
      error: text.optional(),
    })).max(20),
  }).optional(),
})

export type ExtensionEvidence = z.infer<typeof ExtensionEvidenceSchema>
