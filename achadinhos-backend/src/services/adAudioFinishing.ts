export interface AdAudioFinishing {
  normalizeLoudness: boolean
  targetLufs: -16 | -14 | -12
}

export const DEFAULT_AUDIO_FINISHING: Readonly<AdAudioFinishing> = Object.freeze({
  normalizeLoudness: false,
  targetLufs: -14,
})

/** Validate saved settings before interpolating anything into an FFmpeg filter. */
export function resolveAdAudioFinishing(value?: unknown): AdAudioFinishing {
  if (value === undefined) return { ...DEFAULT_AUDIO_FINISHING }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Configuração de finalização de áudio inválida.')
  }
  const settings = value as Record<string, unknown>
  const normalizeLoudness = settings.normalizeLoudness === undefined ? false : settings.normalizeLoudness
  const targetLufs = settings.targetLufs === undefined ? -14 : settings.targetLufs
  if (typeof normalizeLoudness !== 'boolean') {
    throw new TypeError('A normalização de áudio deve ser ativada ou desativada.')
  }
  if (targetLufs !== -16 && targetLufs !== -14 && targetLufs !== -12) {
    throw new TypeError('O alvo de áudio deve ser -16, -14 ou -12 LUFS.')
  }
  return { normalizeLoudness, targetLufs }
}

/** Apply once after gain, fades and mixing. Muted/no-audio outputs must bypass it. */
export function buildAudioFinishingFilter(value?: unknown): string | null {
  const settings = resolveAdAudioFinishing(value)
  if (!settings.normalizeLoudness) return null
  // Single-pass dynamic EBU R128 normalization. The target is a goal, not a
  // guaranteed integrated measurement for every short or mostly silent clip.
  // Dynamic loudnorm upsamples to 192 kHz; AAC otherwise chooses 96 kHz.
  // Finish at the standard 48 kHz used by video exports.
  return `loudnorm=I=${settings.targetLufs}:TP=-1.5:LRA=11,aresample=48000`
}
