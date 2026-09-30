import type { AdTransitionPreset } from '@/lib/api'

export type PreviewLayerStyle = {
  opacity: number
  transform: string
}

export type PreviewTransitionFrame = {
  incoming: PreviewLayerStyle
  outgoing: PreviewLayerStyle
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function smoothstep(start: number, end: number, value: number): number {
  const position = clamp((value - start) / (end - start), 0, 1)
  return position * position * (3 - 2 * position)
}

// FFmpeg's xfade/dissolve selects the incoming pixel when frand(x, y) < amount.
// The browser uses a smaller mask, so the shape is an approximation of output pixels.
export function previewDissolveNoise(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.545
  return value - Math.floor(value)
}

export function previewDissolveAlpha(x: number, y: number, amount: number): number {
  return previewDissolveNoise(x, y) < clamp(amount, 0, 1) ? 255 : 0
}

const dissolveMaskCache = new Map<string, string>()
const dissolveNoiseCache = new Map<string, Float32Array>()
const DISSOLVE_MASK_STEPS = 64
const DISSOLVE_MASK_MAX_SIDE = 384

export function previewDissolveMaskDataUrl(outputWidth: number, outputHeight: number, amount: number): string {
  const ratio = Math.max(1, outputWidth) / Math.max(1, outputHeight)
  const width = Math.max(1, Math.round(DISSOLVE_MASK_MAX_SIDE * Math.min(1, ratio)))
  const height = Math.max(1, Math.round(DISSOLVE_MASK_MAX_SIDE * Math.min(1, 1 / ratio)))
  const step = Math.round(clamp(amount, 0, 1) * DISSOLVE_MASK_STEPS)
  const key = `${width}:${height}:${step}`
  const cached = dissolveMaskCache.get(key)
  if (cached) return cached

  const dimensions = `${width}:${height}`
  let noise = dissolveNoiseCache.get(dimensions)
  if (!noise) {
    noise = new Float32Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        noise[y * width + x] = previewDissolveNoise(x, y)
      }
    }
    if (dissolveNoiseCache.size >= 4) dissolveNoiseCache.delete(dissolveNoiseCache.keys().next().value!)
    dissolveNoiseCache.set(dimensions, noise)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const pixels = context.createImageData(width, height)
  const threshold = step / DISSOLVE_MASK_STEPS
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      pixels.data[offset] = 255
      pixels.data[offset + 1] = 255
      pixels.data[offset + 2] = 255
      pixels.data[offset + 3] = noise[y * width + x] < threshold ? 255 : 0
    }
  }
  context.putImageData(pixels, 0, 0)
  const url = canvas.toDataURL('image/png')
  if (dissolveMaskCache.size >= DISSOLVE_MASK_STEPS + 1) {
    dissolveMaskCache.delete(dissolveMaskCache.keys().next().value!)
  }
  dissolveMaskCache.set(key, url)
  return url
}

export function previewTransitionFrame(
  preset: AdTransitionPreset,
  progress: number,
  ready: boolean,
): PreviewTransitionFrame {
  if (!ready) {
    return {
      incoming: { opacity: 0, transform: 'none' },
      outgoing: { opacity: 1, transform: 'none' },
    }
  }

  const amount = clamp(progress, 0, 1)
  if (preset === 'cut' || amount >= 1) {
    return {
      incoming: { opacity: 1, transform: 'none' },
      outgoing: { opacity: 0, transform: 'none' },
    }
  }
  if (preset === 'slide-left') {
    return {
      incoming: { opacity: 1, transform: `translate3d(${(1 - amount) * 100}%, 0, 0)` },
      outgoing: { opacity: 1, transform: `translate3d(${-amount * 100}%, 0, 0)` },
    }
  }
  if (preset === 'slide-up') {
    return {
      incoming: { opacity: 1, transform: `translate3d(0, ${(1 - amount) * 100}%, 0)` },
      outgoing: { opacity: 1, transform: `translate3d(0, ${-amount * 100}%, 0)` },
    }
  }
  if (preset === 'zoom') {
    const ffmpegProgress = 1 - amount
    const zoomFactor = smoothstep(0.5, 1, ffmpegProgress)
    return {
      incoming: { opacity: 1 - smoothstep(0, 0.5, ffmpegProgress), transform: 'none' },
      outgoing: { opacity: 1, transform: `scale(${1 / Math.max(zoomFactor, 0.001)})` },
    }
  }
  if (preset === 'dissolve') {
    return {
      incoming: { opacity: 1, transform: 'none' },
      outgoing: { opacity: 1, transform: 'none' },
    }
  }
  return {
    incoming: { opacity: amount, transform: 'none' },
    outgoing: { opacity: 1, transform: 'none' },
  }
}

export function previewClipSourceTime(
  trimStart: number,
  trimEnd: number,
  speed: number,
  segmentElapsed: number,
  segmentOutputDuration: number,
): number {
  const safeTrimStart = Math.max(0, trimStart)
  const availableSourceDuration = Math.max(0.01, trimEnd - safeTrimStart)
  const safeSpeed = Math.max(0.01, speed)
  const sourceOffset = Math.max(0, segmentElapsed) * safeSpeed
  const boundedOffset = previewClipLoops(
    safeTrimStart,
    safeTrimStart + availableSourceDuration,
    safeSpeed,
    segmentOutputDuration,
  )
    ? sourceOffset % availableSourceDuration
    : Math.min(sourceOffset, Math.max(0, availableSourceDuration - 0.01))
  return safeTrimStart + boundedOffset
}

export function previewClipLoops(
  trimStart: number,
  trimEnd: number,
  speed: number,
  segmentOutputDuration: number,
): boolean {
  const availableSourceDuration = Math.max(0.01, trimEnd - Math.max(0, trimStart))
  const effectiveDuration = availableSourceDuration / Math.max(0.01, speed)
  return effectiveDuration + 0.05 < segmentOutputDuration && effectiveDuration <= 12
}
