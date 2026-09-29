import type { OfferInput } from '@/dtos/campaign'
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
        warnings: [{ index: -1, message: 'Payload não reconhecido como Mercado Livre' }],
        totalSeen: 0,
      }
    }
    const cards = payload.cards ?? []
    const offers: OfferInput[] = []
    const warnings: IngestWarning[] = []

    cards.forEach((card, index) => {
      const productId = card.productId ?? undefined
      const title = (card.title ?? '').trim()
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

      // Image: "compacto" has imageUrls[]; "completo" has visible.images[].src.
      const image =
        card.imageUrls?.find((u) => !!u) ??
        card.visible?.images?.find((img) => img?.src)?.src ??
        undefined

      const commissionPercent =
        card.commissionPercent ?? card.visible?.commissionPercent ?? undefined

      offers.push({
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
      })
    })

    return { offers, warnings, totalSeen: cards.length }
  }
}
