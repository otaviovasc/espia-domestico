import type { AdAsset, AdProject, AdProjectConfig } from './api'
import type { LibraryMedia, StudioRecord } from './adStudioApi'

export type MediaLibraryKind = 'all' | LibraryMedia['kind']
export type MediaLibraryRecord = StudioRecord<LibraryMedia>
type PendingLibraryRequest = { requestKey: string; assetId?: number; baseConfigFingerprint?: string }
export type LibraryRequestStore = {
  peek: (recordId: number) => PendingLibraryRequest | null
  get: (recordId: number) => string
  recordAsset: (recordId: number, assetId: number) => void
  recordBaseConfig: (recordId: number, fingerprint: string) => void
  clear: (recordId: number) => void
}

/** Only UUIDs, asset IDs and a draft hash are retained; the backend owns the durable receipt and media. */
export function createLibraryRequestStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, projectId: number,
  uuid: () => string = () => crypto.randomUUID()): LibraryRequestStore {
  const storageKey = `ad-library-requests:v1:${projectId}`
  function read(): Record<string, PendingLibraryRequest> {
    const raw = storage.getItem(storageKey)
    if (!raw) return {}
    const value = JSON.parse(raw)
    if (value.version !== 1 || !value.requests || typeof value.requests !== 'object' || Array.isArray(value.requests))
      throw new Error('Não foi possível recuperar as solicitações de mídia desta sessão.')
    for (const request of Object.values(value.requests) as PendingLibraryRequest[]) {
      if (!request || typeof request.requestKey !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.requestKey) ||
        (request.assetId !== undefined && (!Number.isSafeInteger(request.assetId) || request.assetId <= 0)) ||
        (request.baseConfigFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(request.baseConfigFingerprint)))
        throw new Error('Não foi possível recuperar as solicitações de mídia desta sessão.')
    }
    return value.requests
  }
  function write(requests: Record<string, PendingLibraryRequest>) {
    if (Object.keys(requests).length) storage.setItem(storageKey, JSON.stringify({ version: 1, requests }))
    else storage.removeItem(storageKey)
  }
  return {
    peek: (recordId) => read()[recordId] ?? null,
    get: (recordId) => {
      const requests = read()
      if (!requests[recordId]) { requests[recordId] = { requestKey: uuid() }; write(requests) }
      return requests[recordId].requestKey
    },
    recordAsset: (recordId, assetId) => {
      const requests = read()
      if (!requests[recordId]) throw new Error('Solicitação de mídia não encontrada nesta sessão.')
      requests[recordId] = { ...requests[recordId], assetId }; write(requests)
    },
    recordBaseConfig: (recordId, fingerprint) => {
      const requests = read()
      if (!requests[recordId]) throw new Error('Solicitação de mídia não encontrada nesta sessão.')
      if (!requests[recordId].baseConfigFingerprint) {
        requests[recordId] = { ...requests[recordId], baseConfigFingerprint: fingerprint }; write(requests)
      }
    },
    clear: (recordId) => { const requests = read(); delete requests[recordId]; write(requests) },
  }
}

export async function mediaLibraryConfigFingerprint(config: AdProjectConfig): Promise<string> {
  const canonical = JSON.stringify(config, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const normalize = (value: string) => value.toLocaleLowerCase().trim()

export function filterMediaLibrary(records: MediaLibraryRecord[], query = '', kind: MediaLibraryKind = 'all') {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  return records.filter(({ payload }) => {
    if (kind !== 'all' && payload.kind !== kind) return false
    const text = normalize([payload.name, ...payload.tags, ...payload.productIds.map(String)].join(' '))
    return tokens.every((token) => text.includes(token))
  })
}

// Metadata is only a possible-copy hint. It cannot prove that two files have the same bytes.
export function hasPossibleMediaCopy(media: LibraryMedia, assets: AdAsset[]) {
  return assets.some((asset) => asset.kind === media.kind && asset.originalName === media.name &&
    asset.mimeType === media.mimeType && asset.sizeBytes === media.sizeBytes &&
    asset.width === media.width && asset.height === media.height &&
    asset.durationSeconds === media.durationSeconds)
}

function musicTracks(config: AdProjectConfig): AdProjectConfig['musicTracks'] {
  if (config.musicTracks.length || config.musicAssetId === null) return config.musicTracks
  return [{ assetId: config.musicAssetId, volume: config.musicVolume, startSeconds: 0, endSeconds: null,
    sourceStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0.8 }]
}

export function preflightMediaLibrary(config: AdProjectConfig, media: Pick<LibraryMedia, 'kind'>[]) {
  const visualCount = media.filter((item) => item.kind !== 'music').length
  const musicCount = media.length - visualCount
  if (config.kind === 'carousel' && (config.carousel?.slides.length ?? 0) + visualCount > 20)
    throw new Error('O carrossel aceita até 20 slides. Reduza a seleção antes de adicionar.')
  if (config.selectedClipIds.length + visualCount > 50)
    throw new Error('O projeto aceita até 50 mídias visuais. Reduza a seleção antes de adicionar.')
  if (musicTracks(config).length + musicCount > 8)
    throw new Error('O projeto aceita até 8 faixas de música. Reduza a seleção antes de adicionar.')
}

export function appendLibraryAssets(config: AdProjectConfig, assets: AdAsset[]): AdProjectConfig {
  preflightMediaLibrary(config, assets)
  const visual = assets.filter((asset) => asset.kind !== 'music')
  const music = assets.filter((asset) => asset.kind === 'music')
  return { ...config,
    selectedClipIds: [...config.selectedClipIds, ...visual.map((asset) => asset.id)],
    ...(config.kind === 'carousel' ? { carousel: {
      caption: config.carousel?.caption ?? '',
      slides: [...(config.carousel?.slides ?? []), ...visual.map((asset) => ({
        assetId: asset.id, text: '', durationSeconds: Math.max(3, Math.min(60, asset.durationSeconds || 5)),
      }))],
    } } : {}),
    musicTracks: [...musicTracks(config), ...music.map((asset) => ({ assetId: asset.id, volume: 0.8,
      startSeconds: 0, endSeconds: null, sourceStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0.8 }))],
  }
}

export type LibraryAttachResult = { project: AdProject; completedIds: number[]; error?: unknown; cleanupError?: unknown }

export function libraryAssetIsSelected(config: AdProjectConfig, assetId: number) {
  return config.selectedClipIds.includes(assetId) || (config.carousel?.slides.some((slide) => slide.assetId === assetId) ?? false) ||
    config.musicTracks.some((track) => track.assetId === assetId) || config.musicAssetId === assetId
}

/** Persist each ordered attachment against the last saved revision. Stop on failure so retry cannot duplicate successes. */
export async function attachMediaLibrarySelection(options: {
  project: AdProject
  config: AdProjectConfig
  records: MediaLibraryRecord[]
  attach: (recordId: number, requestKey?: string) => Promise<AdAsset>
  save: (config: AdProjectConfig, expectedRevision: number) => Promise<AdProject>
  remove: (assetId: number) => Promise<unknown>
  recoverPersisted?: (assetId: number) => Promise<AdProject | null>
  requestKeys?: LibraryRequestStore
  loadProject?: () => Promise<AdProject>
  onSaved: (recordId: number, project: AdProject, completed: number) => void | Promise<void>
}): Promise<LibraryAttachResult> {
  const records = options.records.filter((record, index, all) => all.findIndex((item) => item.id === record.id) === index)
  let project = options.project
  let config = options.config
  const completedIds: number[] = []
  // A retry/remount may still hold props from before a committed response or failed UI refresh.
  if (options.requestKeys && records.some((record) => options.requestKeys!.peek(record.id)) && options.loadProject) {
    try {
      const fresh = await options.loadProject()
      for (const record of records) {
        const pending = options.requestKeys!.peek(record.id)
        if (pending?.assetId !== undefined && !libraryAssetIsSelected(fresh.config, pending.assetId) &&
          !fresh.assets.some((asset) => asset.id === pending.assetId)) options.requestKeys!.clear(record.id)
      }
      const recoveredWrite = records.some((record) => {
        const pending = options.requestKeys!.peek(record.id)
        return pending?.assetId !== undefined && libraryAssetIsSelected(fresh.config, pending.assetId)
      })
      if (recoveredWrite) {
        const draft = JSON.stringify(config)
        const currentFingerprint = await mediaLibraryConfigFingerprint(config)
        const unchangedCapturedDraft = records.some((record) => {
          const pending = options.requestKeys!.peek(record.id)
          return pending?.assetId !== undefined && libraryAssetIsSelected(fresh.config, pending.assetId) &&
            pending.baseConfigFingerprint === currentFingerprint
        })
        const hasCapturedBaseline = records.some((record) => {
          const pending = options.requestKeys!.peek(record.id)
          return pending?.assetId !== undefined && libraryAssetIsSelected(fresh.config, pending.assetId) && Boolean(pending.baseConfigFingerprint)
        })
        if (!unchangedCapturedDraft && currentFingerprint !== await mediaLibraryConfigFingerprint(fresh.config) &&
          (hasCapturedBaseline || draft !== JSON.stringify(options.project.config)))
          return { project, completedIds, error: new Error('A mídia foi recuperada no servidor, mas há alterações locais no projeto. Confira e recarregue a versão salva antes de tentar novamente. Suas alterações locais foram mantidas.') }
        config = fresh.config
      } else if (fresh.revision !== project.revision)
        return { project, completedIds, error: new Error('O projeto mudou. Recarregue a versão salva antes de tentar novamente.') }
      project = fresh
    } catch (error) { return { project, completedIds, error } }
  }
  const needsAdding = records.filter((record) => {
    const pending = options.requestKeys?.peek(record.id)
    return pending?.assetId === undefined || !libraryAssetIsSelected(config, pending.assetId)
  })
  preflightMediaLibrary(config, needsAdding.map((record) => record.payload))
  for (const record of records) {
    const pending = options.requestKeys?.peek(record.id)
    if (pending?.assetId !== undefined && libraryAssetIsSelected(config, pending.assetId)) {
      completedIds.push(record.id)
      try { await options.onSaved(record.id, project, completedIds.length); options.requestKeys?.clear(record.id) }
      catch (error) { return { project, completedIds, error } }
      continue
    }
    let asset: AdAsset
    try {
      const requestKey = options.requestKeys?.get(record.id)
      if (options.requestKeys && !options.requestKeys.peek(record.id)?.baseConfigFingerprint)
        options.requestKeys.recordBaseConfig(record.id, await mediaLibraryConfigFingerprint(config))
      asset = await options.attach(record.id, requestKey)
      options.requestKeys?.recordAsset(record.id, asset.id)
    }
    catch (error) { return { project, completedIds, error } }
    let saved: AdProject | null = null
    try {
      // A durable attach receipt may return an asset already selected by the prior request.
      if (options.loadProject) {
        const fresh = await options.loadProject()
        if (libraryAssetIsSelected(fresh.config, asset.id)) saved = fresh
        else if (fresh.revision !== project.revision) throw new Error('O projeto mudou. Recarregue a versão salva antes de tentar novamente.')
      }
      saved ??= await options.save(appendLibraryAssets(config, [asset]), project.revision)
    }
    catch (error) {
      // A lost HTTP response may conceal a successful write. Check before deleting its source asset.
      try { saved = await options.recoverPersisted?.(asset.id) ?? null }
      catch (cleanupError) { return { project, completedIds, error, cleanupError } }
      if (!saved) {
        try { await options.remove(asset.id); options.requestKeys?.clear(record.id) }
        catch (cleanupError) { return { project, completedIds, error, cleanupError } }
        return { project, completedIds, error }
      }
    }
    project = saved
    config = saved.config
    completedIds.push(record.id)
    // Notification failures cannot roll back media already referenced by a confirmed server save.
    try { await options.onSaved(record.id, saved, completedIds.length); options.requestKeys?.clear(record.id) }
    catch (error) { return { project, completedIds, error } }
  }
  return { project, completedIds }
}
