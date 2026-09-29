import type { AdAsset, AdClipEdit, AdProjectConfig } from '@/lib/api'

const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const LONG_ID_TOKEN = /(?:^|\s)(?:[0-9a-f]{16,}|\d{10,})(?=\s|$)/gi
const OPAQUE_NAME = /^(?=[a-z0-9]{24,}$)(?=.*\d)[a-z0-9]+$/i

export function getAdAssetDisplayLabel(asset: AdAsset, index: number, noun = 'Clipe'): string {
  const withoutExtension = asset.originalName.replace(/\.[a-z0-9]{1,8}$/i, '')
  const readableName = withoutExtension
    .replace(UUID_TOKEN, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(LONG_ID_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const hasReadableWord = /[a-z\u00c0-\u024f]{2,}/i.test(readableName) && !OPAQUE_NAME.test(readableName)
  return hasReadableWord ? `${noun} ${index + 1} · ${readableName}` : `${noun} ${index + 1}`
}

export const DEFAULT_CLIP_EDIT: AdClipEdit = {
  trimStart: 0,
  trimEnd: null,
  speed: 1,
  framingOverride: false,
  focusX: 50,
  focusY: 50,
  zoom: 1,
}

export const DEFAULT_TRANSITION: AdProjectConfig['transition'] = {
  preset: 'cut',
  durationSeconds: 0.35,
  sfx: 'none',
  sfxVolume: 0.18,
}

export const MIN_TRIMMED_DURATION = 0.25

export function getAdClipEdit(config: AdProjectConfig, assetId: number): AdClipEdit {
  return { ...DEFAULT_CLIP_EDIT, ...config.clipEdits?.[String(assetId)] }
}

export function clipSequenceValidation(assets: AdAsset[], config: AdProjectConfig): string | null {
  const assetById = new Map(assets.map((asset, index) => [asset.id, { asset, index }]))
  for (const id of config.selectedClipIds) {
    const found = assetById.get(id)
    if (!found) return 'Um clipe selecionado não está mais disponível.'
    const { asset, index } = found
    const label = getAdAssetDisplayLabel(asset, index)
    const edit = getAdClipEdit(config, id)
    const sourceEnd = edit.trimEnd ?? asset.durationSeconds
    if (edit.trimStart > 3600 || (edit.trimEnd !== null && edit.trimEnd > 3600)) {
      return `O corte de “${label}” precisa ficar dentro da primeira hora do arquivo.`
    }
    if (sourceEnd > asset.durationSeconds + 0.001) return `O fim de “${label}” ultrapassa a duração do arquivo.`
    if (edit.trimStart >= asset.durationSeconds || sourceEnd - edit.trimStart < MIN_TRIMMED_DURATION) {
      return `Reserve pelo menos 0,25 segundo em “${label}”.`
    }
  }
  return null
}
