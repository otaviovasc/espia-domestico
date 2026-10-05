import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { injectable } from 'tsyringe'
import { AdAsset } from '@/database/models/AdAsset'
import type { AdRenderJob, AdRenderOutput } from '@/database/models/AdRenderJob'
import type { AdProjectConfig } from '@/dtos/adProject'
import { adMediaRoot, runProcess } from '@/services/AdMediaService'
import { sfxFilter } from '@/services/adTransitionSfx'
import { createCaptionArtwork, rasterizeCaptionArtwork } from '@/services/adCaptionArtwork'
import {
  buildGlowGraph,
  buildLinearVisualEffectFilter,
  hasVisualGlow,
} from '@/services/adVideoEffects'

const COLOR_FILTERS: Record<AdProjectConfig['colorPreset'], string> = {
  natural: 'eq=contrast=1.04:saturation=1.08:brightness=0.01',
  vibrant: 'eq=contrast=1.08:saturation=1.28:brightness=0.015',
  warm: 'eq=contrast=1.05:saturation=1.14:gamma_r=1.06:gamma_b=0.96',
  cool: 'eq=contrast=1.05:saturation=1.1:gamma_b=1.07:gamma_r=0.97',
  none: 'null',
}

function rotated<T>(values: T[], offset: number): T[] {
  if (!values.length) return []
  const normalized = offset % values.length
  return [...values.slice(normalized), ...values.slice(0, normalized)]
}

function ffconcatEscape(value: string): string {
  return value.replace(/'/g, "'\\''")
}

function fixedCuts(duration: number, seconds: number): number[] {
  const cuts = [0]
  for (let time = seconds; time < duration - 0.1; time += seconds) cuts.push(time)
  cuts.push(duration)
  return cuts
}

function cutsWithHook(config: AdProjectConfig, cuts: number[]): number[] {
  if (!config.hook?.enabled) return cuts
  const end = Math.min(config.output.durationSeconds, config.hook.durationSeconds)
  if (end >= config.output.durationSeconds - 0.1) return [0, config.output.durationSeconds]
  return [0, end, ...cuts.filter((cut) => cut > end + 0.1)]
}

type ClipEdit = AdProjectConfig['clipEdits'][string]

const DEFAULT_CLIP_EDIT: ClipEdit = {
  trimStart: 0,
  trimEnd: null,
  speed: 1,
  framingOverride: false,
  focusX: 50,
  focusY: 50,
  zoom: 1,
  volume: 1,
  motion: 'none',
}

function storedClipEdit(config: AdProjectConfig, assetId: number): ClipEdit | undefined {
  return config.clipEdits?.[String(assetId)]
}

function segmentVideoFilter(
  config: AdProjectConfig,
  edit: ClipEdit,
  hasPerClipFraming: boolean,
  sourceDuration: number,
  outputDuration: number,
): { filter: string; complex: boolean } {
  const { width, height, fps } = config.output
  const framing = config.framing ?? {
    mode: 'cover',
    focusX: 50,
    focusY: 50,
    backgroundColor: '#101018',
  }
  const focusX = hasPerClipFraming && edit.framingOverride ? edit.focusX : framing.focusX
  const focusY = hasPerClipFraming && edit.framingOverride ? edit.focusY : framing.focusY
  const zoom = hasPerClipFraming && edit.framingOverride ? edit.zoom : 1
  const targetWidth = Math.max(width, Math.round((width * zoom) / 2) * 2)
  const targetHeight = Math.max(height, Math.round((height * zoom) / 2) * 2)
  const effectiveDuration = sourceDuration / edit.speed
  // The loop filter buffers frames, so use it only for genuinely short selections.
  // Longer clips get a frozen final frame if their selected range is just shy of
  // the requested segment, avoiding unbounded memory use on high-resolution input.
  const shouldLoop = effectiveDuration + 0.05 < outputDuration && effectiveDuration <= 12
  const repeat = shouldLoop
    ? `fps=${fps},loop=loop=-1:size=${Math.max(1, Math.ceil(effectiveDuration * fps))}:start=0,setpts=N/${fps}/TB`
    : `tpad=stop_mode=clone:stop_duration=${outputDuration.toFixed(3)}`
  const timing = `trim=duration=${sourceDuration.toFixed(3)},setpts=(PTS-STARTPTS)/${edit.speed},${repeat},trim=duration=${outputDuration.toFixed(3)},setpts=PTS-STARTPTS`
  const motionFrames = Math.max(1, Math.round(outputDuration * fps))
  const motion =
    edit.motion && edit.motion !== 'none'
      ? `zoompan=z='${edit.motion === 'zoom-in' ? `1+0.12*on/${motionFrames}` : edit.motion === 'zoom-out' ? `1.12-0.12*on/${motionFrames}` : '1.12'}':x='${edit.motion === 'pan-left' ? `(iw-iw/zoom)*(1-on/${motionFrames})` : edit.motion === 'pan-right' ? `(iw-iw/zoom)*on/${motionFrames}` : `(iw-iw/zoom)*${focusX / 100}`}':y='(ih-ih/zoom)*${focusY / 100}':d=1:s=${width}x${height}:fps=${fps},`
      : ''
  const finish = `${motion}${COLOR_FILTERS[config.colorPreset]},${buildLinearVisualEffectFilter(config)},fps=${fps},setsar=1,format=yuv420p`
  const cover = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${width}:${height}:(in_w-out_w)*${focusX / 100}:(in_h-out_h)*${focusY / 100}`
  if (framing.mode === 'contain-solid') {
    const color = `0x${framing.backgroundColor.slice(1)}`
    return {
      filter: `${timing},scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,crop='min(iw,${width})':'min(ih,${height})':'max(0,(iw-ow)*${focusX / 100})':'max(0,(ih-oh)*${focusY / 100})',pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${color},${finish}`,
      complex: false,
    }
  }
  if (framing.mode === 'contain-blur') {
    return {
      filter: `[0:v]${timing},split=2[background][foreground];[background]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(in_w-out_w)*${focusX / 100}:(in_h-out_h)*${focusY / 100},gblur=sigma=28[blurred];[foreground]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,crop='min(iw,${width})':'min(ih,${height})':'max(0,(iw-ow)*${focusX / 100})':'max(0,(ih-oh)*${focusY / 100})'[sharp];[blurred][sharp]overlay=(W-w)/2:(H-h)/2,${finish}[vout]`,
      complex: true,
    }
  }
  return { filter: `${timing},${cover},${finish}`, complex: false }
}

const XFADE_TRANSITIONS: Record<Exclude<AdProjectConfig['transition']['preset'], 'cut'>, string> = {
  fade: 'fade',
  dissolve: 'dissolve',
  'slide-left': 'slideleft',
  'slide-up': 'slideup',
  zoom: 'zoomin',
}

function transitionSettings(config: AdProjectConfig): AdProjectConfig['transition'] {
  return (
    config.transition ?? {
      preset: 'cut',
      durationSeconds: 0.35,
      sfx: 'none',
      sfxVolume: 0.18,
    }
  )
}

async function joinSegments(
  segments: string[],
  cuts: number[],
  outputPath: string,
  transition: AdProjectConfig['transition'],
  fps: AdProjectConfig['output']['fps'],
  signal?: AbortSignal,
): Promise<void> {
  const args = ['-v', 'error', '-y']
  for (const segment of segments) args.push('-i', segment)
  const filters: string[] = []
  const segmentLabels = segments.map((_, index) => {
    const baseDuration = cuts[index + 1] - cuts[index]
    const transitionTail =
      transition.preset !== 'cut' && index < segments.length - 1 ? transition.durationSeconds : 0
    const expectedDuration = baseDuration + transitionTail
    const label = `seg${index}`
    // Separately encoded MP4 segments may carry a long final packet or a
    // discontinuous time base. Normalise every input before joining so one bad
    // segment cannot create a visible freeze at the next cut.
    filters.push(
      `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=clone:stop_duration=${expectedDuration.toFixed(3)},trim=duration=${expectedDuration.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},settb=AVTB[${label}]`,
    )
    return label
  })

  if (transition.preset === 'cut' || segments.length < 2) {
    filters.push(
      `${segmentLabels.map((label) => `[${label}]`).join('')}concat=n=${segments.length}:v=1:a=0[vout]`,
    )
  }

  let current = segmentLabels[0]
  for (let index = 1; index < segments.length; index += 1) {
    if (transition.preset === 'cut') break
    const next = index === segments.length - 1 ? 'vout' : `xf${index}`
    // FFmpeg 7.x clears frame-rate metadata on xfade output. Restore it
    // before feeding the next transition, using the same time base as inputs.
    filters.push(
      `[${current}][${segmentLabels[index]}]xfade=transition=${XFADE_TRANSITIONS[transition.preset]}:duration=${transition.durationSeconds.toFixed(3)}:offset=${cuts[index].toFixed(3)},fps=${fps},settb=AVTB[${next}]`,
    )
    current = next
  }
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vout]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-r',
    String(fps),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  )
  await runProcess('ffmpeg', args, { signal })
}

async function detectBeatCuts(
  musicPath: string,
  duration: number,
  sourceStart = 0,
  timelineStart = 0,
  timelineEnd = duration,
  signal?: AbortSignal,
): Promise<{ cuts: number[]; timingSource: 'beat' | 'fallback' }> {
  const trackDuration = Math.max(0.01, Math.min(duration, timelineEnd) - timelineStart)
  const pcm = await runProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-stream_loop',
      '-1',
      '-ss',
      sourceStart.toFixed(3),
      '-i',
      musicPath,
      '-t',
      String(trackDuration),
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      's16le',
      'pipe:1',
    ],
    { captureStdout: true, signal },
  )
  const samplesPerWindow = 400 // 50ms at 8kHz
  const energies: number[] = []
  for (
    let offset = 0;
    offset + samplesPerWindow * 2 <= pcm.length;
    offset += samplesPerWindow * 2
  ) {
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
    const time = timelineStart + i * 0.05
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
  return cuts.length >= 2 && filled.length >= 3
    ? { cuts: filled, timingSource: 'beat' }
    : { cuts: fixedCuts(duration, 2.5), timingSource: 'fallback' }
}

@injectable()
export class AdVideoRenderer {
  private async renderCarousel(
    job: AdRenderJob,
    assets: AdAsset[],
    onProgress: (progress: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<AdRenderOutput[]> {
    const config = job.configSnapshot
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const workRoot = path.join(adMediaRoot, '.work')
    await mkdir(workRoot, { recursive: true })
    const workDir = await mkdtemp(path.join(workRoot, `carousel-${job.id}-`))
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
    let completed = false
    try {
      for (const [index, slide] of config.carousel.slides.entries()) {
        signal?.throwIfAborted()
        const asset = byId.get(slide.assetId)
        if (!asset || (asset.kind !== 'image' && asset.kind !== 'clip'))
          throw new Error('Mídia do carrossel indisponível')
        const edit = { ...DEFAULT_CLIP_EDIT, ...slide.edit }
        const imageSource = asset.kind === 'image'
        const image = imageSource && edit.motion === 'none'
        const duration = image ? 1 / config.output.fps : slide.durationSeconds
        // The demuxer repeats video and audio together. Avoid the short-clip
        // frame buffer/frozen tail used by the video ad renderer.
        let inputPath = asset.storagePath
        if (!imageSource && (edit.trimStart > 0 || edit.trimEnd !== null)) {
          inputPath = path.join(workDir, `trim-${index}.mp4`)
          await runProcess(
            'ffmpeg',
            [
              '-v',
              'error',
              '-y',
              '-ss',
              String(edit.trimStart),
              '-i',
              asset.storagePath,
              '-t',
              String((edit.trimEnd ?? asset.durationSeconds) - edit.trimStart),
              '-map',
              '0:v:0',
              '-map',
              '0:a?',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-c:a',
              'aac',
              inputPath,
            ],
            { signal },
          )
        }
        let inputArgs = ['-loop', '1', '-framerate', String(config.output.fps)]
        if (!imageSource) {
          // A finite concat input avoids stream_loop stalls on trimmed files
          // with unequal audio/video start timestamps (FFmpeg 9).
          const sourceDuration = (edit.trimEnd ?? asset.durationSeconds) - edit.trimStart
          const repeats = Math.ceil((duration * edit.speed) / Math.max(0.25, sourceDuration)) + 1
          const concat = path.join(workDir, `repeat-${index}.ffconcat`)
          await writeFile(
            concat,
            `ffconcat version 1.0\n${Array.from({ length: repeats }, () => `file '${ffconcatEscape(inputPath)}'`).join('\n')}\n`,
          )
          inputPath = concat
          inputArgs = ['-f', 'concat', '-safe', '0']
        }
        const videoFilter = segmentVideoFilter(
          config,
          edit,
          Boolean(slide.edit),
          duration * edit.speed,
          duration,
        )
        const filters = [
          videoFilter.complex ? videoFilter.filter : `[0:v]${videoFilter.filter}[vout]`,
        ]
        let label = 'vout'
        if (hasVisualGlow(config)) {
          filters.push(buildGlowGraph(label, 'glowed', config, `carousel${index}`))
          label = 'glowed'
        }
        const args = ['-v', 'error', '-y', ...inputArgs, '-i', inputPath]
        if (slide.text) {
          const overlayPath = path.join(workDir, `caption-${index}.png`)
          await writeFile(
            overlayPath,
            rasterizeCaptionArtwork(
              createCaptionArtwork({
                text: slide.text,
                output: config.output,
                textStyle: slide.textStyle ?? config.textStyle,
              }),
            ),
          )
          args.push('-i', overlayPath)
          filters.push(`[${label}][1:v]overlay=eof_action=repeat:shortest=0[captioned]`)
          label = 'captioned'
        }
        const fileName = `slide-${String(index + 1).padStart(2, '0')}.${image ? 'jpg' : 'mp4'}`
        const storagePath = path.join(outputDir, fileName)
        args.push('-filter_complex', filters.join(';'), '-map', `[${label}]`)
        if (image) args.push('-frames:v', '1', '-an', '-q:v', '2', '-update', '1')
        else
          args.push(
            '-t',
            String(duration),
            ...(imageSource || edit.volume === 0
              ? ['-an']
              : [
                  '-map',
                  '0:a?',
                  '-af',
                  `volume=${edit.volume},atempo=${edit.speed}`,
                  '-c:a',
                  'aac',
                  '-b:a',
                  '192k',
                ]),
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
          )
        args.push(storagePath)
        await runProcess('ffmpeg', args, { signal })
        outputs.push({
          index,
          fileName,
          storagePath,
          mimeType: image ? 'image/jpeg' : 'video/mp4',
          sizeBytes: (await stat(storagePath)).size,
          durationSeconds: image ? 0 : duration,
          seed: `${job.id}:${index}`,
          cutTimes: image ? [] : [0, duration],
          timingSource: 'fixed',
          clipAssetIds: [asset.id],
          textOrder: slide.text ? [slide.text] : [],
        })
        await onProgress(Math.round(((index + 1) / config.carousel.slides.length) * 100))
      }
      completed = true
      return outputs
    } finally {
      await rm(workDir, { recursive: true, force: true })
      if (!completed) await rm(outputDir, { recursive: true, force: true })
    }
  }

  async getTiming(
    config: AdProjectConfig,
    music: AdAsset[],
    signal?: AbortSignal,
  ): Promise<{ cuts: number[]; timingSource: 'fixed' | 'beat' | 'fallback' }> {
    const duration = config.output.durationSeconds
    if (config.timing.mode === 'fixed') {
      return {
        cuts: cutsWithHook(config, fixedCuts(duration, config.timing.seconds)),
        timingSource: 'fixed',
      }
    }
    const configuredTracks = config.musicTracks?.length
      ? config.musicTracks
      : config.musicAssetId
        ? [
            {
              assetId: config.musicAssetId,
              volume: config.musicVolume ?? 0.8,
              startSeconds: 0,
              endSeconds: null,
              sourceStartSeconds: 0,
              fadeInSeconds: 0,
              fadeOutSeconds: 0.8,
            },
          ]
        : []
    const firstTrack = configuredTracks[0]
    const firstAsset = firstTrack
      ? music.find((asset) => asset.id === firstTrack.assetId)
      : undefined
    const timing =
      firstTrack && firstAsset
        ? await detectBeatCuts(
            firstAsset.storagePath,
            duration,
            firstTrack.sourceStartSeconds,
            firstTrack.startSeconds,
            firstTrack.endSeconds ?? duration,
            signal,
          )
        : { cuts: fixedCuts(duration, 2.5), timingSource: 'fallback' as const }
    return { ...timing, cuts: cutsWithHook(config, timing.cuts) }
  }

  async render(
    job: AdRenderJob,
    clips: AdAsset[],
    music: AdAsset[],
    onProgress: (progress: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<AdRenderOutput[]> {
    const config = job.configSnapshot
    if (config.kind === 'carousel') return await this.renderCarousel(job, clips, onProgress, signal)
    const duration = config.output.durationSeconds
    const musicById = new Map(music.map((asset) => [asset.id, asset]))
    const configuredTracks = config.musicTracks?.length
      ? config.musicTracks
      : config.musicAssetId
        ? [
            {
              assetId: config.musicAssetId,
              volume: config.musicVolume ?? 0.8,
              startSeconds: 0,
              endSeconds: null,
              sourceStartSeconds: 0,
              fadeInSeconds: 0,
              fadeOutSeconds: 0.8,
            },
          ]
        : []
    const musicTracks = configuredTracks
      .map((track) => ({ track, asset: musicById.get(track.assetId) }))
      .filter((item): item is { track: (typeof configuredTracks)[number]; asset: AdAsset } =>
        Boolean(item.asset),
      )
    const timing = await this.getTiming(config, music, signal)
    const cuts = timing.cuts
    const { timingSource } = timing
    const requestedTransition = transitionSettings(config)
    const shortestSegment = Math.min(...cuts.slice(1).map((cut, index) => cut - cuts[index]))
    const transition = {
      ...requestedTransition,
      durationSeconds: Math.min(
        requestedTransition.durationSeconds,
        Math.max(0.1, shortestSegment - 0.05),
      ),
    }
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
    const clipById = new Map(clips.map((clip) => [clip.id, clip]))
    const selectedClipOrder = config.selectedClipIds
      .map((id) => clipById.get(id))
      .filter((clip): clip is AdAsset => Boolean(clip))
    const hookClip = config.hook?.enabled
      ? clipById.get(config.hook.clipAssetId ?? config.selectedClipIds[0])
      : undefined
    const baseClipOrder = hookClip
      ? [hookClip, ...selectedClipOrder.filter((clip) => clip.id !== hookClip.id)]
      : selectedClipOrder
    const baseTextOrder = [...config.texts]
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
        // Rotate the first clip/text as a Cartesian sequence so requested
        // variants get visibly different combinations whenever possible.
        const clipOrder = hookClip
          ? [
              hookClip,
              ...rotated(baseClipOrder.slice(1), variation % Math.max(1, baseClipOrder.length - 1)),
            ]
          : rotated(baseClipOrder, variation % baseClipOrder.length)
        const textOrder = rotated(
          baseTextOrder,
          Math.floor(variation / baseClipOrder.length) % baseTextOrder.length,
        )
        const segments: string[] = []

        for (let index = 0; index < cuts.length - 1; index += 1) {
          const clip = clipOrder[index % clipOrder.length]
          const storedEdit = storedClipEdit(config, clip.id)
          const edit: ClipEdit =
            clip.kind === 'image'
              ? { ...(storedEdit ?? DEFAULT_CLIP_EDIT), speed: 1, trimStart: 0, trimEnd: null }
              : (storedEdit ?? DEFAULT_CLIP_EDIT)
          const baseDuration = cuts[index + 1] - cuts[index]
          const transitionTail =
            transition.preset !== 'cut' && index < cuts.length - 2 ? transition.durationSeconds : 0
          const segmentDuration = baseDuration + transitionTail
          const trimEnd =
            clip.kind === 'image'
              ? segmentDuration
              : Math.min(edit.trimEnd ?? clip.durationSeconds, clip.durationSeconds)
          const trimStart =
            clip.kind === 'image' ? 0 : Math.min(edit.trimStart, Math.max(0, trimEnd - 0.01))
          const availableSourceDuration = Math.max(0.01, trimEnd - trimStart)
          const requestedSourceDuration = segmentDuration * edit.speed
          const sourceDuration = Math.min(availableSourceDuration, requestedSourceDuration)
          const segmentPath = path.join(
            variationDir,
            `segment-${String(index).padStart(3, '0')}.mp4`,
          )
          const videoFilter = segmentVideoFilter(
            config,
            edit,
            Boolean(storedEdit),
            sourceDuration,
            segmentDuration,
          )
          await runProcess(
            'ffmpeg',
            [
              '-v',
              'error',
              '-y',
              ...(clip.kind === 'image'
                ? ['-loop', '1', '-framerate', String(config.output.fps)]
                : ['-ss', trimStart.toFixed(3)]),
              '-i',
              clip.storagePath,
              '-t',
              segmentDuration.toFixed(3),
              '-an',
              videoFilter.complex ? '-filter_complex' : '-vf',
              videoFilter.filter,
              ...(videoFilter.complex ? ['-map', '[vout]'] : []),
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-movflags',
              '+faststart',
              segmentPath,
            ],
            { signal },
          )
          segments.push(segmentPath)
          await advanceProgress()
        }

        const silentVideo = path.join(variationDir, 'silent.mp4')
        await joinSegments(segments, cuts, silentVideo, transition, config.output.fps, signal)
        await advanceProgress()

        const captionOverlays: Array<{ path: string; start: number; end: number }> = []
        for (let index = 0; index < cuts.length - 1; index += 1) {
          const displayedText =
            index === 0 && config.hook?.enabled && config.hook.text
              ? config.hook.text
              : textOrder[index % textOrder.length]
          signal?.throwIfAborted()
          const artwork = createCaptionArtwork({
            text: displayedText,
            output: config.output,
            textStyle: config.textStyle,
          })
          const overlayPath = path.join(
            variationDir,
            `caption-${String(index).padStart(3, '0')}.png`,
          )
          await writeFile(overlayPath, rasterizeCaptionArtwork(artwork))
          captionOverlays.push({ path: overlayPath, start: cuts[index], end: cuts[index + 1] })
        }

        const tempOutput = path.join(variationDir, 'output.mp4')
        const captionConcatPath = path.join(variationDir, 'captions.ffconcat')
        const captionConcatLines = ['ffconcat version 1.0']
        captionOverlays.forEach((overlay, index) => {
          captionConcatLines.push(`file '${ffconcatEscape(overlay.path)}'`, 'option framerate 1000')
          if (index < captionOverlays.length - 1) {
            captionConcatLines.push(`duration ${(overlay.end - overlay.start).toFixed(6)}`)
          }
        })
        await writeFile(captionConcatPath, `${captionConcatLines.join('\n')}\n`)
        const args = [
          '-v',
          'error',
          '-y',
          '-i',
          silentVideo,
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          captionConcatPath,
        ]
        const firstMusicInput = 2
        for (const { track, asset } of musicTracks) {
          args.push(
            '-stream_loop',
            '-1',
            '-ss',
            track.sourceStartSeconds.toFixed(3),
            '-i',
            asset.storagePath,
          )
        }
        let currentLabel = '0:v'
        const complexFilters: string[] = []
        if (hasVisualGlow(config)) {
          complexFilters.push(buildGlowGraph(currentLabel, 'glowed', config, `fx${variation}`))
          currentLabel = 'glowed'
        }
        complexFilters.push('[1:v]settb=AVTB,setpts=PTS-STARTPTS[captionstream]')
        complexFilters.push(
          `[${currentLabel}][captionstream]overlay=eof_action=repeat:shortest=0[captioned]`,
        )
        currentLabel = 'captioned'
        complexFilters.push(`[${currentLabel}]null[vout]`)
        const transitionTimes = cuts.slice(1, -1)
        const hasSfx = transition.sfx !== 'none' && transitionTimes.length > 0
        if (musicTracks.length || hasSfx) {
          const audioLabels: string[] = []
          musicTracks.forEach(({ track }, index) => {
            const trackEnd = Math.min(duration, track.endSeconds ?? duration)
            const trackDuration = Math.max(0.01, trackEnd - track.startSeconds)
            const fadeIn = Math.min(track.fadeInSeconds, trackDuration)
            const fadeOut = Math.min(track.fadeOutSeconds, trackDuration)
            const filters = [
              `atrim=duration=${trackDuration.toFixed(3)}`,
              'asetpts=PTS-STARTPTS',
              `volume=${track.volume.toFixed(3)}`,
            ]
            if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`)
            if (fadeOut > 0) {
              filters.push(
                `afade=t=out:st=${Math.max(0, trackDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
              )
            }
            filters.push(`adelay=${Math.round(track.startSeconds * 1000)}:all=1`)
            const label = `music${index}`
            complexFilters.push(`[${firstMusicInput + index}:a:0]${filters.join(',')}[${label}]`)
            audioLabels.push(`[${label}]`)
          })
          if (hasSfx) {
            transitionTimes.forEach((time, index) => {
              const label = `sfx${index}`
              complexFilters.push(sfxFilter(transition.sfx, transition.sfxVolume, time, label))
              audioLabels.push(`[${label}]`)
            })
          }
          if (audioLabels.length === 1) complexFilters.push(`${audioLabels[0]}anull[aout]`)
          else
            complexFilters.push(
              `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.92[aout]`,
            )
        }
        args.push(
          '-t',
          String(duration),
          '-filter_complex',
          complexFilters.join(';'),
          '-map',
          '[vout]',
        )
        if (musicTracks.length || hasSfx) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k')
        else args.push('-an')
        args.push(
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          tempOutput,
        )
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
