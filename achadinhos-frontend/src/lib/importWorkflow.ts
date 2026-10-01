import type { ClassificationProfile, ImportProvenance, ImportResult, Offer } from './api'

export const CLASSIFICATION_BATCH_SIZE = 4
export const SAVE_BATCH_SIZE = 100

export function importOriginLabel(index: number, provenance?: ImportProvenance): string {
  return provenance ? `${provenance.fileName} · item ${provenance.itemIndex + 1}` : `Item ${index + 1}`
}

export interface ImportItem {
  sourceIndex: number
  provenance?: ImportProvenance
  offer: Offer
  status: 'pending' | 'classified' | 'failed'
  message?: string
  retryable?: boolean
}

export interface ImportSession {
  source: string
  totalSeen: number
  warnings: ImportResult['errors']
  files?: ImportResult['files']
  duplicates?: ImportResult['duplicates']
  duplicateCount?: number
  profile: ClassificationProfile
  items: ImportItem[]
}

export function createImportSession(parsed: ImportResult): ImportSession {
  if (!parsed.categorization?.profileSnapshot) throw new Error('O servidor não informou o perfil usado na classificação.')
  if (parsed.offerIndexes?.length !== parsed.offers.length) throw new Error('O servidor não informou a posição dos produtos no arquivo.')
  return {
    source: parsed.source,
    totalSeen: parsed.totalSeen,
    warnings: parsed.errors,
    files: parsed.files,
    duplicates: parsed.duplicates,
    duplicateCount: parsed.duplicateCount,
    profile: parsed.categorization.profileSnapshot,
    items: parsed.offers.map((offer, index) => ({ sourceIndex: parsed.offerIndexes![index], provenance: parsed.provenance?.[index], offer, status: 'pending' })),
  }
}

export function importSummary(session: ImportSession) {
  return {
    classified: session.items.filter((item) => item.status === 'classified').length,
    failed: session.items.filter((item) => item.status === 'failed').length,
    pending: session.items.filter((item) => item.status === 'pending').length,
    skipped: session.totalSeen - session.items.length - (session.duplicateCount ?? 0),
  }
}

export function importResult(session: ImportSession): ImportResult {
  const successful = session.items.filter((item) => item.status === 'classified')
  const counts = { A: 0, B: 0, C: 0, D: 0 }
  for (const item of successful) if (item.offer.category) counts[item.offer.category]++
  return {
    source: session.source, totalSeen: session.totalSeen,
    offers: successful.map((item) => item.offer), offerIndexes: successful.map((item) => item.sourceIndex),
    errors: session.warnings, previews: [],
    provenance: successful.flatMap((item) => item.provenance ? [item.provenance] : []),
    files: session.files, duplicates: session.duplicates, duplicateCount: session.duplicateCount,
    categorization: { method: 'jev', counts, profile: session.profile, profileSnapshot: session.profile },
  }
}

/** Retry only known per-item failures; an interrupted request has an unknown paid outcome. */
export async function classifyImportSession(
  initial: ImportSession,
  request: (offers: Offer[], profile: ClassificationProfile) => Promise<ImportResult>,
  options: { retryFailed?: boolean; cancelled: () => boolean; onProgress: (session: ImportSession) => void; errorMessage: (cause: unknown) => string },
): Promise<ImportSession> {
  let current = { ...initial, items: initial.items.map((item) => ({ ...item })) }
  const queue = current.items.map((item, index) => ({ item, index }))
    .filter(({ item }) => options.retryFailed
      ? item.status === 'failed' && item.retryable
      : item.status === 'pending')
  for (let offset = 0; offset < queue.length; offset += CLASSIFICATION_BATCH_SIZE) {
    if (options.cancelled()) break
    const batch = queue.slice(offset, offset + CLASSIFICATION_BATCH_SIZE)
    current = { ...current, items: [...current.items] }
    try {
      const response = await request(batch.map(({ item }) => item.offer), current.profile)
      const successes = new Map((response.offerIndexes ?? []).map((index, position) => [index, response.offers[position]]))
      const failures = new Map((response.categorization?.errors ?? []).map((failure) => [failure.index, failure]))
      batch.forEach(({ index, item }, batchIndex) => {
        const offer = successes.get(batchIndex)
        const failure = failures.get(batchIndex)
        current.items[index] = offer
          ? { ...item, offer, status: 'classified', message: undefined, retryable: undefined }
          : { ...item, status: 'failed', message: failure?.message ?? 'Resposta incompleta; resultado desta avaliação desconhecido.', retryable: failure?.retryable ?? false }
      })
    } catch (cause) {
      batch.forEach(({ index, item }) => {
        current.items[index] = { ...item, status: 'failed', message: `${options.errorMessage(cause)} O resultado desta avaliação é desconhecido; não será repetida automaticamente.`, retryable: false }
      })
      current = { ...current, items: [...current.items] }
      options.onProgress(current)
      break
    }
    current = { ...current, items: [...current.items] }
    options.onProgress(current)
  }
  return current
}

/** Retain only failed saves for retry; committed chunks are reported as they finish. */
export async function saveInChunks<T>(
  entries: T[],
  save: (entries: T[]) => Promise<void>,
  onSaved: (entries: T[]) => void,
  onFailed: (entries: T[], cause: unknown) => void,
  cancelled: () => boolean,
) {
  for (let offset = 0; offset < entries.length; offset += SAVE_BATCH_SIZE) {
    if (cancelled()) break
    const batch = entries.slice(offset, offset + SAVE_BATCH_SIZE)
    try { await save(batch); onSaved(batch) } catch (cause) { onFailed(batch, cause) }
  }
}
