import { OfferSchema, type OfferInput } from '@/dtos/campaign'
import { ExtensionEvidenceSchema } from '@/dtos/extensionEvidence'
import type { SourceIngestor, IngestResult, IngestWarning } from './SourceIngestor'

/**
 * Shape of a single card in the Mercado Livre affiliate hub export
 * (schemaVersion 1, extractorVersion dom-v1). Only the fields we consume are
 * typed; the payload carries much more (raw HTML, etc.) which we ignore.
 */
interface MlPricing {
  currency?: string | null
  currentAmount?: number | null
  originalAmount?: number | null
  discountPercent?: number | null
  installment?: { label?: string | null } | null
}

interface MlCard {
  position?: number
  productId?: string | null
  title?: string | null
  productUrl?: string | null
  commissionedUrl?: string | null
  commissionedUrlStatus?: string | null
  commission?: unknown
  searchMatch?: unknown
  selection?: unknown
  reviewVideos?: unknown
  // "compacto" export: fields at the card root.
  pricing?: MlPricing | null
  commissionPercent?: string | null
  imageUrls?: Array<string | null> | null
  // "completo" export: fields nested under `visible`.
  visible?: {
    pricing?: MlPricing | null
    commissionPercent?: string | null
    images?: Array<{ src?: string | null }> | null
  } | null
}

interface MlPayload {
  schemaVersion?: number
  sourceUrl?: string
  extractedAt?: string
  search?: { commission?: unknown }
  cards?: MlCard[]
}

function isMlPayload(payload: unknown): payload is MlPayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  const hasCards = Array.isArray(p.cards)
  const looksMl = typeof p.sourceUrl === 'string' && p.sourceUrl.includes('mercadolivre')
  return (
    hasCards && (looksMl || p.extractorVersion === 'dom-v1' || typeof p.schemaVersion === 'number')
  )
}

/**
 * Ingestor for the Mercado Livre affiliate hub export.
 *
 * Affiliate URL priority: `commissionedUrl` (the real meli.la short link that
 * earns commission) when present, otherwise `productUrl` (a warning is raised
 * because that link does NOT carry the affiliate attribution).
 */
export class MercadoLivreIngestor implements SourceIngestor {
  readonly id = 'mercadolivre'
  readonly label = 'Mercado Livre'

  detect(payload: unknown): boolean {
    return isMlPayload(payload)
  }

  ingest(payload: unknown): IngestResult {
    if (!isMlPayload(payload)) {
      return {
        offers: [],
        offerIndexes: [],
        warnings: [{ index: -1, message: 'Payload não reconhecido como Mercado Livre' }],
        totalSeen: 0,
      }
    }
    const cards = payload.cards ?? []
    const offers: OfferInput[] = []
    const offerIndexes: number[] = []
    const warnings: IngestWarning[] = []

    cards.forEach((card, index) => {
      if (!card || typeof card !== 'object') {
        warnings.push({ index, message: 'Item não é um objeto' })
        return
      }
      const productId = card.productId ?? undefined
      const title = typeof card.title === 'string' ? card.title.trim() : ''
      if (!title) {
        warnings.push({ index, productId, message: 'Sem título — item ignorado' })
        return
      }

      const pricing = card.pricing ?? card.visible?.pricing ?? undefined
      const discountedPrice = pricing?.currentAmount ?? undefined
      if (!discountedPrice || discountedPrice <= 0) {
        warnings.push({
          index,
          productId,
          message: `"${title.slice(0, 40)}" sem preço atual — ignorado`,
        })
        return
      }

      // Affiliate link priority: commissioned > product URL (with a warning).
      const commissioned = Boolean(card.commissionedUrl)
      const affiliateUrl = card.commissionedUrl || card.productUrl || undefined
      if (!affiliateUrl) {
        warnings.push({ index, productId, message: `"${title.slice(0, 40)}" sem URL — ignorado` })
        return
      }
      if (!commissioned) {
        warnings.push({
          index,
          productId,
          message: `"${title.slice(0, 40)}" usa o link do produto (sem comissão). Gere o link afiliado no ML.`,
        })
      }
      const commissionedUrlStatus = card.commissionedUrlStatus ?? undefined
      const verifiedStatuses = [
        'generated_from_page_state',
        'generated',
        'generated_from_clipboard',
        'generated_from_copy_event',
        'present_on_card',
      ]
      if (
        commissioned &&
        commissionedUrlStatus &&
        !verifiedStatuses.includes(commissionedUrlStatus)
      ) {
        warnings.push({
          index,
          productId,
          message: `"${title.slice(0, 40)}" tem link afiliado fornecido sem verificação de atribuição (${commissionedUrlStatus}). Confira o link antes de divulgar.`,
        })
      }

      // Image: "compacto" has imageUrls[]; "completo" has visible.images[].src.
      const image =
        (Array.isArray(card.imageUrls) ? card.imageUrls.find((u) => !!u) : undefined) ??
        (Array.isArray(card.visible?.images)
          ? card.visible.images.find((img) => img?.src)?.src
          : undefined) ??
        undefined

      const commissionPercent =
        card.commissionPercent ?? card.visible?.commissionPercent ?? undefined

      const rawEvidence = {
        productUrl: card.productUrl ?? undefined,
        extractedAt: payload.extractedAt,
        commission: card.commission ?? undefined,
        searchMatch: card.searchMatch ?? (payload.search?.commission ? { commission: payload.search.commission } : undefined),
        selection: card.selection ?? undefined,
        reviewVideos: card.reviewVideos ?? undefined,
      }
      const evidence = ExtensionEvidenceSchema.safeParse(rawEvidence)
      if (!evidence.success) warnings.push({ index, productId, message: 'Metadados da extensão inválidos; produto importado sem esses metadados. Confira o export original.' })

      const parsed = OfferSchema.safeParse({
        title,
        discountedPrice,
        originalPrice: pricing?.originalAmount ?? undefined,
        discountPercent: pricing?.discountPercent ?? undefined,
        currency: pricing?.currency ?? 'BRL',
        affiliateUrl,
        imageUrl: image ?? undefined,
        installmentLabel: pricing?.installment?.label ?? undefined,
        commissionPercent: commissionPercent ?? undefined,
        productId,
        source: this.id,
        commissioned,
        commissionedUrlStatus,
        extensionEvidence: evidence.success ? evidence.data : undefined,
      })
      if (!parsed.success) {
        warnings.push({
          index,
          productId,
          message: parsed.error.errors
            .map((error) => `${error.path.join('.')}: ${error.message}`)
            .join('; '),
        })
        return
      }
      offers.push(parsed.data)
      offerIndexes.push(index)
    })

    return { offers, offerIndexes, warnings, totalSeen: cards.length }
  }
}
