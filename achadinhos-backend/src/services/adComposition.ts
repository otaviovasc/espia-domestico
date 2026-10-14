import { Resvg } from '@resvg/resvg-js'
import type { AdOverlay, AdProjectConfig } from '@/dtos/adProject'
import { resolveCaptionFont } from '@/services/adCaptionArtwork'
import { runProcess } from '@/services/AdMediaService'

type CompositionAsset = { id: number; kind: string; storagePath: string }
const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** Deterministic layout shared with the browser. All lengths are output pixels. */
export function wrapOverlayText(text: string, width: number, fontSize: number): string[] {
  const capacity = Math.max(1, Math.floor((width - fontSize * 0.5) / (fontSize * 0.6)))
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let rest = [...paragraph]
    if (!rest.length) return ['']
    while (rest.length) {
      if (rest.length <= capacity) {
        lines.push(rest.join(''))
        break
      }
      let count = capacity
      for (let index = capacity; index > 0; index -= 1) {
        if (/\s/u.test(rest[index])) {
          count = index
          break
        }
      }
      lines.push(rest.slice(0, count).join('').trimEnd())
      rest = [...rest.slice(count).join('').trimStart()]
    }
    return lines
  })
}

/** Only internally rasterized image bytes may be embedded. User text is escaped. */
export function createOverlayArtwork(
  overlays: AdOverlay[],
  output: { width: number; height: number },
  imagePngs: Map<number, Buffer> = new Map(),
): string {
  const font = resolveCaptionFont()
  const markup = overlays
    .flatMap((overlay, index) => {
      if (overlay.hidden || overlay.opacity === 0) return []
      const x = (output.width * overlay.x) / 100,
        y = (output.height * overlay.y) / 100
      const width = (output.width * overlay.width) / 100,
        height = (output.height * overlay.height) / 100
      let content: string
      if (overlay.type === 'shape') {
        content =
          overlay.shape === 'ellipse'
            ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${overlay.color}"/>`
            : `<rect width="${width}" height="${height}" fill="${overlay.color}"/>`
      } else if (overlay.type === 'text') {
        const padding = overlay.fontSize * 0.25
        const lines = wrapOverlayText(overlay.text, width, overlay.fontSize)
        content =
          `<rect width="${width}" height="${height}" fill="${overlay.backgroundColor}"/>` +
          lines
            .map(
              (line, lineIndex) =>
                `<text x="${padding}" y="${padding + overlay.fontSize + lineIndex * overlay.fontSize * 1.2}" font-family="${escapeXml(font.family)}" font-size="${overlay.fontSize}" font-weight="bold" fill="${overlay.color}" xml:space="preserve">${escapeXml(line)}</text>`,
            )
            .join('')
      } else {
        const png = imagePngs.get(overlay.assetId)
        if (!png) throw new Error('Imagem da camada indisponível')
        content = `<image width="${width}" height="${height}" preserveAspectRatio="xMidYMid ${overlay.fit === 'cover' ? 'slice' : 'meet'}" href="data:image/png;base64,${png.toString('base64')}"/>`
      }
      // Numeric indexes generate IDs, avoiding user-controlled references/markup.
      return [
        `<defs><clipPath id="layer${index}"><rect width="${width}" height="${height}"/></clipPath></defs><g transform="translate(${x} ${y})" opacity="${overlay.opacity}" clip-path="url(#layer${index})">${content}</g>`,
      ]
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}" viewBox="0 0 ${output.width} ${output.height}">${markup}</svg>`
}

export async function rasterizeAdComposition(
  config: Pick<AdProjectConfig, 'overlays' | 'output'>,
  assets: CompositionAsset[],
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const visible = (config.overlays ?? []).filter(
    (overlay) => !overlay.hidden && overlay.opacity > 0,
  )
  if (!visible.length) return null
  const pngs = new Map<number, Buffer>()
  for (const overlay of visible) {
    if (overlay.type !== 'image' || pngs.has(overlay.assetId)) continue
    signal?.throwIfAborted()
    const asset = assets.find((item) => item.id === overlay.assetId && item.kind === 'image')
    if (!asset) throw new Error('Imagem da camada indisponível')
    // Decode through FFmpeg so WebP and alpha use the same trusted PNG path.
    pngs.set(
      overlay.assetId,
      await runProcess(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          asset.storagePath,
          '-frames:v',
          '1',
          '-vf',
          `scale=${config.output.width}:${config.output.height}:force_original_aspect_ratio=decrease`,
          '-f',
          'image2pipe',
          '-c:v',
          'png',
          'pipe:1',
        ],
        { captureStdout: true, signal },
      ),
    )
  }
  signal?.throwIfAborted()
  const font = resolveCaptionFont()
  return new Resvg(createOverlayArtwork(visible, config.output, pngs), {
    font: { loadSystemFonts: false, fontFiles: [font.path], defaultFontFamily: font.family },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng()
}
