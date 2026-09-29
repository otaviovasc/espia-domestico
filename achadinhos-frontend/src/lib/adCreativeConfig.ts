import type {
  AdHookConfig,
  AdMusicTrack,
  AdProjectConfig,
  AdVisualEffectsConfig,
  AdVisualEffectsPreset,
} from '@/lib/api'

export type VisualPresetDefinition = {
  label: string
  description: string
  values: AdVisualEffectsConfig
}

export const VISUAL_EFFECT_PRESETS: Record<AdVisualEffectsPreset, VisualPresetDefinition> = {
  natural: {
    label: 'Natural',
    description: 'Correção neutra e fiel ao clipe',
    values: { preset: 'natural', brightness: 0, contrast: 1, saturation: 1, sharpness: 0, temperature: 0, vignette: 0, grain: 0, glow: 0 },
  },
  'clean-product': {
    label: 'Produto nítido',
    description: 'Detalhe limpo para demonstrações',
    values: { preset: 'clean-product', brightness: 0.03, contrast: 1.07, saturation: 1.08, sharpness: 0.65, temperature: -0.03, vignette: 0.03, grain: 0, glow: 0.08 },
  },
  'warm-ugc': {
    label: 'UGC quente',
    description: 'Pele e ambiente mais acolhedores',
    values: { preset: 'warm-ugc', brightness: 0.02, contrast: 1.04, saturation: 1.1, sharpness: 0.3, temperature: 0.25, vignette: 0.05, grain: 0.03, glow: 0.06 },
  },
  vivid: {
    label: 'Oferta vibrante',
    description: 'Cor e definição para preço e produto',
    values: { preset: 'vivid', brightness: 0.02, contrast: 1.1, saturation: 1.28, sharpness: 0.55, temperature: 0.03, vignette: 0.06, grain: 0.02, glow: 0.08 },
  },
  cinematic: {
    label: 'Cinemático',
    description: 'Contraste, grão e vinheta discretos',
    values: { preset: 'cinematic', brightness: -0.02, contrast: 1.14, saturation: 0.9, sharpness: 0.35, temperature: -0.12, vignette: 0.25, grain: 0.04, glow: 0.06 },
  },
  custom: {
    label: 'Personalizado',
    description: 'Ajustes manuais deste projeto',
    values: { preset: 'custom', brightness: 0, contrast: 1, saturation: 1, sharpness: 0, temperature: 0, vignette: 0, grain: 0, glow: 0 },
  },
}

export const DEFAULT_VISUAL_EFFECTS: AdVisualEffectsConfig = { ...VISUAL_EFFECT_PRESETS.natural.values }

export const DEFAULT_HOOK: AdHookConfig = {
  enabled: false,
  clipAssetId: null,
  durationSeconds: 1.5,
  text: '',
}

function legacyTrack(config: AdProjectConfig): AdMusicTrack[] {
  if (!config.musicAssetId) return []
  return [{
    assetId: config.musicAssetId,
    volume: config.musicVolume ?? 0.8,
    startSeconds: 0,
    endSeconds: null,
    sourceStartSeconds: 0,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  }]
}

export function normaliseCreativeConfig(config: AdProjectConfig): AdProjectConfig {
  return {
    ...config,
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS, ...(config.visualEffects ?? {}) },
    hook: { ...DEFAULT_HOOK, ...(config.hook ?? {}) },
    musicTracks: config.musicTracks?.length ? config.musicTracks.map((track) => ({ ...track })) : legacyTrack(config),
  }
}
