export interface AdAudioFinishing {
  normalizeLoudness: boolean
  targetLufs: -16 | -14 | -12
}

export const DEFAULT_AUDIO_FINISHING: Readonly<AdAudioFinishing> = Object.freeze({
  normalizeLoudness: false,
  targetLufs: -14,
})

/** Keep old drafts opt-in and reduce partially saved settings to supported values. */
export function resolveAdAudioFinishing(value?: unknown): AdAudioFinishing {
  const settings = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    normalizeLoudness: settings.normalizeLoudness === true,
    targetLufs: settings.targetLufs === -16 || settings.targetLufs === -12
      ? settings.targetLufs
      : -14,
  }
}
