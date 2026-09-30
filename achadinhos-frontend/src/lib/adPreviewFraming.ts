import type { AdFramingMode } from '@/lib/api'

/** Match FFmpeg scale/crop/pad geometry in output coordinates. */
export function previewClipGeometry(
  output: { width: number; height: number },
  source: { width: number | null; height: number | null } | undefined,
  mode: AdFramingMode,
  focusX: number,
  focusY: number,
  zoom: number,
): { width: string; height: string; left: string; top: string } {
  const width = source?.width || output.width
  const height = source?.height || output.height
  const targetWidth = Math.max(output.width, Math.round(output.width * zoom / 2) * 2)
  const targetHeight = Math.max(output.height, Math.round(output.height * zoom / 2) * 2)
  const scale = mode === 'cover'
    ? Math.max(targetWidth / width, targetHeight / height)
    : Math.min(targetWidth / width, targetHeight / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const left = scaledWidth > output.width
    ? -(scaledWidth - output.width) * focusX / 100
    : (output.width - scaledWidth) / 2
  const top = scaledHeight > output.height
    ? -(scaledHeight - output.height) * focusY / 100
    : (output.height - scaledHeight) / 2
  return {
    width: `${scaledWidth / output.width * 100}%`,
    height: `${scaledHeight / output.height * 100}%`,
    left: `${left / output.width * 100}%`,
    top: `${top / output.height * 100}%`,
  }
}
