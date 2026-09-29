import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { injectable } from 'tsyringe'
import { Resvg } from '@resvg/resvg-js'
import { env } from '@/config/env'
import { AdAsset } from '@/database/models/AdAsset'
import type { AdRenderJob, AdRenderOutput } from '@/database/models/AdRenderJob'
import type { AdProjectConfig } from '@/dtos/adProject'
import { adMediaRoot, runProcess } from '@/services/AdMediaService'

const COLOR_FILTERS: Record<AdProjectConfig['colorPreset'], string> = {
  natural: 'eq=contrast=1.04:saturation=1.08:brightness=0.01',
  vibrant: 'eq=contrast=1.08:saturation=1.28:brightness=0.015',
  warm: 'eq=contrast=1.05:saturation=1.14:gamma_r=1.06:gamma_b=0.96',
  cool: 'eq=contrast=1.05:saturation=1.1:gamma_b=1.07:gamma_r=0.97',
  none: 'null',
}

function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0)
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function rotated<T>(values: T[], offset: number): T[] {
  if (!values.length) return []
  const normalized = offset % values.length
  return [...values.slice(normalized), ...values.slice(0, normalized)]
}

function filterEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

const TWEMOJI_DIR = path.dirname(require.resolve('@twemoji/svg/package.json'))
const EMOJI_PATTERN = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu

function twemojiPath(grapheme: string): string | null {
  const code = [...grapheme]
    .map((character) => character.codePointAt(0)!)
    .filter((point) => point !== 0xfe0f)
    .map((point) => point.toString(16))
    .join('-')
  const candidate = path.join(TWEMOJI_DIR, `${code}.svg`)
  return existsSync(candidate) ? candidate : null
}

function splitSupportedEmoji(value: string): { text: string; emojiPaths: string[] } {
  const emojiPaths: string[] = []
  let text = ''
  let offset = 0
  for (const match of value.matchAll(EMOJI_PATTERN)) {
    const index = match.index ?? 0
    text += value.slice(offset, index)
    const assetPath = twemojiPath(match[0])
    if (assetPath) emojiPaths.push(assetPath)
    else text += match[0]
    offset = index + match[0].length
  }
  text += value.slice(offset)
  return { text: text.replace(/\s{2,}/g, ' ').trim(), emojiPaths }
}

async function createEmojiOverlay(
  emojiPaths: string[],
  outputPath: string,
  config: AdProjectConfig,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const size = Math.round(config.textStyle.fontSize * 1.05)
  const gap = Math.round(size * 0.18)
  const totalWidth = emojiPaths.length * size + Math.max(0, emojiPaths.length - 1) * gap
  const startX = (config.output.width - totalWidth) / 2
  const centerY = config.output.height * (config.textStyle.positionY / 100)
  const y = Math.max(12, centerY - size * 1.55)
  const images: string[] = []
  for (let index = 0; index < emojiPaths.length; index += 1) {
    const svg = await readFile(emojiPaths[index])
    images.push(
      `<image x="${startX + index * (size + gap)}" y="${y}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${svg.toString('base64')}"/>`,
    )
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${config.output.width}" height="${config.output.height}">${images.join('')}</svg>`
  const png = new Resvg(svg, {
    fitTo: { mode: 'original' },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng()
  signal?.throwIfAborted()
  await writeFile(outputPath, png)
}

function ffconcatEscape(value: string): string {
  return value.replace(/'/g, "'\\''")
}

function wrapText(value: string, maxChars: number, maxLines = 3): string {
  const paragraphs = value.split(/\n/)
  const lines = paragraphs
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/)
      const lines: string[] = []
      let line = ''
      for (const word of words) {
        if (!line) line = word
        else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`
        else {
          lines.push(line)
          line = word
        }
      }
      if (line) lines.push(line)
      return lines.length ? lines : ['']
    })
  if (lines.length <= maxLines) return lines.join('\n')
  const visible = lines.slice(0, maxLines)
  visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
  return visible.join('\n')
}

function fixedCuts(duration: number, seconds: number): number[] {
  const cuts = [0]
  for (let time = seconds; time < duration - 0.1; time += seconds) cuts.push(time)
  cuts.push(duration)
  return cuts
}

function segmentVideoFilter(config: AdProjectConfig): { filter: string; complex: boolean } {
  const { width, height, fps } = config.output
  const framing = config.framing ?? {
    mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018',
  }
  const finish = `${COLOR_FILTERS[config.colorPreset]},fps=${fps},setsar=1,format=yuv420p`
  const cover = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(in_w-out_w)*${framing.focusX / 100}:(in_h-out_h)*${framing.focusY / 100}`
  if (framing.mode === 'contain-solid') {
    const color = `0x${framing.backgroundColor.slice(1)}`
    return {
      filter: `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${color},${finish}`,
      complex: false,
    }
  }
  if (framing.mode === 'contain-blur') {
    return {
      filter: `[0:v]split=2[background][foreground];[background]${cover},gblur=sigma=28[blurred];[foreground]scale=${width}:${height}:force_original_aspect_ratio=decrease[sharp];[blurred][sharp]overlay=(W-w)/2:(H-h)/2,${finish}[vout]`,
      complex: true,
    }
  }
  return { filter: `${cover},${finish}`, complex: false }
}

async function detectBeatCuts(
  musicPath: string,
  duration: number,
  signal?: AbortSignal,
): Promise<{ cuts: number[]; timingSource: 'beat' | 'fallback' }> {
  const pcm = await runProcess(
    'ffmpeg',
    ['-v', 'error', '-stream_loop', '-1', '-i', musicPath, '-t', String(duration), '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
    { captureStdout: true, signal },
  )
  const samplesPerWindow = 400 // 50ms at 8kHz
  const energies: number[] = []
  for (let offset = 0; offset + samplesPerWindow * 2 <= pcm.length; offset += samplesPerWindow * 2) {
    let sum = 0
    for (let i = 0; i < samplesPerWindow; i += 1) {
      const sample = pcm.readInt16LE(offset + i * 2) / 32768
      sum += sample * sample
    }
    energies.push(Math.sqrt(sum / samplesPerWindow))
  }
  if (energies.length < 3) return { cuts: fixedCuts(duration, 2.5), timingSource: 'fallback' }
  const sorted = [...energies].sort((a, b) => a - b)
  const threshold = sorted[Math.floor(sorted.length * 0.78)] ?? 0
  const cuts = [0]
  let last = 0
  for (let i = 1; i < energies.length - 1; i += 1) {
    const time = i * 0.05
    if (
      time - last >= 0.7 &&
      energies[i] >= threshold &&
      energies[i] > energies[i - 1] &&
      energies[i] >= energies[i + 1]
    ) {
      cuts.push(time)
      last = time
    }
  }
  const filled = [0]
  for (const cut of cuts.slice(1)) {
    while (cut - filled[filled.length - 1] > 4) filled.push(filled[filled.length - 1] + 2.5)
    filled.push(cut)
  }
  while (duration - filled[filled.length - 1] > 4) filled.push(filled[filled.length - 1] + 2.5)
  if (duration - filled[filled.length - 1] > 0.2) filled.push(duration)
  else filled[filled.length - 1] = duration
  return cuts.length >= 2
    ? { cuts: filled.length >= 3 ? filled : fixedCuts(duration, 2.5), timingSource: 'beat' }
    : { cuts: fixedCuts(duration, 2.5), timingSource: 'fallback' }
}

@injectable()
export class AdVideoRenderer {
  async render(
    job: AdRenderJob,
    clips: AdAsset[],
    music: AdAsset | null,
    onProgress: (progress: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<AdRenderOutput[]> {
    const config = job.configSnapshot
    const duration = config.output.durationSeconds
    const timing =
      config.timing.mode === 'beat' && music
        ? await detectBeatCuts(music.storagePath, duration, signal)
        : {
            cuts: fixedCuts(duration, config.timing.mode === 'fixed' ? config.timing.seconds : 2.5),
            timingSource: config.timing.mode === 'fixed' ? ('fixed' as const) : ('fallback' as const),
          }
    const { cuts, timingSource } = timing
    const workRoot = path.join(adMediaRoot, '.work')
    await mkdir(workRoot, { recursive: true })
    const workDir = await mkdtemp(path.join(workRoot, `ad-render-${job.id}-`))
    // Attempt-owned output prevents a cancelled/stale renderer from deleting a
    // replacement attempt's files during rolling deploys.
    const outputDir = path.join(
      adMediaRoot,
      'projects',
      String(job.projectId),
      'renders',
      String(job.id),
      randomUUID(),
    )
    await mkdir(outputDir, { recursive: true })
    const outputs: AdRenderOutput[] = []
    const baseClipOrder = shuffled(clips, seededRandom(`${job.id}:clips`))
    const baseTextOrder = shuffled(config.texts, seededRandom(`${job.id}:texts`))
    let completed = false
    const totalUnits = config.variationCount * (Math.max(1, cuts.length - 1) + 2)
    let completedUnits = 0
    let reportedProgress = 0
    const advanceProgress = async (): Promise<void> => {
      completedUnits += 1
      const progress = Math.min(100, Math.round((completedUnits / totalUnits) * 100))
      if (progress === 100 || progress >= reportedProgress + 2) {
        reportedProgress = progress
        await onProgress(progress)
      }
    }
    try {
      for (let variation = 0; variation < config.variationCount; variation += 1) {
        if (signal?.aborted) throw signal.reason
        const variationDir = path.join(workDir, String(variation))
        await mkdir(variationDir, { recursive: true })
        const seed = `${job.id}:${variation}`
        const random = seededRandom(seed)
        // Rotate the first clip/text as a Cartesian sequence so requested
        // variants get visibly different combinations whenever possible.
        const clipOrder = rotated(baseClipOrder, variation % baseClipOrder.length)
        const textOrder = rotated(
          baseTextOrder,
          Math.floor(variation / baseClipOrder.length) % baseTextOrder.length,
        )
        const segments: string[] = []

        for (let index = 0; index < cuts.length - 1; index += 1) {
          const clip = clipOrder[index % clipOrder.length]
          const segmentDuration = cuts[index + 1] - cuts[index]
          const maxStart = Math.max(0, clip.durationSeconds - segmentDuration)
          const start = maxStart > 0 ? random() * maxStart : 0
          const segmentPath = path.join(variationDir, `segment-${String(index).padStart(3, '0')}.mp4`)
            const videoFilter = segmentVideoFilter(config)
            await runProcess(
              'ffmpeg',
              [
                '-v', 'error', '-y', '-ss', start.toFixed(3), '-stream_loop', '-1', '-i', clip.storagePath,
                '-t', segmentDuration.toFixed(3), '-an', videoFilter.complex ? '-filter_complex' : '-vf', videoFilter.filter,
                ...(videoFilter.complex ? ['-map', '[vout]'] : []),
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', segmentPath,
            ],
            { signal },
          )
          segments.push(segmentPath)
          await advanceProgress()
        }

        const concatFile = path.join(variationDir, 'segments.ffconcat')
        await writeFile(concatFile, `ffconcat version 1.0\n${segments.map((item) => `file '${ffconcatEscape(item)}'`).join('\n')}\n`)
        const silentVideo = path.join(variationDir, 'silent.mp4')
        await runProcess('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', silentVideo], { signal })
        await advanceProgress()

        const drawFilters: string[] = []
        const emojiOverlays: Array<{ path: string; start: number; end: number }> = []
        for (let index = 0; index < cuts.length - 1; index += 1) {
          const textFile = path.join(variationDir, `text-${String(index).padStart(3, '0')}.txt`)
          const split = splitSupportedEmoji(textOrder[index % textOrder.length])
          const maxChars = Math.max(
            12,
            Math.min(30, Math.floor(config.output.width / (config.textStyle.fontSize * 0.55))),
          )
          await writeFile(textFile, wrapText(split.text, maxChars))
          if (split.emojiPaths.length) {
            const overlayPath = path.join(variationDir, `emoji-${String(index).padStart(3, '0')}.png`)
            await createEmojiOverlay(split.emojiPaths, overlayPath, config, signal)
            emojiOverlays.push({ path: overlayPath, start: cuts[index], end: cuts[index + 1] })
          }
          const font = env.AD_FONT_FILE
            ? `fontfile='${filterEscape(path.resolve(env.AD_FONT_FILE))}'`
            : `font='DejaVu Sans\\:style=Bold'`
          drawFilters.push(
            `drawtext=${font}:textfile='${filterEscape(textFile)}':expansion=none:fontsize=${config.textStyle.fontSize}:fontcolor=${config.textStyle.fontColor}:borderw=${config.textStyle.borderWidth}:bordercolor=${config.textStyle.borderColor}:line_spacing=12:x=(w-text_w)/2:y=(h-text_h)*${config.textStyle.positionY / 100}:enable='between(t,${cuts[index].toFixed(3)},${cuts[index + 1].toFixed(3)})'`,
          )
        }

        const tempOutput = path.join(variationDir, 'output.mp4')
        const args = ['-v', 'error', '-y', '-i', silentVideo]
        for (const overlay of emojiOverlays) args.push('-loop', '1', '-i', overlay.path)
        const musicInput = emojiOverlays.length + 1
        if (music) args.push('-stream_loop', '-1', '-i', music.storagePath)
        let currentLabel = '0:v'
        const complexFilters: string[] = []
        emojiOverlays.forEach((overlay, index) => {
          const nextLabel = `emoji${index}`
          complexFilters.push(
            `[${currentLabel}][${index + 1}:v]overlay=enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${nextLabel}]`,
          )
          currentLabel = nextLabel
        })
        complexFilters.push(`[${currentLabel}]${drawFilters.join(',')}[vout]`)
        args.push('-t', String(duration), '-filter_complex', complexFilters.join(';'), '-map', '[vout]')
        if (music) args.push('-map', `${musicInput}:a:0`, '-c:a', 'aac', '-b:a', '192k', '-af', 'afade=t=out:st=' + Math.max(0, duration - 0.8) + ':d=0.8')
        else args.push('-an')
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tempOutput)
        await runProcess('ffmpeg', args, { signal })

        const fileName = `variacao-${variation + 1}.mp4`
        const storagePath = path.join(outputDir, fileName)
        await rename(tempOutput, storagePath)
        const file = await stat(storagePath)
        outputs.push({
          index: variation,
          fileName,
          storagePath,
          sizeBytes: file.size,
          durationSeconds: duration,
          seed,
          cutTimes: cuts,
          timingSource,
          clipAssetIds: clipOrder.map((clip) => clip.id),
          textOrder,
        })
        await advanceProgress()
      }
      completed = true
      return outputs
    } finally {
      await rm(workDir, { recursive: true, force: true })
      if (!completed) await rm(outputDir, { recursive: true, force: true })
    }
  }
}
