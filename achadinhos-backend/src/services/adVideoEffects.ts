import type { AdProjectConfig } from '@/dtos/adProject'

export type ResolvedVisualEffects = AdProjectConfig['visualEffects']

const NEUTRAL_EFFECTS: ResolvedVisualEffects = {
  preset: 'natural',
  brightness: 0,
  contrast: 1,
  saturation: 1,
  sharpness: 0,
  temperature: 0,
  vignette: 0,
  grain: 0,
  glow: 0,
}

/**
 * Older queued jobs do not have visualEffects in their JSON snapshot. Keep
 * those renders neutral while new jobs use the fully validated DTO values.
 */
export function resolveVisualEffects(config: AdProjectConfig): ResolvedVisualEffects {
  return { ...NEUTRAL_EFFECTS, ...config.visualEffects }
}

/**
 * Filters which can live in an ordinary -vf chain. Bloom/glow is returned
 * separately because it needs two video branches and a screen blend.
 */
export function buildLinearVisualEffectFilter(config: AdProjectConfig): string {
  const effects = resolveVisualEffects(config)
  const filters = [
    `eq=brightness=${effects.brightness.toFixed(3)}:contrast=${effects.contrast.toFixed(3)}:saturation=${effects.saturation.toFixed(3)}`,
  ]

  if (Math.abs(effects.temperature) >= 0.005) {
    const warmth = effects.temperature * 0.12
    filters.push(
      `colorbalance=rs=${warmth.toFixed(3)}:gs=${(warmth * 0.18).toFixed(3)}:bs=${(-warmth).toFixed(3)}`,
    )
  }
  if (effects.sharpness >= 0.005) {
    filters.push(`unsharp=5:5:${Math.min(2, effects.sharpness).toFixed(3)}:5:5:0`)
  }
  if (effects.vignette >= 0.005) {
    // The angle range keeps the maximum setting usable for direct response
    // ads instead of crushing the corners to black.
    const angle = Math.PI / (5.5 - effects.vignette * 1.8)
    filters.push(`vignette=angle=${angle.toFixed(4)}:eval=frame`)
  }
  if (effects.grain >= 0.005) {
    filters.push(`noise=alls=${Math.round(effects.grain * 22)}:allf=t`)
  }

  return filters.join(',')
}

export function hasVisualGlow(config: AdProjectConfig): boolean {
  return resolveVisualEffects(config).glow >= 0.005
}

/**
 * Turns an already styled video label into a subtle bloom using a blurred
 * copy and a screen blend. The caller owns the surrounding filter graph.
 */
export function buildGlowGraph(
  inputLabel: string,
  outputLabel: string,
  config: AdProjectConfig,
  labelPrefix = 'fx',
): string {
  const amount = resolveVisualEffects(config).glow
  if (amount < 0.005) return `[${inputLabel}]null[${outputLabel}]`
  const sigma = 2.5 + amount * 14
  const opacity = Math.min(0.38, amount * 0.38)
  return [
    `[${inputLabel}]split=2[${labelPrefix}base][${labelPrefix}bloomsource]`,
    `[${labelPrefix}bloomsource]gblur=sigma=${sigma.toFixed(2)},eq=brightness=${(0.025 + amount * 0.08).toFixed(3)}[${labelPrefix}bloom]`,
    `[${labelPrefix}base][${labelPrefix}bloom]blend=all_mode=screen:all_opacity=${opacity.toFixed(3)}[${outputLabel}]`,
  ].join(';')
}
