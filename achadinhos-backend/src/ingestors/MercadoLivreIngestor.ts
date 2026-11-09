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
  description?: string | null
  productUrl?: string | null
  commissionedUrl?: string | null
  commissionedUrlStatus?: string | null
  commission?: { percent?: number | null } | null
  searchMatch?: unknown
  selection?: unknown
  reviewVideos?: unknown
  // "compacto" export: fields at the card root.
  pricing?: MlPricing | null
  commissionPercent?: string | null
  imageUrls?: Array<string | null> | null
  // "completo" export: fields nested under `visible`.
  visible?: {
    description?: string | null
    pricing?: MlPricing | null
    commissionPercent?: string | null
    text?: string | null
    images?: Array<{ src?: string | null }> | null
  } | null
}

interface MlPayload {
  schemaVersion?: number
  sourceUrl?: string
  extractedAt?: string
  search?: { commission?: unknown; keywords?: unknown; matchMode?: unknown; matchStyle?: unknown }
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

export function visibleSignals(text: string | null | undefined) {
  if (!text) return undefined
  const ratingMatch = text.match(/classifica[cç][aã]o\s*(\d(?:[.,]\d+)?)\s*de\s*5\s*estrelas/i)
    ?? text.match(/(?:^|\s)([0-4][.,]\d|5(?:[.,]0)?)\s*\|\s*\+?[\d.,]+\s*(?:milh(?:ão|ões|ao|oes)|mil|k)?\s+(?:produtos?\s+)?vendidos\b/i)
  const soldMatch = text.match(/(?:mais de\s*)?\+?([\d.,]+)\s*(milh(?:ão|ões|ao|oes)|mil|k)?\s+(?:produtos?\s+)?vendidos\b/i)
  const rating = ratingMatch ? Number(ratingMatch[1].replace(',', '.')) : undefined
  const rawCount = soldMatch?.[1]
  const scaledCount = rawCount && soldMatch?.[2]
    ? Number((/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(rawCount) ? rawCount.replace(/\./g, '') : rawCount).replace(',', '.'))
    : rawCount ? Number(rawCount.replace(/\./g, '').replace(',', '.')) : undefined
  const multiplier = !soldMatch?.[2] ? 1 : /^milh/i.test(soldMatch[2]) ? 1_000_000 : 1_000
  const soldCount = scaledCount === undefined ? undefined : scaledCount * multiplier
  const bestSeller = /\bmais vendidos?\b/i.test(text)
  const timeLimited = /oferta rel[aâ]mpago|termina em\s+\d{1,2}:\d{2}|restam\s+\d+\s*(?:minutos?|horas?)/i.test(text)
  if (rating === undefined && soldCount === undefined && !bestSeller && !timeLimited) return undefined
  return {
    ...(bestSeller ? { bestSeller: true } : {}),
    ...(timeLimited ? { timeLimited: true } : {}),
    ...(rating !== undefined && Number.isFinite(rating) && rating <= 5 ? { rating } : {}),
    ...(soldCount !== undefined && Number.isSafeInteger(soldCount)
      ? { soldCount, soldCountIsLowerBound: /mais de|\+|mil|k/i.test(soldMatch?.[0] ?? '') }
      : {}),
  }
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
      // Keep observed product prose separate from title and aggregate card text.
      // Root is the compact-export form; visible is the full-export fallback.
      const observedDescription = [card.description, card.visible?.description]
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
      const description = observedDescription?.slice(0, 2000)
      if (observedDescription && observedDescription.length > 2000) warnings.push({ index, productId, message: 'Descrição observada limitada a 2000 caracteres.' })

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

      const observedCommissionRate = card.commission?.percent
      const commissionPercent =
        card.commissionPercent ?? card.visible?.commissionPercent ??
        (typeof observedCommissionRate === 'number' ? `${observedCommissionRate}%` : undefined)

      const rawEvidence = {
        productUrl: card.productUrl ?? undefined,
        extractedAt: payload.extractedAt,
        commission: card.commission ?? undefined,
        visibleSignals: visibleSignals(card.visible?.text),
        searchMatch: card.searchMatch ?? (payload.search ? {
          commission: payload.search.commission,
          keywords: payload.search.keywords,
          matchMode: payload.search.matchMode,
          matchStyle: payload.search.matchStyle,
        } : undefined),
        selection: card.selection ?? undefined,
        reviewVideos: card.reviewVideos ?? undefined,
      }
      const evidence = ExtensionEvidenceSchema.safeParse(rawEvidence)
      if (!evidence.success) warnings.push({ index, productId, message: 'Metadados da extensão inválidos; produto importado sem esses metadados. Confira o export original.' })

      const parsed = OfferSchema.safeParse({
        title,
        description,
        discountedPrice,
        originalPrice: pricing?.originalAmount ?? undefined,
        discountPercent: pricing?.discountPercent ?? undefined,
        currency: pricing?.currency ?? 'BRL',
        affiliateUrl,
        imageUrl: image ?? undefined,
        installmentLabel: pricing?.installment?.label ?? undefined,
        commissionPercent: commissionPercent ?? undefined,
        commissionRate:
          typeof observedCommissionRate === 'number'
            ? observedCommissionRate
            : undefined,
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
