import { injectable } from 'tsyringe'
import { OfferSchema, OfferInput, normalizeRawOffer } from '@/dtos/campaign'
import { BadRequestError } from '@/middleware/Error/AppError'
import { getIngestor, detectIngestor } from '@/ingestors/registry'
import type { IngestWarning } from '@/ingestors/SourceIngestor'

export interface ImportResult {
  offers: OfferInput[]
  offerIndexes: number[]
  errors: ({ index: number; message: string } & Partial<ImportProvenance>)[]
  /** Which ingestor handled it, or 'generic' for the plain-array path. */
  source: string
  totalSeen: number
  provenance?: ImportProvenance[]
  files?: ImportFileSummary[]
  duplicates?: ImportDuplicate[]
  duplicateCount?: number
}

export const MAX_IMPORT_ITEMS = 5000
export const MAX_IMPORT_FILES = 50
export const MAX_IMPORT_PAYLOAD_BYTES = 32 * 1024 * 1024

export interface ImportPayload {
  name: string
  json: unknown
  source?: string
}

export interface ImportProvenance {
  index: number
  fileIndex: number
  itemIndex: number
  fileName: string
}

export interface ImportDuplicate extends ImportProvenance {
  duplicateOf: number
}

export interface ImportFileSummary {
  fileIndex: number
  name: string
  source: string
  totalSeen: number
  imported: number
  invalid: number
  duplicates: number
  warnings: number
}

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

  private rawArray(value: unknown): unknown[] {
    return value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as Record<string, unknown>).cards)
      ? (value as { cards: unknown[] }).cards
      : this.extractArray(value)
  }

  /** Preflight every file before normalizing or evaluating any of its products. */
  parsePayloads(payloads: ImportPayload[]): ImportResult {
    if (!Array.isArray(payloads) || payloads.length < 1 || payloads.length > MAX_IMPORT_FILES) {
      throw BadRequestError(`Selecione de 1 a ${MAX_IMPORT_FILES} arquivos JSON por importação.`)
    }
    let bytes = 0
    let totalSeen = 0
    const prepared = payloads.map((payload, fileIndex) => {
      const fileName = payload.name.trim()
      if (!fileName || fileName.length > 255) throw BadRequestError('Nome de arquivo JSON inválido')
      const encoded = typeof payload.json === 'string' ? payload.json : JSON.stringify(payload.json)
      bytes += Buffer.byteLength(encoded ?? '', 'utf8')
      if (bytes > MAX_IMPORT_PAYLOAD_BYTES)
        throw BadRequestError('Os arquivos JSON excedem o limite combinado de 32 MB.')
      try {
        const value = this.parseJson(payload.json)
        if (payload.source && !getIngestor(payload.source))
          throw BadRequestError('Fonte de importação inválida')
        if (payload.source && !getIngestor(payload.source)!.detect(value))
          throw BadRequestError('Formato incompatível com a fonte de importação selecionada')
        const ingestor = payload.source ? getIngestor(payload.source) : detectIngestor(value)
        const array = ingestor ? this.rawArray(value) : this.extractArray(value)
        totalSeen += array.length
        if (totalSeen > MAX_IMPORT_ITEMS)
          throw BadRequestError(
            `Importe no máximo ${MAX_IMPORT_ITEMS} produtos no conjunto de arquivos.`,
          )
        return {
          value,
          fileIndex,
          fileName,
          source: payload.source,
          offset: totalSeen - array.length,
        }
      } catch (error) {
        throw BadRequestError(
          `Arquivo "${fileName}": ${error instanceof Error ? error.message : 'JSON inválido'}`,
        )
      }
    })
    const offers: OfferInput[] = []
    const provenance: ImportProvenance[] = []
    const errors: ImportResult['errors'] = []
    const duplicates: ImportDuplicate[] = []
    const files: ImportFileSummary[] = []
    const firstByIdentity = new Map<string, number>()
    const candidates: { offer: OfferInput; origin: ImportProvenance }[] = []
    const parents: number[] = []
    const root = (position: number): number => {
      let current = position
      while (parents[current] !== current) current = parents[current]
      while (parents[position] !== position) {
        const next = parents[position]
        parents[position] = current
        position = next
      }
      return current
    }
    for (const file of prepared) {
      const parsed = this.parse(file.value, file.source, true)
      const validIndexes = new Set(parsed.offerIndexes)
      const summary: ImportFileSummary = {
        fileIndex: file.fileIndex,
        name: file.fileName,
        source: parsed.source,
        totalSeen: parsed.totalSeen,
        imported: 0,
        invalid: parsed.totalSeen - parsed.offers.length,
        duplicates: 0,
        warnings: parsed.errors.filter((error) => validIndexes.has(error.index)).length,
      }
      const origin = (itemIndex: number): ImportProvenance => ({
        index: file.offset + itemIndex,
        fileIndex: file.fileIndex,
        itemIndex,
        fileName: file.fileName,
      })
      errors.push(...parsed.errors.map((error) => ({ ...error, ...origin(error.index) })))
      parsed.offers.forEach((offer, position) => {
        const source = offer.source?.trim().toLowerCase()
        const productId = offer.productId?.trim()
        const identities = [`url:${offer.affiliateUrl.trim()}`]
        if (productId) identities.push(`product:${JSON.stringify([source ?? '', productId])}`)
        const itemOrigin = origin(parsed.offerIndexes[position])
        const candidateIndex = candidates.length
        candidates.push({ offer, origin: itemOrigin })
        parents.push(candidateIndex)
        for (const identity of identities) {
          const first = firstByIdentity.get(identity)
          if (first === undefined) firstByIdentity.set(identity, candidateIndex)
          else {
            const left = root(first)
            const right = root(candidateIndex)
            parents[Math.max(left, right)] = Math.min(left, right)
          }
        }
      })
      files.push(summary)
    }
    // Later cards can bridge earlier identities. Finish the components before
    // choosing winners so only the earliest raw record gets evaluated.
    candidates.forEach(({ offer, origin }, position) => {
      const canonical = root(position)
      const summary = files[origin.fileIndex]
      if (canonical === position) {
        offers.push(offer)
        provenance.push(origin)
        summary.imported++
      } else {
        duplicates.push({ ...origin, duplicateOf: candidates[canonical].origin.index })
        summary.duplicates++
      }
    })
    const sources = new Set(files.map((file) => file.source))
    return {
      offers,
      offerIndexes: provenance.map((item) => item.index),
      provenance,
      errors,
      source: sources.size === 1 ? files[0].source : 'mixed',
      totalSeen,
      files,
      duplicates,
      duplicateCount: duplicates.length,
    }
  }

  /** Ingest via a marketplace ingestor (explicit id or auto-detected). */
  private ingestWithSource(value: unknown, source?: string): ImportResult | null {
    const ingestor = source ? getIngestor(source) : detectIngestor(value)
    if (!ingestor) return null
    const result = ingestor.ingest(value)
    return {
      offers: result.offers,
      offerIndexes: result.offerIndexes,
      errors: result.warnings.map((w: IngestWarning) => ({ index: w.index, message: w.message })),
      source: ingestor.id,
      totalSeen: result.totalSeen,
    }
  }

  /** Generic flat-array parsing with field-alias normalization. */
  private ingestGeneric(value: unknown): ImportResult {
    const array = this.extractArray(value)
    const offers: OfferInput[] = []
    const offerIndexes: number[] = []
    const errors: { index: number; message: string }[] = []

    array.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        errors.push({ index, message: 'Item não é um objeto' })
        return
      }
      const normalized = normalizeRawOffer(entry as Record<string, unknown>)
      const parsed = OfferSchema.safeParse(normalized)
      if (parsed.success) {
        offers.push(parsed.data)
        offerIndexes.push(index)
      } else {
        errors.push({
          index,
          message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        })
      }
    })

    return { offers, offerIndexes, errors, source: 'generic', totalSeen: array.length }
  }

  /**
   * @param rawJson  JSON string or already-parsed value.
   * @param source   Optional explicit ingestor id (e.g. 'mercadolivre'). When
   *                 omitted, an ingestor is auto-detected, then generic.
   */
  parse(rawJson: unknown, source?: string, allowEmpty = false): ImportResult {
    const value = this.parseJson(rawJson)

    // Reject oversized inputs before normalizing any items or evaluating Jev.
    const rawArray = this.rawArray(value)
    if (rawArray.length > MAX_IMPORT_ITEMS) {
      throw BadRequestError(`Importe no máximo ${MAX_IMPORT_ITEMS} produtos por vez.`)
    }
    if (source && !getIngestor(source)) throw BadRequestError('Fonte de importação inválida')

    const viaSource = this.ingestWithSource(value, source)
    const result = viaSource ?? this.ingestGeneric(value)

    if (result.totalSeen > MAX_IMPORT_ITEMS) {
      throw BadRequestError(`Importe no máximo ${MAX_IMPORT_ITEMS} produtos por vez.`)
    }

    if (result.offers.length === 0 && !allowEmpty) {
      const detail = result.errors.length
        ? ` Detalhes: ${result.errors.map((e) => `#${e.index} ${e.message}`).join(' | ')}`
        : ''
      throw BadRequestError(`Nenhum produto válido no JSON.${detail}`)
    }

    return result
  }
}
