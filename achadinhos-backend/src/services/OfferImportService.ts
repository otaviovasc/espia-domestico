import { injectable } from 'tsyringe'
import { OfferSchema, OfferInput, normalizeRawOffer } from '@/dtos/campaign'
import { BadRequestError } from '@/middleware/Error/AppError'
import { getIngestor, detectIngestor } from '@/ingestors/registry'
import type { IngestWarning } from '@/ingestors/SourceIngestor'

export interface ImportResult {
  offers: OfferInput[]
  errors: { index: number; message: string }[]
  /** Which ingestor handled it, or 'generic' for the plain-array path. */
  source: string
  totalSeen: number
}

export const MAX_IMPORT_ITEMS = 100

/**
 * Parses a batch of products into normalized offers.
 *
 * Two paths:
 *  1. A marketplace ingestor (Mercado Livre now) — either named explicitly via
 *     `source`, or auto-detected from the payload shape.
 *  2. Generic fallback: a bare array (or {offers|products|items}) of flat
 *     product objects with field aliases, for manual/other exports.
 */
@injectable()
export class OfferImportService {
  private extractArray(input: unknown): unknown[] {
    if (Array.isArray(input)) return input
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>
      for (const key of ['offers', 'products', 'items', 'produtos', 'ofertas', 'data']) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[]
      }
    }
    throw BadRequestError('JSON deve ser um array de produtos ou um objeto com "products"/"offers"')
  }

  private parseJson(rawJson: unknown): unknown {
    if (typeof rawJson === 'string') {
      try {
        return JSON.parse(rawJson)
      } catch {
        throw BadRequestError('JSON inválido — não foi possível interpretar o texto')
      }
    }
    return rawJson
  }

  /** Ingest via a marketplace ingestor (explicit id or auto-detected). */
  private ingestWithSource(value: unknown, source?: string): ImportResult | null {
    const ingestor = source ? getIngestor(source) : detectIngestor(value)
    if (!ingestor) return null
    const result = ingestor.ingest(value)
    return {
      offers: result.offers,
      errors: result.warnings.map((w: IngestWarning) => ({ index: w.index, message: w.message })),
      source: ingestor.id,
      totalSeen: result.totalSeen,
    }
  }

  /** Generic flat-array parsing with field-alias normalization. */
  private ingestGeneric(value: unknown): ImportResult {
    const array = this.extractArray(value)
    const offers: OfferInput[] = []
    const errors: { index: number; message: string }[] = []

    array.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        errors.push({ index, message: 'Item não é um objeto' })
        return
      }
      const normalized = normalizeRawOffer(entry as Record<string, unknown>)
      const parsed = OfferSchema.safeParse(normalized)
      if (parsed.success) offers.push(parsed.data)
      else {
        errors.push({
          index,
          message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        })
      }
    })

    return { offers, errors, source: 'generic', totalSeen: array.length }
  }

  /**
   * @param rawJson  JSON string or already-parsed value.
   * @param source   Optional explicit ingestor id (e.g. 'mercadolivre'). When
   *                 omitted, an ingestor is auto-detected, then generic.
   */
  parse(rawJson: unknown, source?: string): ImportResult {
    const value = this.parseJson(rawJson)

    const viaSource = this.ingestWithSource(value, source)
    const result = viaSource ?? this.ingestGeneric(value)

    if (result.totalSeen > MAX_IMPORT_ITEMS) {
      throw BadRequestError(`Importe no máximo ${MAX_IMPORT_ITEMS} produtos por vez.`)
    }

    if (result.offers.length === 0) {
      const detail = result.errors.length
        ? ` Detalhes: ${result.errors.map((e) => `#${e.index} ${e.message}`).join(' | ')}`
        : ''
      throw BadRequestError(`Nenhum produto válido no JSON.${detail}`)
    }

    return result
  }
}
