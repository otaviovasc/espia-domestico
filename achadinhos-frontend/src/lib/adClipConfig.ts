import type { AdAsset, AdClipEdit, AdProjectConfig } from '@/lib/api'

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
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  for (const id of config.selectedClipIds) {
    const asset = assetById.get(id)
    if (!asset) return 'Um clipe selecionado não está mais disponível.'
    const edit = getAdClipEdit(config, id)
    const sourceEnd = edit.trimEnd ?? asset.durationSeconds
    if (edit.trimStart > 3600 || (edit.trimEnd !== null && edit.trimEnd > 3600)) {
      return `O corte de “${asset.originalName}” precisa ficar dentro da primeira hora do arquivo.`
    }
    if (sourceEnd > asset.durationSeconds + 0.001) return `O fim de “${asset.originalName}” ultrapassa a duração do arquivo.`
    if (edit.trimStart >= asset.durationSeconds || sourceEnd - edit.trimStart < MIN_TRIMMED_DURATION) {
      return `Reserve pelo menos 0,25 segundo em “${asset.originalName}”.`
    }
  }
  return null
}
