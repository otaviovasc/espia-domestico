import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js'

const SAFE_WIDTH_RATIO = 0.86
const LINE_HEIGHT_RATIO = 1.04
const MAX_CACHE_ENTRIES = 128
const TWEMOJI_DIR = path.dirname(require.resolve('@twemoji/svg/package.json'))
type GraphemePart = { segment: string; index: number }
const GraphemeSegmenter = (Intl as unknown as {
  Segmenter: new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' },
  ) => { segment(value: string): Iterable<GraphemePart> }
}).Segmenter
const graphemeSegmenter = new GraphemeSegmenter(undefined, { granularity: 'grapheme' })

export interface CaptionArtworkInput {
  text: string
  output: { width: number; height: number }
  textStyle: {
    fontSize: number
    fontColor: string
    borderWidth: number
    borderColor: string
    positionY: number
  }
}

export interface CaptionArtwork {
  text: string
  svg: string
  width: number
  height: number
  lines: string[]
}

export interface CaptionFont {
  path: string
  family: string
  cacheKey: string
}

const artworkCache = new Map<string, CaptionArtwork>()
const measuredTextCache = new Map<string, number>()
const fontCache = new Map<string, CaptionFont>()
const twemojiCache = new Map<string, string | null>()

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeUtf16Be(value: Buffer): string {
  const swapped = Buffer.allocUnsafe(value.length - (value.length % 2))
  for (let index = 0; index + 1 < value.length; index += 2) {
    swapped[index] = value[index + 1]
    swapped[index + 1] = value[index]
  }
  return swapped.toString('utf16le').replace(/\0/g, '').trim()
}

function fontFamily(fontPath: string): string {
  const file = readFileSync(fontPath)
  if (file.length < 12) return 'Ad Caption'
  const tableCount = file.readUInt16BE(4)
  let nameOffset = -1
  let nameLength = 0
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16
    if (offset + 16 > file.length) break
    if (file.toString('ascii', offset, offset + 4) === 'name') {
      nameOffset = file.readUInt32BE(offset + 8)
      nameLength = file.readUInt32BE(offset + 12)
      break
    }
  }
  if (nameOffset < 0 || nameOffset + Math.min(nameLength, 6) > file.length) return 'Ad Caption'
  const count = file.readUInt16BE(nameOffset + 2)
  const stringsOffset = nameOffset + file.readUInt16BE(nameOffset + 4)
  const candidates: Array<{ priority: number; value: string }> = []
  for (let index = 0; index < count; index += 1) {
    const record = nameOffset + 6 + index * 12
    if (record + 12 > file.length) break
    const platform = file.readUInt16BE(record)
    const language = file.readUInt16BE(record + 4)
    const nameId = file.readUInt16BE(record + 6)
    if (nameId !== 1 && nameId !== 16) continue
    const length = file.readUInt16BE(record + 8)
    const offset = stringsOffset + file.readUInt16BE(record + 10)
    if (offset < 0 || offset + length > file.length) continue
    const bytes = file.subarray(offset, offset + length)
    const value = platform === 0 || platform === 3
      ? decodeUtf16Be(bytes)
      : bytes.toString('latin1').replace(/\0/g, '').trim()
    if (!value) continue
    const priority = (nameId === 16 ? 4 : 0) + (language === 0x409 ? 2 : 0) + (platform === 3 ? 1 : 0)
    candidates.push({ priority, value })
  }
  return candidates.sort((left, right) => right.priority - left.priority)[0]?.value ?? 'Ad Caption'
}

export function resolveCaptionFont(): CaptionFont {
  const configured = process.env.AD_FONT_FILE?.trim()
  const candidates = [
    configured ? path.resolve(configured) : '',
    path.resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ].filter(Boolean)
  const selected = candidates.find((candidate) => existsSync(candidate))
  if (!selected) throw new Error('Caption font file was not found')
  const file = statSync(selected)
  const key = `${selected}:${file.size}:${file.mtimeMs}`
  const cached = fontCache.get(key)
  if (cached) return cached
  const resolved = {
    path: selected,
    family: fontFamily(selected),
    cacheKey: key,
  }
  fontCache.clear()
  fontCache.set(key, resolved)
  return resolved
}

function fontOptions(font: CaptionFont): ResvgRenderOptions {
  return {
    font: {
      loadSystemFonts: false,
      fontFiles: [font.path],
      defaultFontFamily: font.family,
      sansSerifFamily: font.family,
    },
    fitTo: { mode: 'original' },
    background: 'rgba(0,0,0,0)',
    textRendering: 2,
  }
}

function twemojiPath(grapheme: string): string | null {
  if (twemojiCache.has(grapheme)) return twemojiCache.get(grapheme) ?? null
  const code = [...grapheme]
    .map((character) => character.codePointAt(0)!)
    .filter((point) => point !== 0xfe0f)
    .map((point) => point.toString(16))
    .join('-')
  if (!code) return null
  const candidate = path.join(TWEMOJI_DIR, `${code}.svg`)
  const resolved = existsSync(candidate) ? candidate : null
  twemojiCache.set(grapheme, resolved)
  return resolved
}

function splitEmoji(value: string): { text: string; emojiPaths: string[] } {
  let text = ''
  const emojiPaths: string[] = []
  for (const part of graphemeSegmenter.segment(value)) {
    const assetPath = twemojiPath(part.segment)
    if (assetPath) emojiPaths.push(assetPath)
    else text += part.segment
  }
  return {
    text: text.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, ''),
    emojiPaths,
  }
}

function textElement(
  line: string,
  x: number,
  baseline: number,
  input: CaptionArtworkInput,
  font: CaptionFont,
): string {
  const { textStyle } = input
  return `<text x="${x}" y="${baseline}" text-anchor="middle" xml:space="preserve" font-family="${escapeXml(font.family)}" font-size="${textStyle.fontSize}" font-weight="bold" fill="${escapeXml(textStyle.fontColor)}" stroke="${escapeXml(textStyle.borderColor)}" stroke-width="${textStyle.borderWidth * 2}" stroke-linejoin="round" paint-order="stroke fill">${escapeXml(line)}</text>`
}

function measureText(value: string, input: CaptionArtworkInput, font: CaptionFont): number {
  if (!value) return 0
  const key = `${font.cacheKey}:${input.textStyle.fontSize}:${input.textStyle.borderWidth}:${value}`
  const cached = measuredTextCache.get(key)
  if (cached !== undefined) return cached
  const x = input.output.width * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.output.width * 4}" height="${input.textStyle.fontSize * 4}">${textElement(value, x, input.textStyle.fontSize * 2, input, font)}</svg>`
  const width = new Resvg(svg, fontOptions(font)).getBBox()?.width ?? 0
  measuredTextCache.set(key, width)
  if (measuredTextCache.size > 2048) measuredTextCache.delete(measuredTextCache.keys().next().value!)
  return width
}

function wrapParagraph(value: string, maxWidth: number, input: CaptionArtworkInput, font: CaptionFont): string[] {
  if (!value) return ['']
  const lines: string[] = []
  let remaining = value
  while (remaining) {
    if (measureText(remaining, input, font) <= maxWidth) {
      lines.push(remaining)
      break
    }
    const segments = [...graphemeSegmenter.segment(remaining)]
    let low = 1
    let high = segments.length
    let fittingCount = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const segment = segments[middle - 1]
      const end = segment.index + segment.segment.length
      if (measureText(remaining.slice(0, end), input, font) <= maxWidth) {
        fittingCount = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    const fitting = Math.max(1, fittingCount)
    const whitespaceIndexes = segments
      .slice(0, fitting)
      .map((segment, index) => (/^\s+$/u.test(segment.segment) ? index : -1))
      .filter((index) => index >= 0)
    const whitespaceIndex = whitespaceIndexes.length
      ? whitespaceIndexes[whitespaceIndexes.length - 1]
      : undefined
    const breakCount = whitespaceIndex === undefined ? fitting : Math.max(1, whitespaceIndex)
    const breakSegment = segments[breakCount - 1]
    const end = breakSegment.index + breakSegment.segment.length
    lines.push(remaining.slice(0, end).trimEnd())
    remaining = remaining.slice(end).trimStart()
  }
  return lines
}

function wrappedLines(value: string, input: CaptionArtworkInput, font: CaptionFont): string[] {
  const maxWidth = input.output.width * SAFE_WIDTH_RATIO
  return value.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, input, font))
}

function textMarkup(lines: string[], input: CaptionArtworkInput, font: CaptionFont): string {
  const lineSpacing = Math.max(1, Math.round(input.textStyle.fontSize * (LINE_HEIGHT_RATIO - 1)))
  const lineAdvance = input.textStyle.fontSize + lineSpacing
  const centerX = input.output.width / 2
  return lines.map((line, index) => textElement(line, centerX, index * lineAdvance, input, font)).join('')
}

function bboxFor(markup: string, input: CaptionArtworkInput, font: CaptionFont): { x: number; y: number; width: number; height: number } {
  const pad = Math.max(input.output.height * 2, input.textStyle.fontSize * 8)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.output.width}" height="${pad * 2}"><g transform="translate(0 ${pad})">${markup}</g></svg>`
  const box = new Resvg(svg, fontOptions(font)).getBBox()
  if (!box) return { x: input.output.width / 2, y: 0, width: 0, height: 0 }
  return { x: box.x, y: box.y - pad, width: box.width, height: box.height }
}

function emojiMarkup(
  emojiPaths: string[],
  textTop: number,
  input: CaptionArtworkInput,
): string {
  if (!emojiPaths.length) return ''
  const size = Math.round(input.textStyle.fontSize * 1.05)
  const gap = Math.round(size * 0.18)
  const rowGap = Math.max(1, Math.round(size * 0.12))
  const maxPerRow = Math.max(1, Math.floor((input.output.width * SAFE_WIDTH_RATIO + gap) / (size + gap)))
  const rowCount = Math.ceil(emojiPaths.length / maxPerRow)
  const captionGap = Math.round(input.textStyle.fontSize * 0.28)
  const firstY = textTop - captionGap - rowCount * size - Math.max(0, rowCount - 1) * rowGap
  return emojiPaths.map((assetPath, index) => {
    const row = Math.floor(index / maxPerRow)
    const rowStart = row * maxPerRow
    const rowLength = Math.min(maxPerRow, emojiPaths.length - rowStart)
    const rowWidth = rowLength * size + Math.max(0, rowLength - 1) * gap
    const column = index - rowStart
    const x = (input.output.width - rowWidth) / 2 + column * (size + gap)
    const y = firstY + row * (size + rowGap)
    const svg = readFileSync(assetPath).toString('base64')
    return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${svg}"/>`
  }).join('')
}

function cacheKey(input: CaptionArtworkInput, font: CaptionFont): string {
  return createHash('sha256').update(JSON.stringify({ ...input, font: font.cacheKey })).digest('hex')
}

function remember(key: string, value: CaptionArtwork): CaptionArtwork {
  artworkCache.delete(key)
  artworkCache.set(key, value)
  while (artworkCache.size > MAX_CACHE_ENTRIES) artworkCache.delete(artworkCache.keys().next().value!)
  return value
}

export function createCaptionArtwork(input: CaptionArtworkInput): CaptionArtwork {
  const font = resolveCaptionFont()
  const key = cacheKey(input, font)
  const cached = artworkCache.get(key)
  if (cached) {
    artworkCache.delete(key)
    artworkCache.set(key, cached)
    return cached
  }

  const separated = splitEmoji(input.text)
  const lines = wrappedLines(separated.text, input, font)
  const text = textMarkup(lines, input, font)
  const textBox = bboxFor(text, input, font)
  const content = `${emojiMarkup(separated.emojiPaths, textBox.y, input)}${text}`
  const contentBox = bboxFor(content, input, font)
  const scale = Math.min(
    1,
    contentBox.width > 0 ? (input.output.width - 2) / contentBox.width : 1,
    contentBox.height > 0 ? (input.output.height - 2) / contentBox.height : 1,
  )
  const scaledY = contentBox.y * scale
  const scaledHeight = contentBox.height * scale
  const desiredCenter = input.output.height * (input.textStyle.positionY / 100)
  const minTranslate = -scaledY
  const maxTranslate = input.output.height - scaledY - scaledHeight
  const centeredTranslate = desiredCenter - scaledY - scaledHeight / 2
  const translateY = Math.min(Math.max(centeredTranslate, minTranslate), Math.max(minTranslate, maxTranslate))
  const translateX = input.output.width / 2 - (input.output.width / 2) * scale
  const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${input.output.width}" height="${input.output.height}" viewBox="0 0 ${input.output.width} ${input.output.height}"><g transform="translate(${translateX} ${translateY}) scale(${scale})">${content}</g></svg>`
  const svg = new Resvg(rawSvg, fontOptions(font)).toString()
  return remember(key, {
    text: input.text,
    svg,
    width: input.output.width,
    height: input.output.height,
    lines,
  })
}

export function rasterizeCaptionArtwork(artwork: Pick<CaptionArtwork, 'svg'>): Buffer {
  return new Resvg(artwork.svg, {
    fitTo: { mode: 'original' },
    background: 'rgba(0,0,0,0)',
    imageRendering: 0,
  }).render().asPng()
}
