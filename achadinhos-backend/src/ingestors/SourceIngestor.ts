import type { OfferInput } from '@/dtos/campaign'

/** A warning raised while ingesting a source payload (non-fatal). */
export interface IngestWarning {
  index: number
  productId?: string
  message: string
}

export interface IngestResult {
  offers: OfferInput[]
  /** Original raw indexes corresponding to each valid offer. */
  offerIndexes: number[]
  warnings: IngestWarning[]
  /** Total raw items seen in the payload (before filtering). */
  totalSeen: number
}

/**
 * A SourceIngestor turns a marketplace-specific affiliate export into the
 * normalized OfferInput[] the rest of the app understands. One implementation
 * per marketplace (Mercado Livre now; Amazon, Shopee, etc. later).
 */
export interface SourceIngestor {
  /** Stable identifier, e.g. 'mercadolivre'. Stored on each offer as `source`. */
  readonly id: string
  /** Human label for the UI, e.g. 'Mercado Livre'. */
  readonly label: string

  /**
   * Return true if this ingestor recognizes the given parsed payload. Used by
   * the registry to auto-detect the source when the caller does not name it.
   */
  detect(payload: unknown): boolean

  /** Parse a recognized payload into normalized offers + warnings. */
  ingest(payload: unknown): IngestResult
}
