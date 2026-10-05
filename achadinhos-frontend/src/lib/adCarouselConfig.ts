import type { AdAsset, AdAssetKind, AdProjectConfig } from './api.ts'

export function addUploadedMedia(
  config: AdProjectConfig,
  kind: AdAssetKind,
  assets: AdAsset[],
): AdProjectConfig {
  if (kind !== 'music') {
    if (config.kind === 'carousel') {
      const slides = config.carousel?.slides ?? []
      if (slides.length + assets.length > 20)
        throw new Error('O carrossel aceita até 20 slides por projeto.')
      return {
        ...config,
        carousel: {
          caption: config.carousel?.caption ?? '',
          slides: [
            ...slides,
            ...assets.map((asset) => ({
              assetId: asset.id,
              text: '',
              durationSeconds: Math.min(
                60,
                Math.max(3, asset.durationSeconds || 5),
              ),
            })),
          ],
        },
      }
    }
    if (config.selectedClipIds.length + assets.length > 50)
      throw new Error('O vídeo aceita até 50 mídias selecionadas.')
    return {
      ...config,
      selectedClipIds: [
        ...new Set([
          ...config.selectedClipIds,
          ...assets.map((asset) => asset.id),
        ]),
      ],
    }
  }
  if (config.musicTracks.length + assets.length > 8)
    throw new Error('A trilha aceita até 8 faixas.')
  return {
    ...config,
    musicAssetId: config.musicAssetId ?? assets[0]?.id ?? null,
    musicTracks: [
      ...config.musicTracks,
      ...assets.map((asset) => ({
        assetId: asset.id,
        volume: 0.75,
        startSeconds: 0,
        endSeconds: null,
        sourceStartSeconds: 0,
        fadeInSeconds: 0.25,
        fadeOutSeconds: 0.5,
      })),
    ],
  }
}

export function carouselValidation(
  assets: AdAsset[],
  config: AdProjectConfig,
): string | null {
  const slides = config.carousel?.slides ?? []
  const ids = new Set(
    assets.filter((asset) => asset.kind !== 'music').map((asset) => asset.id),
  )
  if (slides.length > 20) return 'O carrossel aceita até 20 slides.'
  if (slides.some((slide) => !ids.has(slide.assetId)))
    return 'Uma mídia do carrossel não está mais disponível.'
  if (
    slides.some(
      (slide) =>
        !Number.isFinite(slide.durationSeconds) ||
        slide.durationSeconds < 3 ||
        slide.durationSeconds > 60,
    )
  )
    return 'Cada vídeo deve ter entre 3 e 60 segundos.'
  return null
}
