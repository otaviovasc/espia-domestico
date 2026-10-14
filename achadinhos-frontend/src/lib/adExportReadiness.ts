import type { AdAsset, AdClipEdit, AdMusicTrack, AdOverlay, AdProjectConfig, AdRenderJob } from './api.ts'
import { carouselValidation } from './adCarouselConfig.ts'
import { clipSequenceValidation, DEFAULT_CLIP_EDIT, DEFAULT_TRANSITION } from './adClipConfig.ts'
import { DEFAULT_HOOK, DEFAULT_VISUAL_EFFECTS, VISUAL_EFFECT_PRESETS } from './adCreativeConfig.ts'
import { DEFAULT_AUDIO_FINISHING } from './adAudioFinishing.ts'

export interface AdExportIssue { id: string; message: string }
export interface AdExportReadiness {
  ready: boolean
  blockers: AdExportIssue[]
  advisories: AdExportIssue[]
  latestMatchingJob: AdRenderJob | null
}
export interface AdExportReadinessInput {
  assets: AdAsset[]
  config: AdProjectConfig
  name: string
  saveBlocked?: boolean | string
  saving?: boolean
  activeJob?: boolean
  jobs?: AdRenderJob[]
}

const DEFAULT_TEXT_STYLE = { fontSize: 72, positionY: 52, fontColor: '#FFFFFF', borderColor: '#000000', borderWidth: 6 }
const DEFAULT_FRAMING = { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018' }
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
const integerWithin = (value: number, min: number, max: number) => Number.isInteger(value) && within(value, min, max)

function canonicalEdit(edit: Partial<AdClipEdit> = {}) {
  return { ...DEFAULT_CLIP_EDIT, volume: 1, motion: 'none', ...edit }
}

function canonicalTrack(track: AdMusicTrack) {
  const defaults = { volume: 0.8, startSeconds: 0, endSeconds: null, sourceStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0.8 }
  return { ...defaults, ...track }
}

function canonicalOverlay(overlay: AdOverlay): AdOverlay {
  const common = { name: 'Camada', x: 10, y: 10, width: 40, height: 20, opacity: 1, hidden: false }
  const fields = overlay.type === 'text'
    ? { text: '', color: '#FFFFFF', fontSize: 48, backgroundColor: '#101018' }
    : overlay.type === 'shape' ? { shape: 'rectangle' as const, color: '#FFFFFF' } : { fit: 'contain' as const }
  return { ...common, ...fields, ...overlay, id: overlay.id.trim(), name: (overlay.name ?? 'Camada').trim() } as AdOverlay
}

// Sort object keys, while preserving array order because scene and text order affect exports.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function canonicalConfig(config: AdProjectConfig) {
  const effects = config.visualEffects
  return {
    kind: config.kind ?? 'video',
    variationCount: config.variationCount ?? 5,
    texts: (config.texts ?? []).map((text) => text.trim()).filter(Boolean),
    selectedClipIds: config.selectedClipIds ?? [],
    clipEdits: Object.fromEntries(Object.entries(config.clipEdits ?? {}).map(([id, edit]) => [id, canonicalEdit(edit)])),
    musicAssetId: config.musicAssetId ?? null,
    musicVolume: config.musicVolume ?? 0.8,
    musicTracks: (config.musicTracks ?? []).map(canonicalTrack),
    timing: config.timing?.mode === 'fixed' ? { mode: 'fixed', seconds: config.timing.seconds ?? 2.5 } : config.timing,
    transition: { ...DEFAULT_TRANSITION, ...config.transition },
    output: { ...{ width: 1080, height: 1920, durationSeconds: 15, fps: 30 }, ...config.output },
    framing: { ...DEFAULT_FRAMING, ...config.framing },
    colorPreset: config.colorPreset ?? 'natural',
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS, ...(effects ? VISUAL_EFFECT_PRESETS[effects.preset]?.values : {}), ...effects },
    hook: { ...DEFAULT_HOOK, ...config.hook, text: (config.hook?.text ?? '').trim() },
    textStyle: { ...DEFAULT_TEXT_STYLE, ...config.textStyle },
    carousel: {
      caption: config.carousel?.caption ?? '',
      slides: (config.carousel?.slides ?? []).map((slide) => ({
        assetId: slide.assetId, text: (slide.text ?? '').trim(), durationSeconds: slide.durationSeconds ?? 5,
        ...(slide.edit ? { edit: canonicalEdit(slide.edit) } : {}),
        ...(slide.textStyle ? { textStyle: { ...DEFAULT_TEXT_STYLE, ...slide.textStyle } } : {}),
      })),
    },
    overlays: (config.overlays ?? []).map(canonicalOverlay),
    audioFinishing: { ...DEFAULT_AUDIO_FINISHING, ...config.audioFinishing },
  }
}

function validEdit(edit: Partial<AdClipEdit> = {}) {
  const value = canonicalEdit(edit)
  return within(value.trimStart, 0, 3600) && (value.trimEnd === null || within(value.trimEnd, 0, 3600)) &&
    [0.5, 0.75, 1, 1.25, 1.5, 2].includes(value.speed) && integerWithin(value.focusX, 0, 100) &&
    integerWithin(value.focusY, 0, 100) && within(value.zoom, 1, 3) && within(value.volume, 0, 1) &&
    typeof value.framingOverride === 'boolean' && ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'].includes(value.motion)
}

function validTextStyle(style?: Partial<AdProjectConfig['textStyle']>) {
  const value = { ...DEFAULT_TEXT_STYLE, ...style }
  return integerWithin(value.fontSize, 36, 140) && integerWithin(value.positionY, 15, 85) &&
    integerWithin(value.borderWidth, 0, 12) && HEX_COLOR.test(value.fontColor) && HEX_COLOR.test(value.borderColor)
}

export function getAdExportReadiness({ assets, config, name, saveBlocked, saving, activeJob, jobs = [] }: AdExportReadinessInput): AdExportReadiness {
  const blockers: AdExportIssue[] = []
  const advisories: AdExportIssue[] = []
  const block = (id: string, message: string) => blockers.push({ id, message })
  const advise = (id: string, message: string) => advisories.push({ id, message })
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const media = assets.filter((asset) => asset.kind === 'image' || asset.kind === 'clip')
  const carousel = config.kind === 'carousel'
  const selectedIds = config.selectedClipIds ?? []
  const slides = config.carousel?.slides ?? []
  const output = config.output
  const caption = config.carousel?.caption ?? ''

  if (!name.trim() || name.trim().length > 120) block('name', 'Dê ao projeto um nome de até 120 caracteres.')
  if (saveBlocked) block('save-blocked', typeof saveBlocked === 'string' ? saveBlocked : 'Resolva o salvamento do projeto antes de gerar.')
  if (saving) block('saving', 'Aguarde o salvamento ou a operação em andamento.')
  if (activeJob) block('active-job', 'Aguarde ou cancele a geração em andamento.')
  if (!integerWithin(config.variationCount ?? 5, 1, 20)) block('variations', 'Escolha entre 1 e 20 variações.')
  if (!validTextStyle(config.textStyle) || (carousel && slides.some((slide) => !validTextStyle(slide.textStyle)))) block('text-style', 'Revise tamanho, posição, contorno e cores do texto.')
  if (config.timing?.mode !== 'beat' && (config.timing?.mode !== 'fixed' || !within(config.timing.seconds, 0.5, 15))) block('timing', 'Use intervalos de 0,5 a 15 s ou cortes na batida.')
  if (!integerWithin(output.width, 360, 2160) || !integerWithin(output.height, 640, 3840) || output.width % 2 || output.height % 2 || !within(output.durationSeconds, 3, 60) || ![24, 25, 30].includes(output.fps)) {
    block('output', 'Use dimensões pares válidas, duração de 3 a 60 s e 24, 25 ou 30 fps.')
  }
  if (carousel && !(output.width === 1080 && [1080, 1350].includes(output.height))) block('carousel-format', 'Use 1080 × 1080 ou 1080 × 1350 para o carrossel.')
  if (carousel) {
    if (slides.length < 2) block('media-empty', 'Adicione pelo menos 2 slides ao carrossel.')
    const error = carouselValidation(media, config)
    if (error) block('media-selection', error)
    if (slides.some((slide) => !validEdit(slide.edit))) block('media-edits', 'Revise corte, velocidade, enquadramento e volume dos slides.')
    if (slides.some((slide) => (slide.text ?? '').trim().length > 280)) block('slide-text', 'Use até 280 caracteres no texto de cada slide.')
    if (caption.length > 2200) block('caption-length', 'Reduza a legenda para até 2200 caracteres.')
    else if (caption.length > 2000) advise('caption-length', 'A legenda está perto do limite de 2200 caracteres.')
  } else {
    if (!selectedIds.length) block('media-empty', 'Selecione pelo menos uma imagem ou um vídeo.')
    if (selectedIds.length > 50 || new Set(selectedIds).size !== selectedIds.length) block('media-count', 'Selecione até 50 mídias, sem repetir arquivos.')
    const error = clipSequenceValidation(media, { ...config, selectedClipIds: selectedIds })
    if (error) block('media-selection', error)
    if (Object.entries(config.clipEdits ?? {}).some(([id, edit]) => !selectedIds.includes(Number(id)) || !validEdit(edit))) block('media-edits', 'Revise os ajustes das mídias selecionadas.')
    const texts = (config.texts ?? []).map((text) => text.trim()).filter(Boolean)
    if (!texts.length) block('text-empty', 'Adicione pelo menos um texto ao vídeo.')
    if (texts.length > 20 || texts.some((text) => text.length > 280)) block('text-length', 'Use até 20 textos, com no máximo 280 caracteres cada.')
    else if (texts.some((text) => text.length > 160)) advise('text-length', 'Há textos longos. Confira a leitura no celular antes de publicar.')
    const hook = { ...DEFAULT_HOOK, ...config.hook }
    if (hook.enabled && hook.clipAssetId !== null && (!selectedIds.includes(hook.clipAssetId) || !assetById.has(hook.clipAssetId))) block('hook-media', 'Escolha uma mídia selecionada para o gancho de abertura.')
    if (!within(hook.durationSeconds, 0.5, 5) || hook.text.trim().length > 120) block('hook-settings', 'Use um gancho de 0,5 a 5 s e texto de até 120 caracteres.')
  }

  const tracks = (config.musicTracks ?? []).map(canonicalTrack)
  const musicIds = [...tracks.map((track) => track.assetId), ...(config.musicAssetId ? [config.musicAssetId] : [])]
  if (musicIds.some((id) => assetById.get(id)?.kind !== 'music')) block('music-missing', 'Uma música selecionada não está mais disponível.')
  if (tracks.length > 8) block('music-count', 'Use no máximo 8 faixas de música.')
  if (!within(config.musicVolume ?? 0.8, 0, 1)) block('music-volume', 'Ajuste o volume da música entre 0 e 100%.')
  if (tracks.some((track) => {
    const end = track.endSeconds ?? output.durationSeconds
    const source = assetById.get(track.assetId)
    return !within(track.startSeconds, 0, 60) || !within(end, 0, output.durationSeconds) || end - track.startSeconds < 0.1 ||
      !within(track.sourceStartSeconds, 0, 3600) || (source?.kind === 'music' && track.sourceStartSeconds >= source.durationSeconds - 0.05) ||
      !within(track.volume, 0, 1) || !within(track.fadeInSeconds, 0, 5) || !within(track.fadeOutSeconds, 0, 5) ||
      track.fadeInSeconds + track.fadeOutSeconds > end - track.startSeconds + 0.01
  })) block('music-interval', 'Revise início, fim, volume e fades das faixas de música.')

  const audioFinishing = { ...DEFAULT_AUDIO_FINISHING, ...config.audioFinishing }
  if (typeof audioFinishing.normalizeLoudness !== 'boolean' || ![-16, -14, -12].includes(audioFinishing.targetLufs)) block('audio-finishing', 'Revise o nivelamento de volume e o alvo de loudness.')

  const overlays = (config.overlays ?? []).map(canonicalOverlay)
  if (overlays.length > 8 || new Set(overlays.map((overlay) => overlay.id)).size !== overlays.length) block('overlay-count', 'Use até 8 camadas, com identificadores diferentes.')
  for (const [index, overlay] of overlays.entries()) {
    const label = `camada ${index + 1}`
    if (!overlay.id || overlay.id.length > 64 || overlay.name.length > 80 || typeof overlay.hidden !== 'boolean' ||
      !within(overlay.x, 0, 100) || !within(overlay.y, 0, 100) || !within(overlay.width, 1, 100) || !within(overlay.height, 1, 100) || !within(overlay.opacity, 0, 1)) {
      block(`overlay-layout-${index}`, `Revise nome, posição, tamanho e opacidade da ${label}.`)
    }
    if (overlay.type === 'image' && (assetById.get(overlay.assetId)?.kind !== 'image' || !['contain', 'cover'].includes(overlay.fit))) block(`overlay-image-${index}`, `Escolha uma imagem disponível para a ${label}.`)
    if (overlay.type === 'text' && (overlay.text.length > 280 || !integerWithin(overlay.fontSize, 12, 200) || !HEX_COLOR.test(overlay.color) || !HEX_COLOR.test(overlay.backgroundColor))) block(`overlay-text-${index}`, `Revise o texto e as cores da ${label}.`)
    if (overlay.type === 'shape' && (!['rectangle', 'ellipse'].includes(overlay.shape) || !HEX_COLOR.test(overlay.color))) block(`overlay-shape-${index}`, `Revise a forma e a cor da ${label}.`)
    if (!overlay.hidden && (overlay.x + overlay.width > 100 || overlay.y + overlay.height > 100)) advise(`overlay-crop-${index}`, `Parte da ${label} fica fora da imagem. Confira a prévia.`)
  }

  const usedMedia = [...new Set(carousel ? slides.map((slide) => slide.assetId) : selectedIds)].flatMap((id) => {
    const asset = assetById.get(id)
    return asset && asset.kind !== 'music' ? [asset] : []
  })
  if (usedMedia.some((asset) => asset.width !== null && asset.height !== null && (asset.width < output.width || asset.height < output.height))) advise('media-resolution', 'Há mídias menores que a saída. Confira a nitidez na prévia final.')
  if ((config.framing?.mode ?? 'cover') === 'cover' && usedMedia.some((asset) => asset.width && asset.height && Math.abs(asset.width / asset.height - output.width / output.height) > 0.02)) advise('media-crop', 'O preenchimento corta mídias de outra proporção. Confira o enquadramento do produto.')
  const textPositions = carousel ? slides.filter((slide) => slide.text?.trim()).map((slide) => slide.textStyle?.positionY ?? config.textStyle?.positionY ?? 52) : (config.texts ?? []).some((text) => text.trim()) ? [config.textStyle?.positionY ?? 52] : []
  const vertical = output.width * 16 === output.height * 9
  if (textPositions.some((position) => position < (vertical ? 14 : 7) || position > (vertical ? 65 : output.width === output.height ? 93 : 88))) advise('text-safe-area', 'Há texto perto da interface do Instagram. Confira a área segura na prévia.')

  const fingerprint = stableJson(canonicalConfig(config))
  const latestMatchingJob = jobs.filter((job) => job.status === 'completed' && job.outputs.length > 0 && stableJson(canonicalConfig(job.config)) === fingerprint)
    .sort((a, b) => (Date.parse(b.finishedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.createdAt)) || b.id - a.id)[0] ?? null
  return { ready: blockers.length === 0, blockers, advisories, latestMatchingJob }
}
