import type { SourceIngestor } from './SourceIngestor'
import { MercadoLivreIngestor } from './MercadoLivreIngestor'

/**
 * Registry of marketplace ingestors. Add new ones here (Amazon, Shopee…) and
 * they become available for both explicit selection and auto-detection.
 */
const INGESTORS: SourceIngestor[] = [new MercadoLivreIngestor()]

export interface IngestorInfo {
  id: string
  label: string
}

export function listIngestors(): IngestorInfo[] {
  return INGESTORS.map((i) => ({ id: i.id, label: i.label }))
}

export function getIngestor(id: string): SourceIngestor | undefined {
  return INGESTORS.find((i) => i.id === id)
}

/** Find the first ingestor that recognizes the payload, or undefined. */
export function detectIngestor(payload: unknown): SourceIngestor | undefined {
  return INGESTORS.find((i) => i.detect(payload))
}
