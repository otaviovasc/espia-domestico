import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type SyntheticEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AudioLines,
  Check,
  CircleAlert,
  Clapperboard,
  Clock3,
    Copy,
    Crop,
    Download,
  Film,
    FolderOpen,
    Focus,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
    Save,
    Scissors,
    ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  adProjectApi,
  apiErrorMessage,
  getAuthToken,
  type AdAsset,
  type AdFramingMode,
  type AdMusicTrack,
  type AdProject,
  type AdProjectConfig,
  type AdRenderJob,
} from '@/lib/api'
import { Button, Input, Spinner } from '@/components/ui'
import ClipSequenceEditor from '@/components/ClipSequenceEditor'
import CreativeControls from '@/components/CreativeControls'
import EmojiPicker from '@/components/EmojiPicker'
import { DEFAULT_HOOK, DEFAULT_VISUAL_EFFECTS, normaliseCreativeConfig } from '@/lib/adCreativeConfig'
import { DEFAULT_TRANSITION, clipSequenceValidation, getAdClipEdit } from '@/lib/adClipConfig'
import { previewClipGeometry } from '@/lib/adPreviewFraming'
import {
  previewClipLoops,
  previewClipSourceTime,
  previewDissolveMaskDataUrl,
  previewTransitionFrame,
} from '@/lib/adPreviewParity'

const DEFAULT_CONFIG: AdProjectConfig = {
  variationCount: 5,
  texts: [
    'Sua casa merece esse achadinho ✨',
    'Eu não sabia que precisava disso 😍',
    'O preço que todo mundo estava esperando',
  ],
  selectedClipIds: [],
  clipEdits: {},
  musicAssetId: null,
  musicVolume: 0.8,
  musicTracks: [],
  timing: { mode: 'fixed', seconds: 2.5 },
  transition: DEFAULT_TRANSITION,
  output: { width: 1080, height: 1920, durationSeconds: 15, fps: 30 },
  framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018' },
  colorPreset: 'none',
  visualEffects: DEFAULT_VISUAL_EFFECTS,
  hook: DEFAULT_HOOK,
  textStyle: {
    fontSize: 92,
    positionY: 42,
    fontColor: '#FFFFFF',
    borderColor: '#111111',
    borderWidth: 7,
  },
}

type OutputPresetId = 'vertical' | 'vertical-hd' | 'feed-portrait' | 'feed-portrait-hd' | 'square'

const OUTPUT_PRESETS: Array<{
  id: OutputPresetId
  label: string
  placement: string
  ratio: string
  width: number
  height: number
}> = [
  { id: 'vertical', label: 'Reels e Stories', placement: 'Tela cheia', ratio: '9:16', width: 1080, height: 1920 },
  { id: 'vertical-hd', label: 'Reels em alta resolução', placement: 'Meta: 1440 × 2560', ratio: '9:16', width: 1440, height: 2560 },
  { id: 'feed-portrait', label: 'Feed vertical', placement: 'Mais área no feed', ratio: '4:5', width: 1080, height: 1350 },
  { id: 'feed-portrait-hd', label: 'Facebook Feed em alta resolução', placement: 'Meta: 1440 × 1800', ratio: '4:5', width: 1440, height: 1800 },
  { id: 'square', label: 'Feed quadrado', placement: 'Formato versátil', ratio: '1:1', width: 1080, height: 1080 },
]

const FRAMING_MODES: Array<{ id: AdFramingMode; label: string; description: string }> = [
  { id: 'cover', label: 'Preencher e cortar', description: 'Ocupa toda a tela; ajuste o foco para preservar o produto.' },
  { id: 'contain-blur', label: 'Inteiro com desfoque', description: 'Mostra o clipe completo sobre uma cópia desfocada.' },
  { id: 'contain-solid', label: 'Inteiro com fundo', description: 'Mostra o clipe completo sobre uma cor sólida.' },
]

const DEFAULT_FRAMING: AdProjectConfig['framing'] = {
  mode: 'cover',
  focusX: 50,
  focusY: 50,
  backgroundColor: '#101018',
}

function outputPresetFor(output: AdProjectConfig['output']) {
  return OUTPUT_PRESETS.find((preset) => preset.width === output.width && preset.height === output.height)
}

const STATUS_LABEL: Record<AdRenderJob['status'], string> = {
  queued: 'Na fila',
  running: 'Renderizando',
  completed: 'Pronto',
  failed: 'Falhou',
  cancelled: 'Cancelado',
}

const TIMING_SOURCE = {
  beat: { label: 'Cortes na batida', className: 'bg-violet-500/20 text-violet-100' },
  fixed: { label: 'Intervalo fixo', className: 'bg-white/10 text-white/65' },
  fallback: { label: 'Sem batidas · intervalo fixo', className: 'bg-amber-400/20 text-amber-100' },
} as const

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function duration(value: number | null): string {
  if (value === null) return 'analisando'
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60).toString().padStart(2, '0')
  return minutes > 0 ? `${minutes}:${seconds}` : `${seconds}s`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function playPreviewTransitionSfx(context: AudioContext, buffer: AudioBuffer, volume: number) {
  const source = context.createBufferSource()
  const gain = context.createGain()
  source.buffer = buffer
  gain.gain.value = Math.min(0.5, Math.max(0, volume)) / 0.5
  source.connect(gain)
  gain.connect(context.destination)
  source.onended = () => { source.disconnect(); gain.disconnect() }
  source.start()
}

function copyConfig(config: AdProjectConfig): AdProjectConfig {
  const normalized = normaliseCreativeConfig(config)
  return {
    ...normalized,
    musicVolume: normalized.musicVolume ?? 0.8,
    texts: [...normalized.texts],
    selectedClipIds: [...normalized.selectedClipIds],
    clipEdits: Object.fromEntries(
      Object.entries(normalized.clipEdits ?? {}).map(([assetId, edit]) => [assetId, { ...edit }]),
    ),
    musicTracks: normalized.musicTracks.map((track) => ({ ...track })),
    timing: { ...normalized.timing },
    transition: { ...DEFAULT_TRANSITION, ...(normalized.transition ?? {}) },
    output: { ...normalized.output },
    framing: { ...DEFAULT_FRAMING, ...(normalized.framing ?? {}) },
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS, ...normalized.visualEffects },
    hook: { ...DEFAULT_HOOK, ...normalized.hook },
    textStyle: { ...normalized.textStyle },
  }
}

type MediaBlobCacheEntry = {
  url: string | null
  sizeBytes: number
  error: boolean
  pending: Promise<void> | null
  lastUsedAt: number
}

const MEDIA_BLOB_CACHE_LIMIT = 12
const MEDIA_BLOB_CACHE_BYTES = 384 * 1024 * 1024
const mediaBlobCache = new Map<string, MediaBlobCacheEntry>()
const mediaBlobSubscribers = new Map<string, Set<() => void>>()
const mediaBlobRetryTokens = new Map<string, number>()
let mediaBlobRetrySequence = 0

function notifyMediaBlobSubscribers(requestKey: string) {
  mediaBlobSubscribers.get(requestKey)?.forEach((notify) => notify())
}

function pruneMediaBlobCache(protectedKey: string) {
  const cacheBytes = () => [...mediaBlobCache.values()].reduce((total, entry) => total + entry.sizeBytes, 0)
  if (mediaBlobCache.size <= MEDIA_BLOB_CACHE_LIMIT && cacheBytes() <= MEDIA_BLOB_CACHE_BYTES) return
  const candidates = [...mediaBlobCache.entries()]
    .filter(([key, entry]) => key !== protectedKey && !entry.pending && !mediaBlobSubscribers.get(key)?.size)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)
  while ((mediaBlobCache.size > MEDIA_BLOB_CACHE_LIMIT || cacheBytes() > MEDIA_BLOB_CACHE_BYTES) && candidates.length > 0) {
    const [key, entry] = candidates.shift()!
    if (entry.url) URL.revokeObjectURL(entry.url)
    mediaBlobCache.delete(key)
  }
}

function loadMediaBlob(requestKey: string, fetchBlob: () => Promise<Blob>): MediaBlobCacheEntry {
  const cached = mediaBlobCache.get(requestKey)
  if (cached && !cached.error) {
    cached.lastUsedAt = Date.now()
    return cached
  }
  if (cached?.url) URL.revokeObjectURL(cached.url)
  if (cached) mediaBlobCache.delete(requestKey)

  const entry: MediaBlobCacheEntry = {
    url: null,
    sizeBytes: 0,
    error: false,
    pending: null,
    lastUsedAt: Date.now(),
  }
  entry.pending = fetchBlob()
    .then((blob) => {
      entry.url = URL.createObjectURL(blob)
      entry.sizeBytes = blob.size
      entry.error = false
    })
    .catch(() => {
      entry.error = true
    })
    .finally(() => {
      entry.pending = null
      entry.lastUsedAt = Date.now()
      notifyMediaBlobSubscribers(requestKey)
      pruneMediaBlobCache(requestKey)
    })
  mediaBlobCache.set(requestKey, entry)
  return entry
}

function useMediaBlobUrl(
  requestKey: string,
  directUrl: string,
  fetchBlob: () => Promise<Blob>,
  enabled = true,
  retryToken = 0,
): { url: string | null; error: boolean } {
  const bearerAuth = Boolean(getAuthToken())
  const fetchBlobRef = useRef(fetchBlob)
  useEffect(() => {
    fetchBlobRef.current = fetchBlob
  }, [fetchBlob])
  const [, rerender] = useState(0)

  useEffect(() => {
    if (!bearerAuth || !enabled) return
    if (retryToken > 0 && mediaBlobRetryTokens.get(requestKey) !== retryToken) {
      mediaBlobRetryTokens.set(requestKey, retryToken)
      const cached = mediaBlobCache.get(requestKey)
      if (cached && !cached.pending) {
        if (cached.url) URL.revokeObjectURL(cached.url)
        mediaBlobCache.delete(requestKey)
      }
    }
    const notify = () => rerender((version) => version + 1)
    const subscribers = mediaBlobSubscribers.get(requestKey) ?? new Set<() => void>()
    subscribers.add(notify)
    mediaBlobSubscribers.set(requestKey, subscribers)
    loadMediaBlob(requestKey, () => fetchBlobRef.current())
    return () => {
      subscribers.delete(notify)
      if (subscribers.size === 0) mediaBlobSubscribers.delete(requestKey)
      pruneMediaBlobCache('')
    }
  }, [bearerAuth, enabled, requestKey, retryToken])

  const activeResult = bearerAuth && enabled ? mediaBlobCache.get(requestKey) : null
  return {
    url: enabled ? (bearerAuth ? activeResult?.url ?? null : directUrl) : null,
    error: activeResult?.error ?? false,
  }
}

function AssetRow({
  asset,
  ordinal,
  selected,
  onToggle,
  onRemove,
  removing,
}: {
  asset: AdAsset
  ordinal: number
  selected: boolean
  onToggle: () => void
  onRemove: () => void
  removing: boolean
}) {
  const prefix = asset.kind === 'clip' ? 'Clipe' : 'Música'
  const originalBase = asset.originalName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  const readableBase = originalBase
    .replace(/\b(?:[0-9a-f]{16,}|\d{10,})\b/gi, ' ')
    .replace(/\s+/g, ' ').trim()
  const opaque = !readableBase || /^(?:img|vid|mov|dsc|pxl|wa|clip|audio|music)\s*\d+$/i.test(readableBase)
    || (readableBase.length >= 24 && !/\s/.test(readableBase) && /\d/.test(readableBase))
  const label = `${prefix} ${ordinal}${opaque ? '' : ` · ${readableBase}`}`
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5">
      <div className="relative flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-950 text-white">
        {asset.kind === 'clip' ? <Film size={18} /> : <Music2 size={18} />}
      </div>
      <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-800" title={label}>
            {label}
        </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {duration(asset.durationSeconds)} · {bytes(asset.sizeBytes)}
            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${selected ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500 hover:bg-violet-50 hover:text-violet-700'}`}
      >
        {selected ? 'Usando' : 'Usar'}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
          aria-label={`Remover ${label}`}
        className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
      >
        {removing ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
      </button>
    </div>
  )
}

function UploadZone({
  kind,
  multiple,
  busy,
  onFiles,
}: {
  kind: 'clip' | 'music'
  multiple: boolean
  busy: boolean
  onFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const accept = kind === 'clip' ? 'video/mp4,video/quicktime,video/webm' : 'audio/mpeg,audio/mp4,audio/x-m4a,audio/m4a,audio/wav,audio/x-wav,audio/ogg,audio/flac'

  function receive(files: File[]) {
    const accepted = multiple ? files : files.slice(0, 1)
    if (accepted.length > 0) onFiles(accepted)
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    receive(Array.from(event.dataTransfer.files))
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          receive(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        disabled={busy}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm font-medium transition ${
          dragging
            ? 'border-violet-500 bg-violet-50 text-violet-700'
            : 'border-zinc-300 bg-zinc-50 text-zinc-600 hover:border-violet-400 hover:bg-violet-50/50'
        } disabled:cursor-wait disabled:opacity-60`}
      >
        {busy ? <LoaderCircle size={17} className="animate-spin" /> : <Upload size={17} />}
        {busy
          ? 'Enviando…'
          : kind === 'clip'
            ? 'Adicionar clipes'
            : 'Escolher trilha'}
      </button>
    </>
  )
}

function PreviewAudioTrack({
  projectId,
  asset,
  track,
  trackKey,
  active,
  elapsedSeconds,
  previewDuration,
  playing,
  timelineReady,
  muted,
  seekVersion,
  retryToken,
  onReady,
  onError,
}: {
  projectId: number
  asset: AdAsset
  track: AdMusicTrack
  trackKey: string
  active: boolean
  elapsedSeconds: number
  previewDuration: number
  playing: boolean
  timelineReady: boolean
  muted: boolean
  seekVersion: number
  retryToken: number
  onReady: (trackKey: string) => void
  onError: (trackKey: string) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const media = useMediaBlobUrl(
    `asset:${projectId}:${asset.id}`,
    adProjectApi.assetContentUrl(projectId, asset.id),
    () => adProjectApi.assetContent(projectId, asset.id),
    true,
    retryToken,
  )
  const timelineEnd = track.endSeconds ?? previewDuration
  const fadeIn = track.fadeInSeconds > 0
    ? Math.min(1, Math.max(0, (elapsedSeconds - track.startSeconds) / track.fadeInSeconds))
    : 1
  const fadeOut = track.fadeOutSeconds > 0
    ? Math.min(1, Math.max(0, (timelineEnd - elapsedSeconds) / track.fadeOutSeconds))
    : 1
  const volume = active ? Math.max(0, Math.min(1, track.volume * fadeIn * fadeOut)) : 0
  const sourceTime = track.sourceStartSeconds + Math.max(0, elapsedSeconds - track.startSeconds)
  const sourceTimeRef = useRef(sourceTime)

  useEffect(() => {
    sourceTimeRef.current = sourceTime
  }, [sourceTime])

  useEffect(() => {
    const element = audio.current
    if (!element) return
    element.volume = volume
    element.muted = muted
    if (Number.isFinite(element.duration) && element.duration > 0) {
      const expectedTime = sourceTimeRef.current % element.duration
      if (Math.abs(element.currentTime - expectedTime) > 0.15) element.currentTime = expectedTime
    }
    if (playing && timelineReady && active) void element.play().catch(() => undefined)
    else element.pause()
  }, [active, media.url, muted, playing, seekVersion, timelineReady, track.assetId, volume])

  useEffect(() => {
    if (media.error) onError(trackKey)
  }, [media.error, onError, trackKey])

  if (!media.url) return null
  return (
    <audio
      key={retryToken}
      ref={audio}
      src={media.url}
      loop
      preload="auto"
      className="ad-preview-audio sr-only"
      data-preview-audio-active={active ? 'true' : 'false'}
      data-preview-timeline-ready={timelineReady ? 'true' : 'false'}
      onCanPlay={() => onReady(trackKey)}
      onError={() => onError(trackKey)}
      onLoadedMetadata={(event) => {
        if (event.currentTarget.duration > 0) event.currentTarget.currentTime = sourceTime % event.currentTarget.duration
      }}
    />
  )
}

function useDebouncedPreviewInput(value: string): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), 120)
    return () => window.clearTimeout(timer)
  }, [value])
  return settled
}

function PhonePreview({ project, config, onExactPreview, exactPreviewPending, canRenderExact }: {
  project: AdProject
  config: AdProjectConfig
  onExactPreview: () => void
  exactPreviewPending: boolean
  canRenderExact: boolean
}) {
  const clipAssets = (project.assets ?? []).filter((asset) => asset.kind === 'clip')
  const clips = config.selectedClipIds
    .map((assetId) => clipAssets.find((asset) => asset.id === assetId))
    .filter((asset): asset is AdAsset => Boolean(asset))
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [muted, setMuted] = useState(true)
  const [seekVersion, setSeekVersion] = useState(0)
  const [showSafeZone, setShowSafeZone] = useState(true)
  const [showPlacementChrome, setShowPlacementChrome] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [readyAudioKeys, setReadyAudioKeys] = useState<Set<string>>(() => new Set())
  const [failedAudioKeys, setFailedAudioKeys] = useState<Set<string>>(() => new Set())
  const [audioRetryToken, setAudioRetryToken] = useState(0)
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false)
  const [activeLayerReadyKey, setActiveLayerReadyKey] = useState<string | null>(null)
  const [outgoingLayerReadyKey, setOutgoingLayerReadyKey] = useState<string | null>(null)
  const [skippedTransitionKey, setSkippedTransitionKey] = useState<string | null>(null)
  const foregroundVideo = useRef<HTMLVideoElement>(null)
  const backgroundVideo = useRef<HTMLVideoElement>(null)
  const outgoingForegroundVideo = useRef<HTMLVideoElement>(null)
  const outgoingBackgroundVideo = useRef<HTMLVideoElement>(null)
  const previewPanel = useRef<HTMLElement>(null)
  const previewAudioContext = useRef<AudioContext | null>(null)
  const playedTransitionSfxKey = useRef<string | null>(null)
  const lastPreviewTickAt = useRef<number | null>(null)
  const audioActionVersion = useRef(0)
  const elapsedSecondsRef = useRef(0)
  const ensurePreviewAudioContext = useCallback(() => {
    if (previewAudioContext.current) return previewAudioContext.current
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & {
      webkitAudioContext?: typeof AudioContext
    }).webkitAudioContext
    if (!AudioContextConstructor) return null
    previewAudioContext.current = new AudioContextConstructor()
    return previewAudioContext.current
  }, [])
  const markAudioReady = useCallback((trackKey: string) => {
    setReadyAudioKeys((current) => {
      if (current.has(trackKey)) return current
      const next = new Set(current)
      next.add(trackKey)
      return next
    })
    setFailedAudioKeys((current) => {
      if (!current.has(trackKey)) return current
      const next = new Set(current)
      next.delete(trackKey)
      return next
    })
  }, [setFailedAudioKeys, setReadyAudioKeys])
  const markAudioFailed = useCallback((trackKey: string) => {
    setFailedAudioKeys((current) => {
      if (current.has(trackKey)) return current
      const next = new Set(current)
      next.add(trackKey)
      return next
    })
    setReadyAudioKeys((current) => {
      if (!current.has(trackKey)) return current
      const next = new Set(current)
      next.delete(trackKey)
      return next
    })
  }, [setFailedAudioKeys, setReadyAudioKeys])
  const beatAssetId = config.musicTracks?.[0]?.assetId ?? config.musicAssetId
  const hasBeatMusic = Boolean(beatAssetId && project.assets?.some((asset) => asset.kind === 'music' && asset.id === beatAssetId))
  const beatTiming = useQuery({
    queryKey: ['ad-preview-timing', project.id, config.timing, config.musicTracks, config.musicAssetId,
      config.output.durationSeconds, config.hook?.enabled, config.hook?.durationSeconds, config.selectedClipIds],
    queryFn: ({ signal }) => adProjectApi.previewTiming(project.id, config, signal),
    enabled: config.timing.mode === 'beat' && hasBeatMusic,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const timingReady = config.timing.mode !== 'beat' || !hasBeatMusic || Boolean(beatTiming.data) || beatTiming.isError
  const previewSeconds = Math.max(0.5, config.timing.mode === 'fixed' ? config.timing.seconds : 2.5)
  const previewDuration = Math.max(1, config.output.durationSeconds)
  const previewElapsed = Math.min(elapsedSeconds, Math.max(0, previewDuration - 0.01))
  const hookConfig = { ...DEFAULT_CONFIG.hook, ...(config.hook ?? {}) }
  const hookClip = hookConfig.enabled
    ? clipAssets.find((asset) => asset.id === hookConfig.clipAssetId) ?? clips[0]
    : undefined
  const hookDuration = hookClip ? Math.min(previewDuration, hookConfig.durationSeconds) : 0
  const baseCuts = [0]
  for (let time = previewSeconds; time < previewDuration - 0.1; time += previewSeconds) baseCuts.push(time)
  baseCuts.push(previewDuration)
  const previewCuts = config.timing.mode === 'beat' && hasBeatMusic && beatTiming.data
    ? beatTiming.data.cuts
    : hookClip && hookDuration < previewDuration - 0.1
    ? [0, hookDuration, ...baseCuts.filter((cut) => cut > hookDuration + 0.1)]
    : hookClip
      ? [0, previewDuration]
      : baseCuts
  const foundSegmentIndex = previewCuts.findIndex((cut, index) => (
    index < previewCuts.length - 1 && previewElapsed >= cut && previewElapsed < previewCuts[index + 1]
  ))
  const segmentIndex = Math.max(0, foundSegmentIndex)
  const clipOrder = hookClip
    ? [hookClip, ...clips.filter((clip) => clip.id !== hookClip.id)]
    : clips
  const clipIndex = clipOrder.length > 0 ? segmentIndex % clipOrder.length : 0
  const textIndex = config.texts.length > 0 ? segmentIndex % config.texts.length : 0
  const activeClip = clipOrder[clipIndex]
  const selectedClipIndex = clips.findIndex((clip) => clip.id === activeClip?.id)
  const hookActive = Boolean(hookClip && segmentIndex === 0)
  const rawActiveText = hookActive && hookConfig.text.trim() ? hookConfig.text : config.texts[textIndex] ?? ''
  const captionTexts = [...new Set([...config.texts, ...(hookConfig.enabled && hookConfig.text.trim() ? [hookConfig.text] : [])])].filter((text) => text.trim())
  const captionInput = JSON.stringify({
    texts: captionTexts,
    output: { width: config.output.width, height: config.output.height },
    textStyle: config.textStyle,
  })
  const settledCaptionInput = useDebouncedPreviewInput(captionInput)
  const captions = useQuery({
    queryKey: ['ad-caption-artwork', settledCaptionInput],
    queryFn: async ({ signal }) => {
      const input = JSON.parse(settledCaptionInput) as {
        texts: string[]
        output: Pick<AdProjectConfig['output'], 'width' | 'height'>
        textStyle: AdProjectConfig['textStyle']
      }
      const batches: string[][] = []
      for (let index = 0; index < input.texts.length; index += 30) batches.push(input.texts.slice(index, index + 30))
      const artwork = await Promise.all(batches.map((texts) => adProjectApi.previewCaptions({ ...input, texts }, signal)))
      return new Map(artwork.flat().map(({ text, svg }) => [text, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`]))
    },
    enabled: captionTexts.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const captionArtwork = captions.data?.get(rawActiveText)
  const activeEdit = activeClip ? getAdClipEdit(config, activeClip.id) : undefined
  const clipFocusX = activeEdit?.framingOverride ? activeEdit.focusX : config.framing?.focusX ?? DEFAULT_FRAMING.focusX
  const clipFocusY = activeEdit?.framingOverride ? activeEdit.focusY : config.framing?.focusY ?? DEFAULT_FRAMING.focusY
  const clipZoom = activeEdit?.framingOverride ? activeEdit.zoom : 1
  const clipSpeed = activeEdit?.speed ?? 1
  const trimStart = activeEdit?.trimStart ?? 0
  const trimEnd = activeEdit?.trimEnd ?? activeClip?.durationSeconds ?? null
  const transition = { ...DEFAULT_TRANSITION, ...(config.transition ?? {}) }
  const shortestPreviewSegment = Math.min(
    ...previewCuts.slice(1).map((cut, index) => cut - previewCuts[index]),
  )
  // Keep the browser preview on the same overlap window used by the FFmpeg renderer.
  const transitionDuration = transition.preset === 'cut'
    ? 0
    : Math.min(transition.durationSeconds, Math.max(0.1, shortestPreviewSegment - 0.05))
  const segmentStart = previewCuts[segmentIndex] ?? 0
  const transitionElapsed = Math.max(0, previewElapsed - segmentStart)
  const transitionActive = segmentIndex > 0 && transitionDuration > 0 && transitionElapsed < transitionDuration
  const transitionProgress = transitionActive && transitionDuration > 0
    ? Math.min(1, transitionElapsed / transitionDuration)
    : 1
  const segmentBaseDuration = Math.max(0.01, (previewCuts[segmentIndex + 1] ?? previewDuration) - segmentStart)
  const segmentOutputDuration = segmentBaseDuration + (
    transition.preset !== 'cut' && segmentIndex < previewCuts.length - 2 ? transitionDuration : 0
  )
  const activeSourceEnd = trimEnd ?? activeClip?.durationSeconds ?? trimStart + 0.01
  const activeSourceTime = previewClipSourceTime(
    trimStart,
    activeSourceEnd,
    clipSpeed,
    transitionElapsed,
    segmentOutputDuration,
  )
  const previousClip = segmentIndex > 0 && clipOrder.length > 0
    ? clipOrder[(segmentIndex - 1) % clipOrder.length]
    : null
  const previousEdit = previousClip ? getAdClipEdit(config, previousClip.id) : undefined
  const previousFocusX = previousEdit?.framingOverride ? previousEdit.focusX : config.framing?.focusX ?? DEFAULT_FRAMING.focusX
  const previousFocusY = previousEdit?.framingOverride ? previousEdit.focusY : config.framing?.focusY ?? DEFAULT_FRAMING.focusY
  const previousZoom = previousEdit?.framingOverride ? previousEdit.zoom : 1
  const previousSpeed = previousEdit?.speed ?? 1
  const previousTrimStart = previousEdit?.trimStart ?? 0
  const previousTrimEnd = previousEdit?.trimEnd ?? previousClip?.durationSeconds ?? null
  const previousSegmentDuration = segmentIndex > 0
    ? previewCuts[segmentIndex] - previewCuts[segmentIndex - 1]
    : 0
  const previousSourceDuration = previousTrimEnd === null
    ? Math.max(0.01, previousClip?.durationSeconds ?? 0.01)
    : Math.max(0.01, previousTrimEnd - previousTrimStart)
  const previousOutputDuration = previousSegmentDuration + transitionDuration
  const previousSourceTime = previewClipSourceTime(
    previousTrimStart,
    previousTrimStart + previousSourceDuration,
    previousSpeed,
    previousSegmentDuration + transitionElapsed,
    previousOutputDuration,
  )
  const media = useMediaBlobUrl(
    `asset:${project.id}:${activeClip?.id ?? 'none'}`,
    activeClip ? adProjectApi.assetContentUrl(project.id, activeClip.id) : '',
    () => adProjectApi.assetContent(project.id, activeClip!.id),
    Boolean(activeClip),
  )
  const previousMedia = useMediaBlobUrl(
    `asset:${project.id}:${previousClip?.id ?? 'none'}`,
    previousClip ? adProjectApi.assetContentUrl(project.id, previousClip.id) : '',
    () => adProjectApi.assetContent(project.id, previousClip!.id),
    Boolean(previousClip),
  )
  const nextClip = clipOrder.length > 1 ? clipOrder[(clipIndex + 1) % clipOrder.length] : null
  const nextMedia = useMediaBlobUrl(
    `asset:${project.id}:${nextClip?.id ?? 'none'}`,
    nextClip ? adProjectApi.assetContentUrl(project.id, nextClip.id) : '',
    () => adProjectApi.assetContent(project.id, nextClip!.id),
    Boolean(nextClip),
  )
  const followingClip = clipOrder.length > 2 ? clipOrder[(clipIndex + 2) % clipOrder.length] : null
  const followingMedia = useMediaBlobUrl(
    `asset:${project.id}:${followingClip?.id ?? 'none'}`,
    followingClip ? adProjectApi.assetContentUrl(project.id, followingClip.id) : '',
    () => adProjectApi.assetContent(project.id, followingClip!.id),
    Boolean(followingClip),
  )
  const activeLayerKey = activeClip && media.url ? media.url : null
  const transitionLayerKey = previousClip ? `${seekVersion}:${segmentIndex}:${previousClip.id}` : null
  const preparedOutgoingClip = transitionActive ? previousClip : activeClip
  const preparedOutgoingUrl = transitionActive ? previousMedia.url : media.url
  const preparedOutgoingFocusX = transitionActive ? previousFocusX : clipFocusX
  const preparedOutgoingFocusY = transitionActive ? previousFocusY : clipFocusY
  const preparedOutgoingZoom = transitionActive ? previousZoom : clipZoom
  const preparedOutgoingSpeed = transitionActive ? previousSpeed : clipSpeed
  const preparedOutgoingTrimStart = transitionActive ? previousTrimStart : trimStart
  const preparedOutgoingTrimEnd = transitionActive ? previousTrimEnd : trimEnd
  const preparedOutgoingSourceTime = transitionActive ? previousSourceTime : activeSourceTime
  const activeSourceTimeRef = useRef(activeSourceTime)
  const preparedOutgoingSourceTimeRef = useRef(preparedOutgoingSourceTime)
  const activeClipReady = Boolean(activeLayerKey && activeLayerReadyKey === activeLayerKey)
  const outgoingLayerReady = Boolean(previousMedia.url && outgoingLayerReadyKey === previousMedia.url)
  const transitionSkipped = Boolean(transitionLayerKey && skippedTransitionKey === transitionLayerKey)
  const transitionLayersReady = !transitionActive || outgoingLayerReady || transitionSkipped
  const renderedTransitionActive = transitionActive && activeClipReady && outgoingLayerReady && !transitionSkipped
  const transitionFrame = transitionActive
    ? previewTransitionFrame(transition.preset, transitionProgress, renderedTransitionActive)
    : previewTransitionFrame('cut', 1, true)
  const dissolveMaskUrl = transitionActive && renderedTransitionActive && transition.preset === 'dissolve'
    ? previewDissolveMaskDataUrl(config.output.width, config.output.height, transitionProgress)
    : null
  const configuredMusicTracks = config.musicTracks ?? []
  const timelineMusicTracks: AdMusicTrack[] = configuredMusicTracks.length > 0
    ? configuredMusicTracks
    : config.musicAssetId
      ? [{
          assetId: config.musicAssetId,
          volume: config.musicVolume ?? 0.8,
          startSeconds: 0,
          endSeconds: null,
          sourceStartSeconds: 0,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
        }]
      : []
  const activeMusicTracks = timelineMusicTracks.filter((track) => (
    previewElapsed >= track.startSeconds &&
    previewElapsed < (track.endSeconds ?? previewDuration)
  ))
  const musicAssetsById = new Map(
    (project.assets ?? []).filter((asset) => asset.kind === 'music').map((asset) => [asset.id, asset]),
  )
  const requiredAudioTrackKeys = timelineMusicTracks.flatMap((track, index) => (
    musicAssetsById.has(track.assetId) ? [`${track.assetId}:${index}`] : []
  ))
  const hasMusic = requiredAudioTrackKeys.length > 0
  const audioReady = hasMusic && requiredAudioTrackKeys.every((key) => readyAudioKeys.has(key))
  const audioFailed = requiredAudioTrackKeys.some((key) => failedAudioKeys.has(key))
  const hasTransitionSfx = transition.sfx !== 'none' && previewCuts.length > 2
  const hasPreviewSound = hasMusic || hasTransitionSfx
  const sfxAudio = useQuery({
    queryKey: ['ad-preview-sfx', transition.sfx],
    queryFn: async () => {
      const context = ensurePreviewAudioContext()
      if (!context) throw new Error('Áudio não disponível neste navegador')
      const audio = await adProjectApi.previewSfx(transition.sfx as 'whoosh' | 'pop' | 'click')
      return await context.decodeAudioData(audio)
    },
    enabled: hasTransitionSfx,
    staleTime: Infinity,
  })
  const sfxBuffer = sfxAudio.data
  const sfxFailed = hasTransitionSfx && sfxAudio.isError
  const previewSoundReady = (hasTransitionSfx && Boolean(sfxBuffer)) || audioReady

  useEffect(() => {
    activeSourceTimeRef.current = activeSourceTime
    preparedOutgoingSourceTimeRef.current = preparedOutgoingSourceTime
  }, [activeSourceTime, preparedOutgoingSourceTime])

  useEffect(() => {
    if (!playing || !activeClipReady || !transitionLayersReady || !timingReady) return undefined
    lastPreviewTickAt.current = performance.now()
    const interval = window.setInterval(() => {
      const tickedAt = performance.now()
      const elapsedSinceTick = Math.min(0.2, Math.max(0, (tickedAt - (lastPreviewTickAt.current ?? tickedAt)) / 1000))
      lastPreviewTickAt.current = tickedAt
      const current = elapsedSecondsRef.current
      const next = (Math.min(current, previewDuration - 0.01) + elapsedSinceTick) % previewDuration
      elapsedSecondsRef.current = next
      setElapsedSeconds(next)
      if (next < current) setSeekVersion((version) => version + 1)
    }, 50)
    return () => {
      lastPreviewTickAt.current = null
      window.clearInterval(interval)
    }
  }, [activeClipReady, playing, previewDuration, timingReady, transitionLayersReady])

  useEffect(() => {
    const videos = [foregroundVideo.current, backgroundVideo.current].filter((video): video is HTMLVideoElement => Boolean(video))
    for (const video of videos) {
      video.playbackRate = clipSpeed
      const sourceTime = activeSourceTimeRef.current
      if (Math.abs(video.currentTime - sourceTime) > 0.15) video.currentTime = sourceTime
      if (playing && activeClipReady && transitionLayersReady && timingReady) void video.play().catch(() => undefined)
      else video.pause()
    }
  }, [activeClipReady, activeSourceEnd, clipSpeed, hookActive, media.url, playing, seekVersion, segmentIndex, segmentOutputDuration, timingReady, transitionLayersReady, trimEnd, trimStart])

  useEffect(() => {
    if (!preparedOutgoingClip || !preparedOutgoingUrl) return
    const videos = [outgoingForegroundVideo.current, outgoingBackgroundVideo.current]
      .filter((video): video is HTMLVideoElement => Boolean(video))
    for (const video of videos) {
      video.playbackRate = preparedOutgoingSpeed
      const sourceTime = preparedOutgoingSourceTimeRef.current
      if (Math.abs(video.currentTime - sourceTime) > 0.15) video.currentTime = sourceTime
      if (playing && activeClipReady && transitionLayersReady && timingReady) void video.play().catch(() => undefined)
      else video.pause()
    }
  }, [activeClipReady, playing, preparedOutgoingClip, preparedOutgoingSpeed, preparedOutgoingTrimEnd, preparedOutgoingTrimStart, preparedOutgoingUrl, previousOutputDuration, seekVersion, segmentIndex, timingReady, transitionLayersReady])

  useEffect(() => () => {
    void previewAudioContext.current?.close()
    previewAudioContext.current = null
  }, [])

  useEffect(() => {
    const atCut = segmentIndex > 0 && transitionElapsed < 0.35
    const cutReady = transition.preset === 'cut' && activeClipReady && atCut
    if (!playing || muted || !hasTransitionSfx || !sfxBuffer || !(cutReady || renderedTransitionActive)) return
    const transitionKey = `${seekVersion}:${segmentIndex}`
    if (playedTransitionSfxKey.current === transitionKey) return
    const context = ensurePreviewAudioContext()
    if (!context || context.state !== 'running') return
    playedTransitionSfxKey.current = transitionKey
    playPreviewTransitionSfx(context, sfxBuffer, transition.sfxVolume)
  }, [activeClipReady, ensurePreviewAudioContext, hasTransitionSfx, muted, playing, renderedTransitionActive, seekVersion, segmentIndex, sfxBuffer, transition.preset, transition.sfxVolume, transitionElapsed])

  function keepWithinTrim(event: SyntheticEvent<HTMLVideoElement>) {
    if (event.currentTarget.currentTime < activeSourceEnd - 0.01) return
    event.currentTarget.currentTime = previewClipSourceTime(
      trimStart,
      activeSourceEnd,
      clipSpeed,
      transitionElapsed,
      segmentOutputDuration,
    )
    if (!previewClipLoops(trimStart, activeSourceEnd, clipSpeed, segmentOutputDuration)) {
      event.currentTarget.pause()
    }
  }

  function keepOutgoingWithinTrim(event: SyntheticEvent<HTMLVideoElement>) {
    const sourceEnd = preparedOutgoingTrimEnd ?? preparedOutgoingClip?.durationSeconds ?? preparedOutgoingTrimStart + 0.01
    if (event.currentTarget.currentTime < sourceEnd - 0.01) return
    event.currentTarget.currentTime = preparedOutgoingSourceTimeRef.current
    const outputDuration = transitionActive ? previousOutputDuration : segmentOutputDuration
    if (!previewClipLoops(preparedOutgoingTrimStart, sourceEnd, preparedOutgoingSpeed, outputDuration)) {
      event.currentTarget.pause()
    }
  }

  function seekPreview(nextSeconds: number) {
    const next = Math.max(0, Math.min(previewDuration - 0.01, nextSeconds))
    const nextFoundSegmentIndex = previewCuts.findIndex((cut, index) => (
      index < previewCuts.length - 1 && next >= cut && next < previewCuts[index + 1]
    ))
    const nextSegmentIndex = Math.max(0, nextFoundSegmentIndex)
    const nextPreviousClip = nextSegmentIndex > 0 && clipOrder.length > 0
      ? clipOrder[(nextSegmentIndex - 1) % clipOrder.length]
      : null
    const nextSeekVersion = seekVersion + 1
    elapsedSecondsRef.current = next
    setOutgoingLayerReadyKey(null)
    setElapsedSeconds(next)
    setSkippedTransitionKey(nextPreviousClip ? `${nextSeekVersion}:${nextSegmentIndex}:${nextPreviousClip.id}` : null)
    setSeekVersion(nextSeekVersion)
  }

  function seekToClip(assetId: number) {
    const targetSegment = previewCuts.slice(0, -1).findIndex((_, index) => (
      clipOrder[index % Math.max(1, clipOrder.length)]?.id === assetId && !(hookClip && index === 0)
    ))
    seekPreview(targetSegment >= 0 ? previewCuts[targetSegment] : 0)
  }

  function playPreviewAudioFromGesture() {
    const actionVersion = ++audioActionVersion.current
    const audioElements = Array.from(previewPanel.current?.querySelectorAll<HTMLAudioElement>('.ad-preview-audio') ?? [])
    setAudioPlaybackBlocked(false)
    const attempts: Promise<unknown>[] = audioElements.map((audio) => {
      audio.muted = false
      return audio.dataset.previewAudioActive === 'true' && audio.dataset.previewTimelineReady === 'true'
        ? audio.play()
        : Promise.resolve()
    })
    const context = ensurePreviewAudioContext()
    if (context) attempts.push(context.resume())
    if (attempts.length === 0) return
    void Promise.allSettled(attempts).then((results) => {
      if (audioActionVersion.current !== actionVersion) return
      if (results.every((result) => result.status === 'rejected')) {
        setAudioPlaybackBlocked(true)
        setMuted(true)
        audioElements.forEach((audio) => { audio.muted = true })
      }
    })
  }

  function togglePreviewSound() {
    if (!hasPreviewSound || !previewSoundReady) return
    if (!muted) {
      audioActionVersion.current += 1
      setMuted(true)
      setAudioPlaybackBlocked(false)
      previewPanel.current?.querySelectorAll<HTMLAudioElement>('.ad-preview-audio').forEach((audio) => { audio.muted = true })
      return
    }
    setMuted(false)
    setPlaying(true)
    playPreviewAudioFromGesture()
  }

  function retryPreviewAudio() {
    audioActionVersion.current += 1
    setMuted(true)
    setAudioPlaybackBlocked(false)
    setFailedAudioKeys(new Set())
    setReadyAudioKeys(new Set())
    mediaBlobRetrySequence += 1
    setAudioRetryToken(mediaBlobRetrySequence)
  }

  function togglePreviewPlayback() {
    if (playing) {
      setPlaying(false)
      previewPanel.current?.querySelectorAll<HTMLAudioElement>('.ad-preview-audio').forEach((audio) => audio.pause())
      return
    }
    setPlaying(true)
    if (!muted && audioReady) playPreviewAudioFromGesture()
  }

  const legacyFilter = {
    natural: 'saturate(1.05) contrast(1.04)',
    vibrant: 'saturate(1.35) contrast(1.08)',
    warm: 'sepia(.16) saturate(1.18) contrast(1.04)',
    cool: 'hue-rotate(9deg) saturate(1.08) contrast(1.05)',
    none: 'none',
  }[config.colorPreset]
  const effects = { ...DEFAULT_CONFIG.visualEffects, ...(config.visualEffects ?? {}) }
  const filter = [
    legacyFilter === 'none' ? '' : legacyFilter,
    `brightness(${Math.max(0.2, 1 + effects.brightness)})`,
    `contrast(${effects.contrast + effects.sharpness * 0.035})`,
    `saturate(${effects.saturation})`,
    effects.temperature === 0 ? '' : `sepia(${Math.abs(effects.temperature) * 0.16}) hue-rotate(${effects.temperature * -8}deg)`,
  ].filter(Boolean).join(' ')
  const preset = outputPresetFor(config.output)
  const transitionLabel = {
    cut: 'Corte seco',
    fade: 'Suave',
    dissolve: 'Dissolver',
    'slide-left': 'Deslizar para o lado',
    'slide-up': 'Deslizar para cima',
    zoom: 'Aproximação',
  }[transition.preset]
  const transitionSfxLabel = {
    none: '',
    click: 'Estalo',
    pop: 'Impacto leve',
    whoosh: 'Passagem',
  }[transition.sfx]
  const framing = config.framing ?? DEFAULT_FRAMING
  const activeClipGeometry = previewClipGeometry(config.output, activeClip, framing.mode, clipFocusX, clipFocusY, clipZoom)
  const outgoingClipGeometry = previewClipGeometry(config.output, preparedOutgoingClip ?? undefined, framing.mode, preparedOutgoingFocusX, preparedOutgoingFocusY, preparedOutgoingZoom)
  const backgroundGeometry = previewClipGeometry(config.output, activeClip, 'cover', clipFocusX, clipFocusY, 1)
  const outgoingBackgroundGeometry = previewClipGeometry(config.output, preparedOutgoingClip ?? undefined, 'cover', preparedOutgoingFocusX, preparedOutgoingFocusY, 1)
  const backgroundBlur = `${28 / config.output.width * 100}cqw`
  const isReelsFormat = config.output.width * 16 === config.output.height * 9
  const safeAreaStyle = isReelsFormat
    ? { inset: '14% 6% 35%' }
    : preset?.id === 'feed-portrait' || preset?.id === 'feed-portrait-hd'
      ? { inset: '7% 6% 12%' }
      : { inset: '7%' }

  return (
    <section ref={previewPanel} className="ad-stage-panel">
      <div className="ad-preview-toolbar">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">Prévia da composição</h2>
          <p className="mt-0.5 truncate text-[11px] text-white/50">{preset?.label ?? `${config.output.width} × ${config.output.height}`} · {previewDuration}s</p>
        </div>
          <div className="ad-preview-toolbar-actions">
            <button
              type="button"
              onClick={() => setShowSafeZone((current) => !current)}
              className={`ad-preview-tool-button ${showSafeZone ? 'ad-preview-tool-button-active' : ''}`}
              aria-label={showSafeZone ? 'Ocultar área segura' : 'Mostrar área segura'}
              aria-pressed={showSafeZone}
              title="Alternar área segura"
            >
              <ShieldCheck size={15} />
            </button>
            <button
              type="button"
              onClick={() => setShowPlacementChrome((current) => !current)}
              className={`ad-preview-tool-button ${showPlacementChrome ? 'ad-preview-tool-button-active' : ''}`}
              aria-label={showPlacementChrome ? 'Ocultar simulação da interface da Meta' : 'Mostrar simulação da interface da Meta'}
              aria-pressed={showPlacementChrome}
              title="Simular interface da Meta"
            >
              <Clapperboard size={15} />
            </button>
            <button
              type="button"
              onClick={togglePreviewSound}
              disabled={!hasPreviewSound || !previewSoundReady}
              className={`ad-preview-tool-button ad-preview-sound-button ${hasPreviewSound && !muted ? 'ad-preview-tool-button-active' : ''}`}
              aria-label={!hasPreviewSound ? 'Nenhum áudio configurado' : audioFailed && !hasTransitionSfx ? 'Trilha indisponível' : !previewSoundReady ? 'Preparando áudio da prévia' : muted ? 'Ligar áudio da prévia' : 'Desligar áudio da prévia'}
              aria-pressed={hasPreviewSound ? !muted : false}
              title={!hasPreviewSound ? 'Adicione uma trilha ou efeito sonoro' : audioFailed && !hasTransitionSfx ? 'Não foi possível carregar a trilha' : !previewSoundReady ? 'Preparando áudio' : muted ? 'Ligar áudio' : 'Desligar áudio'}
            >
              {muted || !hasPreviewSound ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{!hasPreviewSound ? 'Sem áudio' : audioFailed && !hasTransitionSfx ? 'Som indisponível' : !previewSoundReady ? 'Preparando' : muted ? 'Som desligado' : 'Som ligado'}</span>
            </button>
            <button
              type="button"
              onClick={togglePreviewPlayback}
              className="ad-preview-tool-button"
              aria-label={playing ? 'Pausar prévia' : 'Reproduzir prévia'}
              title={playing ? 'Pausar prévia' : 'Reproduzir prévia'}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
          </div>
        </div>

      {sfxFailed ? <p className="text-sm text-amber-200">Não foi possível carregar o som de transição da prévia. Tente recarregar a página.</p> : null}
      {audioFailed ? (
        <p role="status" className="ad-preview-audio-status">
          Não foi possível carregar a trilha. <button type="button" onClick={retryPreviewAudio}>Tentar novamente</button>
        </p>
      ) : audioPlaybackBlocked ? (
        <p role="status" className="ad-preview-audio-status">O navegador bloqueou o áudio. Toque em “Som desligado” para tentar novamente.</p>
      ) : null}

        <div
          className="ad-phone-stage"
          style={{
            aspectRatio: `${config.output.width} / ${config.output.height}`,
            backgroundColor: framing.backgroundColor,
          }}
        >
          {activeClip && media.url ? (
            <>
              {preparedOutgoingClip && preparedOutgoingUrl ? (
                <div className="ad-preview-transition-layer pointer-events-none absolute inset-0 z-0 overflow-hidden" style={{ ...transitionFrame.outgoing, backgroundColor: framing.backgroundColor }} aria-hidden="true">
                  {framing.mode === 'contain-blur' ? (
                    <video
                      ref={outgoingBackgroundVideo}
                      src={preparedOutgoingUrl}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(event) => { event.currentTarget.currentTime = preparedOutgoingSourceTimeRef.current; event.currentTarget.playbackRate = preparedOutgoingSpeed }}
                      onTimeUpdate={keepOutgoingWithinTrim}
                      className="absolute max-w-none"
                      style={{
                        ...outgoingBackgroundGeometry,
                        filter: `${filter === 'none' ? '' : filter} blur(${backgroundBlur})`,
                      }}
                    />
                  ) : null}
                  <video
                    ref={outgoingForegroundVideo}
                    src={preparedOutgoingUrl}
                    muted
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => { event.currentTarget.currentTime = preparedOutgoingSourceTimeRef.current; event.currentTarget.playbackRate = preparedOutgoingSpeed }}
                    onCanPlay={() => {
                      if (preparedOutgoingUrl) setOutgoingLayerReadyKey(preparedOutgoingUrl)
                    }}
                    onTimeUpdate={keepOutgoingWithinTrim}
                    className="absolute max-w-none"
                    style={{
                      ...outgoingClipGeometry,
                      filter,
                    }}
                  />
                </div>
              ) : null}
              <div
                className="ad-preview-transition ad-preview-transition-layer z-[1]"
                style={{
                  ...transitionFrame.incoming,
                  backgroundColor: framing.backgroundColor,
                  ...(dissolveMaskUrl ? {
                    maskImage: `url(${dissolveMaskUrl})`,
                    WebkitMaskImage: `url(${dissolveMaskUrl})`,
                    maskSize: '100% 100%',
                    WebkitMaskSize: '100% 100%',
                    maskRepeat: 'no-repeat',
                    WebkitMaskRepeat: 'no-repeat',
                  } : {}),
                }}
              >
              {framing.mode === 'contain-blur' ? (
                <video
                  ref={backgroundVideo}
                  aria-hidden="true"
                  src={media.url}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => { event.currentTarget.currentTime = activeSourceTimeRef.current; event.currentTarget.playbackRate = clipSpeed }}
                  onTimeUpdate={keepWithinTrim}
                  className="absolute max-w-none"
                  style={{ ...backgroundGeometry, filter: `${filter === 'none' ? '' : filter} blur(${backgroundBlur})` }}
                />
              ) : null}
              <video
                ref={foregroundVideo}
                src={media.url}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => { event.currentTarget.currentTime = activeSourceTimeRef.current; event.currentTarget.playbackRate = clipSpeed }}
                onCanPlay={() => {
                  if (activeLayerKey) setActiveLayerReadyKey(activeLayerKey)
                }}
                onTimeUpdate={keepWithinTrim}
                className="absolute max-w-none"
                style={{ ...activeClipGeometry, filter }}
              />
              </div>
            </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_70%_15%,#3d3764,#171725_58%)] px-8 text-center text-white/60">
            {activeClip ? <LoaderCircle size={30} className={media.error ? 'text-red-300' : 'animate-spin'} /> : <Film size={34} strokeWidth={1.5} />}
            <span className="mt-3 text-sm">{media.error ? 'Não foi possível carregar a prévia' : activeClip ? 'Carregando prévia…' : 'Adicione clipes para montar a prévia'}</span>
          </div>
        )}
          {showSafeZone ? (
            <div className="ad-safe-area" style={safeAreaStyle} aria-hidden="true">
              <span>{isReelsFormat ? 'Área livre recomendada pela Meta' : 'Margem de referência'}</span>
            </div>
          ) : null}
          {showSafeZone && framing.mode === 'cover' ? (
            <div
              className="ad-focus-point"
              style={{ left: `${clipFocusX}%`, top: `${clipFocusY}%` }}
              aria-hidden="true"
            />
          ) : null}
        {effects.vignette > 0 ? (
          <div className="ad-preview-vignette" style={{ opacity: Math.min(0.72, effects.vignette * 0.72) }} aria-hidden="true" />
        ) : null}
        {effects.grain > 0 ? (
          <div className="ad-preview-grain" style={{ opacity: Math.min(0.28, effects.grain * 0.28) }} aria-hidden="true" />
        ) : null}
        {effects.glow > 0 ? (
          <div className="ad-preview-glow" style={{ opacity: Math.min(0.45, effects.glow * 0.45) }} aria-hidden="true" />
        ) : null}
        {showPlacementChrome ? (
          <div className="pointer-events-none absolute inset-0 z-[14] bg-gradient-to-b from-black/35 via-transparent to-black/65 text-white" aria-hidden="true">
            <div className="absolute left-[5%] top-[4%] flex items-center gap-2 text-[9px] font-semibold drop-shadow">
              <span className="h-6 w-6 rounded-full border border-white/80 bg-white/25" />
              <span>@seuperfil<br /><span className="font-normal text-white/70">Patrocinado</span></span>
            </div>
            <div className="absolute bottom-[13%] right-[4%] flex flex-col items-center gap-3 text-sm drop-shadow">♡<span>◯</span><span>↗</span></div>
            <div className="absolute bottom-[4%] left-[5%] right-[5%] flex items-center justify-between gap-3 text-[9px]">
              <span>Confira a oferta e saiba mais</span><span className="rounded bg-white px-2 py-1 font-semibold text-black">Comprar</span>
            </div>
            <span className="absolute right-[4%] top-[4%] rounded bg-black/45 px-1.5 py-1 text-[8px]">Simulação</span>
          </div>
        ) : null}
        {captionArtwork ? (
          <img
            className="ad-preview-copy pointer-events-none absolute inset-0 z-10 h-full w-full"
            src={captionArtwork}
            alt={rawActiveText}
            draggable={false}
          />
        ) : null}
        <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between text-[10px] font-medium text-white/75">
            <span className="rounded-md bg-black/45 px-2 py-1 backdrop-blur-sm">{preset?.ratio ?? `${config.output.width}:${config.output.height}`} · {clipSpeed}×</span>
          <span className="rounded-md bg-black/45 px-2 py-1 backdrop-blur-sm">{hookActive ? 'Gancho' : `${Math.max(1, selectedClipIndex + 1)}/${Math.max(1, clips.length)}`}</span>
        </div>
      </div>

      {captions.isFetching || captionInput !== settledCaptionInput ? <p className="mt-2 text-center text-xs text-white/50" role="status">Atualizando texto da prévia…</p> : null}
      {captions.isError ? (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-red-200" role="alert">
          <span>Não foi possível carregar o texto da prévia.</span>
          <button type="button" className="underline" onClick={() => void captions.refetch()}>Tentar novamente</button>
        </div>
      ) : null}

      {timelineMusicTracks.map((track, index) => {
        const asset = musicAssetsById.get(track.assetId)
        const trackKey = `${track.assetId}:${index}`
        const active = previewElapsed >= track.startSeconds && previewElapsed < (track.endSeconds ?? previewDuration)
        return asset ? (
          <PreviewAudioTrack
            key={trackKey}
            projectId={project.id}
            asset={asset}
            track={track}
            trackKey={trackKey}
            active={active}
            elapsedSeconds={previewElapsed}
            previewDuration={previewDuration}
            playing={playing}
            timelineReady={activeClipReady && transitionLayersReady && timingReady}
            muted={muted}
            seekVersion={seekVersion}
            retryToken={audioRetryToken}
            onReady={markAudioReady}
            onError={markAudioFailed}
          />
        ) : null
      })}
      {previousClip && previousMedia.url ? <video src={previousMedia.url} muted playsInline preload="auto" className="sr-only" aria-hidden="true" /> : null}
      {nextClip && nextMedia.url ? <video src={nextMedia.url} muted playsInline preload="auto" className="sr-only" aria-hidden="true" /> : null}
      {followingClip && followingMedia.url ? <video src={followingMedia.url} muted playsInline preload="auto" className="sr-only" aria-hidden="true" /> : null}

      <div className="ad-preview-timeline">
        <input
          type="range"
          min={0}
          max={previewDuration}
          step={0.05}
          value={previewElapsed}
          onChange={(event) => seekPreview(Number(event.target.value))}
          className="ad-preview-scrubber w-full"
          aria-label="Posição da prévia"
          aria-valuetext={`${previewElapsed.toFixed(1)} de ${previewDuration} segundos`}
        />
        <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-white/45">
          <span>{previewElapsed.toFixed(1)}s</span>
          <span>{previewDuration}s · {config.output.fps} fps · {config.variationCount} var.</span>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5 overflow-hidden">
        {clips.slice(0, 8).map((clip, index) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => seekToClip(clip.id)}
            aria-label={`Ver clipe ${index + 1}`}
            className={`h-2 min-h-6 flex-1 rounded-full bg-clip-content py-[9px] ${!hookActive && clip.id === activeClip?.id ? 'bg-[#ff735e]' : 'bg-white/20'}`}
          />
        ))}
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={() => { setPlaying(false); onExactPreview() }}
          disabled={!canRenderExact || exactPreviewPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exactPreviewPending ? <LoaderCircle size={14} className="animate-spin" /> : <Clapperboard size={14} />}
          Gerar prévia fiel
        </button>
        <p className="mt-1.5 text-center text-[10px] leading-4 text-white/45">Gera uma variação com os efeitos, transições e batidas finais. O vídeo aparece nos resultados abaixo.</p>
      </div>

      <div className="ad-preview-meta">
        <span className="text-orange-100">Variação 1</span>
        <span>{transitionLabel}</span>
        {config.timing.mode === 'beat' ? <span>{beatTiming.data?.timingSource === 'beat' ? 'Cortes na batida' : beatTiming.isFetching ? 'Analisando batidas…' : beatTiming.isError ? 'Batidas indisponíveis na prévia' : 'Sem batidas · intervalo fixo'}</span> : null}
        {transitionSfxLabel ? <span title={`${Math.round(transition.sfxVolume * 100)}% na prévia e no vídeo final`}>Som de transição: {transitionSfxLabel}</span> : null}
        {hasMusic ? <span>{activeMusicTracks.length > 1 ? `${activeMusicTracks.length} trilhas tocando` : 'Trilha pronta'}</span> : null}
        {hookActive ? <span className="text-orange-100">Gancho</span> : null}
        {(config.colorPreset !== 'none' || effects.brightness !== 0 || effects.contrast !== 1 || effects.saturation !== 1 || effects.temperature !== 0 || effects.sharpness > 0 || effects.vignette > 0 || effects.grain > 0 || effects.glow > 0 || transition.preset === 'dissolve') ? <span title="Use a prévia fiel para conferir os efeitos na qualidade final">Efeitos visuais aproximados</span> : null}

      </div>
    </section>
  )
}

function RenderOutput({
  projectId,
  jobId,
  output,
  initiallyLoaded,
  aspectRatio,
}: {
  projectId: number
  jobId: number
  output: AdRenderJob['outputs'][number]
  initiallyLoaded: boolean
  aspectRatio: string
}) {
  const [loadMedia, setLoadMedia] = useState(initiallyLoaded)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)
  const media = useMediaBlobUrl(
    `output:${projectId}:${jobId}:${output.index}`,
    adProjectApi.outputUrl(projectId, jobId, output.index),
    () => adProjectApi.outputContent(projectId, jobId, output.index),
    loadMedia,
  )

  async function downloadOutput() {
    if (downloading) return
    setDownloading(true)
    setDownloadError(false)
    try {
      const url = media.url ?? URL.createObjectURL(await adProjectApi.outputContent(projectId, jobId, output.index))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = output.fileName
      anchor.click()
      if (!media.url) window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch {
      setDownloadError(true)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="overflow-hidden rounded-xl bg-zinc-950">
      {media.url ? (
          <video src={media.url} controls preload="metadata" className="w-full bg-black object-contain" style={{ aspectRatio }} />
      ) : (
          <div className="flex flex-col items-center justify-center gap-3 px-4 text-center text-xs text-white/60" style={{ aspectRatio }}>
          {media.error ? (
            <><CircleAlert size={20} className="text-red-300" />Não foi possível carregar este vídeo.</>
          ) : loadMedia ? (
            <LoaderCircle size={20} className="animate-spin" />
          ) : (
            <button type="button" onClick={() => setLoadMedia(true)} className="rounded-lg bg-white/10 px-3 py-2 font-medium text-white hover:bg-white/20">Carregar prévia</button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-white">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{output.fileName}</div>
          <div className="text-[11px] text-white/50">{bytes(output.sizeBytes)}</div>
          {output.timingSource ? (
            <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${TIMING_SOURCE[output.timingSource].className}`}>
              {TIMING_SOURCE[output.timingSource].label}
            </span>
          ) : null}
          {downloadError ? <div className="mt-1 text-[10px] text-red-300">Falha ao baixar. Tente novamente.</div> : null}
          <details className="mt-1.5 text-[10px] text-white/50">
            <summary className="cursor-pointer select-none hover:text-white/75">Sequência usada</summary>
            <div className="mt-1 max-w-52 space-y-0.5 break-words">
              <div>{output.clipAssetIds.length} clipes · cortes em {output.cutTimes.map((cut) => `${cut.toFixed(1)}s`).join(', ')}</div>
              <div>{output.textOrder.length} textos nesta ordem</div>
            </div>
          </details>
        </div>
        <button type="button" onClick={() => void downloadOutput()} disabled={downloading} className="rounded-lg bg-white/10 p-2 hover:bg-white/20 disabled:cursor-wait disabled:opacity-60" aria-label={`Baixar ${output.fileName}`}>
          {downloading ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
        </button>
      </div>
    </div>
  )
}

function RenderCard({ projectId, job, onCancel, initiallyExpanded }: { projectId: number; job: AdRenderJob; onCancel: () => void; initiallyExpanded: boolean }) {
  const active = job.status === 'queued' || job.status === 'running'
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const aspectRatio = `${job.config.output.width} / ${job.config.output.height}`
  const outputPreset = outputPresetFor(job.config.output)
  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${
            job.status === 'completed' ? 'bg-emerald-500' : active ? 'animate-pulse bg-violet-500' : job.status === 'failed' ? 'bg-red-500' : 'bg-zinc-400'
          }`} />
            <span className="text-sm font-semibold text-zinc-800">{STATUS_LABEL[job.status]}</span>
            <span className="text-xs text-zinc-400">{formatDate(job.createdAt)}</span>
            <span className="hidden rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 sm:inline-flex">
              {outputPreset?.ratio ?? `${job.config.output.width}:${job.config.output.height}`} · {job.config.output.width}×{job.config.output.height}
            </span>
        </div>
        {active && (
          <button type="button" onClick={onCancel} className="text-xs font-medium text-zinc-500 hover:text-red-600">
            Cancelar
          </button>
        )}
        {job.status === 'completed' && job.outputs.length > 0 && (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs font-medium text-violet-700 hover:text-violet-900">
            {expanded ? 'Ocultar vídeos' : `Ver ${job.outputs.length} ${job.outputs.length === 1 ? 'vídeo' : 'vídeos'}`}
          </button>
        )}
      </div>
      {active && (
        <div className="px-4 py-4">
          <div className="mb-2 flex justify-between text-xs text-zinc-500">
            <span>{job.status === 'queued' ? 'Aguardando processador' : 'Criando variações'}</span>
            <span>{Math.round(job.progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${Math.max(3, job.progress)}%` }} />
          </div>
        </div>
      )}
      {job.status === 'failed' && (
        <div className="flex gap-2 bg-red-50 px-4 py-3 text-sm text-red-700">
          <CircleAlert size={17} className="mt-0.5 shrink-0" />
          <span>{job.error || 'Não foi possível gerar os vídeos.'}</span>
        </div>
      )}
      {job.status === 'completed' && expanded && (
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {job.outputs.map((output, outputIndex) => (
              <RenderOutput key={output.index} projectId={projectId} jobId={job.id} output={output} initiallyLoaded={initiallyExpanded && outputIndex === 0} aspectRatio={aspectRatio} />
          ))}
        </div>
      )}
    </article>
  )
}

function QueryErrorState({
  title,
  error,
  onRetry,
  className = '',
}: {
  title: string
  error: unknown
  onRetry: () => void
  className?: string
}) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-white px-6 py-12 text-center ${className}`}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600"><CircleAlert size={21} /></div>
      <h2 className="mt-4 text-base font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-zinc-500">{apiErrorMessage(error)}</p>
      <Button variant="secondary" className="mt-4" onClick={onRetry}>Tentar novamente</Button>
    </div>
  )
}

export default function AdLibraryPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draft, setDraft] = useState<AdProjectConfig>(copyConfig(DEFAULT_CONFIG))
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [musicUrl, setMusicUrl] = useState('')
  const [musicRightsConfirmed, setMusicRightsConfirmed] = useState(false)
  const [hydratedProjectId, setHydratedProjectId] = useState<number | null>(null)
  const loadedProjectId = useRef<number | null>(null)
  const latestDraft = useRef(draft)
  const latestDraftName = useRef(draftName)
  const textAreaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({})

  useEffect(() => {
    latestDraft.current = draft
    latestDraftName.current = draftName
  }, [draft, draftName])

  const projects = useQuery({ queryKey: ['ad-projects'], queryFn: adProjectApi.list })
  const activeId = selectedId ?? projects.data?.[0]?.id ?? null
  const project = useQuery({
    queryKey: ['ad-projects', activeId],
    queryFn: () => adProjectApi.get(activeId!),
    enabled: Boolean(activeId),
  })
  const jobs = useQuery({
    queryKey: ['ad-project-jobs', activeId],
    queryFn: () => adProjectApi.listJobs(activeId!),
    enabled: Boolean(activeId),
    refetchInterval: (query) => {
      const items = query.state.data as AdRenderJob[] | undefined
      return items?.some((job) => job.status === 'queued' || job.status === 'running') ? 1500 : false
    },
  })

  /* Form state intentionally resets when a different persisted project is loaded. */
  useEffect(() => {
    if (!project.data || loadedProjectId.current === project.data.id) return
    loadedProjectId.current = project.data.id
    type RecoveredDraft = { baseUpdatedAt: string; name: string; config: AdProjectConfig }
    let recovered: RecoveredDraft | null = null
    try {
      const stored = sessionStorage.getItem(`ad-project-draft:${project.data.id}`)
      recovered = stored ? JSON.parse(stored) as RecoveredDraft : null
    } catch {
      recovered = null
    }
    if (recovered?.baseUpdatedAt === project.data.updatedAt) {
      // Project switches are the explicit boundary where the persisted form is replaced.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftName(recovered.name)
      setDraft(copyConfig(recovered.config))
    } else {
      setDraftName(project.data.name)
      setDraft(copyConfig(project.data.config))
    }
    setHydratedProjectId(project.data.id)
    setFeedback(null)
    setError(null)
    setConfirmDelete(false)
  }, [project.data])

  const current = project.data
  const clips = current?.assets?.filter((asset) => asset.kind === 'clip') ?? []
  const music = current?.assets?.filter((asset) => asset.kind === 'music') ?? []
  const selectedClips = clips.filter((asset) => draft.selectedClipIds.includes(asset.id))
  const outputRatio = draft.output.width / draft.output.height
  const mismatchedClipCount = selectedClips.filter((asset) => {
    if (!asset.width || !asset.height) return false
    return Math.abs((asset.width / asset.height) - outputRatio) > 0.08
  }).length
  const lowResolutionClipCount = selectedClips.filter((asset) => {
    if (!asset.width || !asset.height) return false
    return asset.width < draft.output.width && asset.height < draft.output.height
  }).length
  const clipValidationError = clipSequenceValidation(clips, draft)
  const hasActiveJob = jobs.data?.some((job) => job.status === 'queued' || job.status === 'running') ?? false

  const createProject = useMutation({
    mutationFn: () => adProjectApi.create({ name: `Campanha ${new Date().toLocaleDateString('pt-BR')}`, config: copyConfig(DEFAULT_CONFIG) }),
    onSuccess: async (created) => {
      setSelectedId(created.id)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['ad-projects'] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const save = useMutation({
    mutationFn: () => {
      if (!draftName.trim()) throw new Error('Dê um nome ao projeto antes de salvar.')
      const texts = draft.texts.map((text) => text.trim()).filter(Boolean)
      if (texts.length === 0) throw new Error('Adicione pelo menos um texto.')
      const submittedState = JSON.stringify({ draftName, draft })
      return adProjectApi.update(activeId!, { name: draftName.trim(), config: { ...draft, texts } })
        .then((saved) => ({ saved, submittedState }))
    },
    onSuccess: async ({ saved, submittedState }) => {
      if (JSON.stringify({ draftName: latestDraftName.current, draft: latestDraft.current }) === submittedState) {
        setDraftName(saved.name)
        setDraft(copyConfig(saved.config))
      }
      setFeedback('Projeto salvo.')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ad-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['ad-projects', activeId] }),
      ])
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const duplicate = useMutation({
    mutationFn: () => adProjectApi.duplicate(activeId!),
    onSuccess: async (created) => {
      setSelectedId(created.id)
      setFeedback('Projeto duplicado.')
      await queryClient.invalidateQueries({ queryKey: ['ad-projects'] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const removeProject = useMutation({
    mutationFn: () => adProjectApi.remove(activeId!),
    onSuccess: async () => {
      setSelectedId(null)
      setConfirmDelete(false)
      await queryClient.invalidateQueries({ queryKey: ['ad-projects'] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const upload = useMutation({
    mutationFn: async (variables: { kind: 'clip' | 'music'; files: File[] }) => {
      const assets = await adProjectApi.uploadAssets(activeId!, variables.kind, variables.files)
      const persisted = normaliseCreativeConfig(draft)
      const persistedConfig: AdProjectConfig = variables.kind === 'clip'
        ? { ...persisted, selectedClipIds: [...new Set([...persisted.selectedClipIds, ...draft.selectedClipIds, ...assets.map((asset) => asset.id)])] }
        : {
            ...persisted,
            musicAssetId: persisted.musicAssetId ?? assets[0]?.id ?? null,
            musicTracks: [
              ...persisted.musicTracks,
              ...assets.map((asset) => ({
                assetId: asset.id,
                volume: 0.75,
                startSeconds: 0,
                endSeconds: null,
                sourceStartSeconds: 0,
                fadeInSeconds: 0.25,
                fadeOutSeconds: 0.5,
              })),
            ],
          }
      try {
        await adProjectApi.update(activeId!, { config: persistedConfig })
      } catch (cause) {
        await Promise.allSettled(assets.map((asset) => adProjectApi.removeAsset(activeId!, asset.id)))
        throw cause
      }
      return { assets, variables }
    },
    onSuccess: async ({ assets, variables }) => {
      setDraft((value) => {
        const normalized = normaliseCreativeConfig(value)
        return variables.kind === 'clip'
          ? { ...normalized, selectedClipIds: [...new Set([...normalized.selectedClipIds, ...assets.map((asset) => asset.id)])] }
          : {
              ...normalized,
              musicAssetId: normalized.musicAssetId ?? assets[0]?.id ?? null,
              musicTracks: [
                ...normalized.musicTracks,
                ...assets.map((asset) => ({
                  assetId: asset.id,
                  volume: 0.75,
                  startSeconds: 0,
                  endSeconds: null,
                  sourceStartSeconds: 0,
                  fadeInSeconds: 0.25,
                  fadeOutSeconds: 0.5,
                })),
              ],
            }
      })
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ad-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['ad-projects', activeId] }),
      ])
    },
    onError: async (cause) => {
      setError(apiErrorMessage(cause))
      await queryClient.invalidateQueries({ queryKey: ['ad-projects', activeId] })
    },
  })
  const importMusic = useMutation({
    mutationFn: (variables: { url: string; projectId: number }) => adProjectApi.importMusic(variables.projectId, variables.url),
    onSuccess: async ({ asset, project: updatedProject }) => {
      const projectId = updatedProject.id
      const track = updatedProject.config.musicTracks.find((item) => item.assetId === asset.id)
      queryClient.setQueryData(['ad-projects', projectId], updatedProject)
      if (activeId === projectId) {
        setDraft((value) => {
          const normalized = normaliseCreativeConfig(value)
          return {
            ...normalized,
            musicAssetId: normalized.musicAssetId ?? asset.id,
            musicTracks: track && !normalized.musicTracks.some((item) => item.assetId === asset.id)
              ? [...normalized.musicTracks, track]
              : normalized.musicTracks,
          }
        })
      }
      setMusicUrl('')
      setMusicRightsConfirmed(false)
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ad-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['ad-projects', projectId] }),
      ])
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const removeAsset = useMutation({
    mutationFn: async (asset: AdAsset) => {
      const persisted = normaliseCreativeConfig(draft)
      const clipEdits = { ...(persisted.clipEdits ?? {}) }
      delete clipEdits[String(asset.id)]
      const persistedConfig: AdProjectConfig = {
        ...persisted,
        selectedClipIds: persisted.selectedClipIds.filter((id) => id !== asset.id),
        clipEdits,
        musicAssetId: persisted.musicAssetId === asset.id ? null : persisted.musicAssetId,
        musicTracks: persisted.musicTracks.filter((track) => track.assetId !== asset.id),
        hook: persisted.hook.clipAssetId === asset.id
          ? { ...persisted.hook, enabled: false, clipAssetId: null }
          : persisted.hook,
      }
      await adProjectApi.update(activeId!, { config: persistedConfig })
      try {
        await adProjectApi.removeAsset(activeId!, asset.id)
      } catch (cause) {
        await adProjectApi.update(activeId!, { config: persisted }).catch(() => undefined)
        throw cause
      }
      return asset
    },
    onSuccess: async (asset) => {
      setDraft((value) => {
        const clipEdits = { ...(value.clipEdits ?? {}) }
        delete clipEdits[String(asset.id)]
        return {
          ...normaliseCreativeConfig(value),
          selectedClipIds: value.selectedClipIds.filter((id) => id !== asset.id),
          clipEdits,
          musicAssetId: value.musicAssetId === asset.id ? null : value.musicAssetId,
          musicTracks: (value.musicTracks ?? []).filter((track) => track.assetId !== asset.id),
          hook: value.hook?.clipAssetId === asset.id
            ? { ...value.hook, enabled: false, clipAssetId: null }
            : value.hook,
        }
      })
      await queryClient.invalidateQueries({ queryKey: ['ad-projects', activeId] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const render = useMutation({
    mutationFn: async (previewOnly: boolean) => {
      if (!draftName.trim()) throw new Error('Dê um nome ao projeto antes de gerar.')
      if (draft.texts.every((text) => !text.trim())) throw new Error('Adicione pelo menos um texto.')
      const normalizedConfig = { ...draft, texts: draft.texts.map((text) => text.trim()).filter(Boolean) }
      const saved = await adProjectApi.update(activeId!, {
        name: draftName.trim(),
        config: normalizedConfig,
      })
      const job = await adProjectApi.render(activeId!, previewOnly ? { ...saved.config, variationCount: 1 } : undefined)
      return { job, saved, previewOnly, submittedState: JSON.stringify({ draftName, draft }) }
    },
    onSuccess: async ({ saved, submittedState, previewOnly }) => {
      if (JSON.stringify({ draftName: latestDraftName.current, draft: latestDraft.current }) === submittedState) {
        setDraftName(saved.name)
        setDraft(copyConfig(saved.config))
      }
      setFeedback(previewOnly ? 'Prévia fiel iniciada. Uma variação aparecerá nos resultados abaixo.' : 'Render iniciado. Você pode acompanhar o progresso abaixo.')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ad-project-jobs', activeId] }),
        queryClient.invalidateQueries({ queryKey: ['ad-projects'] }),
      ])
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const cancelJob = useMutation({
    mutationFn: (jobId: number) => adProjectApi.cancelJob(activeId!, jobId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['ad-project-jobs', activeId] }),
    onError: (cause) => setError(apiErrorMessage(cause)),
  })

  const dirty = useMemo(() => {
    if (!current) return false
    return draftName !== current.name || JSON.stringify(draft) !== JSON.stringify(copyConfig(current.config))
  }, [current, draft, draftName])

  useEffect(() => {
    if (!dirty) return undefined
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (!activeId || !current || current.id !== activeId || hydratedProjectId !== current.id) return
    const key = `ad-project-draft:${activeId}`
    try {
      if (dirty) {
        sessionStorage.setItem(key, JSON.stringify({ baseUpdatedAt: current.updatedAt, name: draftName, config: draft }))
      } else {
        sessionStorage.removeItem(key)
      }
    } catch {
      // Session storage may be unavailable; the beforeunload guard still protects the draft.
    }
  }, [activeId, current, dirty, draft, draftName, hydratedProjectId])

  function updateText(index: number, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      texts: currentDraft.texts.map((text, textIndex) => textIndex === index ? value : text),
    }))
  }

  function insertTextEmoji(index: number, emoji: string) {
    const textarea = textAreaRefs.current[index]
    const currentText = draft.texts[index] ?? ''
    const start = textarea?.selectionStart ?? currentText.length
    const end = textarea?.selectionEnd ?? start
    const nextText = `${currentText.slice(0, start)}${emoji}${currentText.slice(end)}`
    if (nextText.length > 280) return
    updateText(index, nextText)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  function toggleAsset(asset: AdAsset) {
    const normalized = normaliseCreativeConfig(draft)
    const selected = normalized.musicTracks.some((track) => track.assetId === asset.id)
    if (!selected && normalized.musicTracks.length >= 8) {
      setError('A trilha aceita até 8 faixas. Remova uma faixa antes de adicionar outra.')
      return
    }
    setDraft({
      ...normalized,
      musicAssetId: selected && normalized.musicAssetId === asset.id ? null : normalized.musicAssetId ?? asset.id,
      musicTracks: selected
        ? normalized.musicTracks.filter((track) => track.assetId !== asset.id)
        : [...normalized.musicTracks, {
            assetId: asset.id,
            volume: 0.75,
            startSeconds: 0,
            endSeconds: null,
            sourceStartSeconds: 0,
            fadeInSeconds: 0.25,
            fadeOutSeconds: 0.5,
          }],
    })
  }

  function uploadMusic(files: File[]) {
    const availableSlots = 8 - normaliseCreativeConfig(draft).musicTracks.length
    if (availableSlots <= 0 || files.length > availableSlots) {
      setError(`Você pode usar até 8 faixas. Há ${Math.max(0, availableSlots)} ${availableSlots === 1 ? 'espaço disponível' : 'espaços disponíveis'} neste projeto.`)
      return
    }
    upload.mutate({ kind: 'music', files })
  }

  function submitMusicUrl() {
    const availableSlots = 8 - normaliseCreativeConfig(draft).musicTracks.length
    if (availableSlots <= 0) {
      setError('A trilha aceita até 8 faixas. Remova uma faixa antes de importar outra.')
      return
    }
    if (!musicRightsConfirmed) {
      setError('Confirme que você pode usar este áudio no anúncio.')
      return
    }
    try {
      const url = new URL(musicUrl.trim())
      if (url.protocol !== 'https:') {
        setError('Use um link HTTPS direto para um arquivo de áudio.')
        return
      }
      if (/(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/.test(url.hostname.toLowerCase())) {
        setError('Links do YouTube e Spotify não fornecem um arquivo de áudio para importar aqui. Envie um arquivo licenciado ou cole um link HTTPS direto para ele.')
        return
      }
    } catch {
      setError('Cole um link HTTPS direto para um arquivo de áudio.')
      return
    }
    importMusic.mutate({ url: musicUrl.trim(), projectId: activeId! })
  }

  function selectProject(projectId: number) {
    if (projectId === activeId) return
    if (dirty && !window.confirm('Há alterações não salvas neste projeto. Deseja trocar de projeto e descartá-las?')) return
    if (dirty && activeId) {
      try { sessionStorage.removeItem(`ad-project-draft:${activeId}`) } catch { /* Storage may be unavailable. */ }
    }
    setSelectedId(projectId)
  }

  if (projects.isLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>
  }

  return (
    <div className="ad-library -m-4 min-h-full p-4 lg:-m-8 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-violet-700">
            <WandSparkles size={17} /> Biblioteca de anúncios
          </div>
          <h1 className="text-3xl font-bold tracking-[-0.035em] text-[#17172a] sm:text-4xl">Transforme clipes em criativos prontos</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">
            Combine vídeos, textos e música em variações verticais com cortes ritmados e tratamento de cor.
          </p>
        </div>
        <Button onClick={() => createProject.mutate()} disabled={createProject.isPending}>
          {createProject.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <Plus size={17} />}
          Novo projeto
        </Button>
      </header>

      {error && (
        <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-start gap-2"><CircleAlert size={17} className="mt-0.5 shrink-0" />{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Fechar erro"><X size={16} /></button>
        </div>
      )}
      {feedback && (
        <div role="status" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <span className="flex items-center gap-2"><Check size={17} />{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fechar mensagem"><X size={16} /></button>
        </div>
      )}

      {projects.isError ? (
        <QueryErrorState
          title="Não foi possível carregar seus projetos"
          error={projects.error}
          onRetry={() => void projects.refetch()}
          className="min-h-[360px]"
        />
      ) : !projects.data?.length ? (
        <div className="flex min-h-[480px] flex-col items-center justify-center rounded-3xl border border-dashed border-violet-200 bg-white/75 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Clapperboard size={30} /></div>
          <h2 className="mt-5 text-xl font-semibold text-zinc-900">Crie seu primeiro projeto</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">Separe seus melhores clipes. A biblioteca cuida das combinações, do texto, da trilha e do acabamento.</p>
          <Button className="mt-5" onClick={() => createProject.mutate()} disabled={createProject.isPending}><Plus size={17} /> Criar projeto</Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[240px_minmax(310px,420px)_minmax(360px,1fr)]">
            <aside className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-3 xl:sticky xl:top-0">
              <div className="flex items-center justify-between px-2 pb-3 pt-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800"><FolderOpen size={16} /> Projetos</div>
                <span className="text-xs text-zinc-400">{projects.data.length}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto xl:flex-col xl:overflow-visible">
                {projects.data.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectProject(item.id)}
                    className={`min-w-[190px] rounded-xl px-3 py-3 text-left transition xl:min-w-0 ${activeId === item.id ? 'bg-[#19192c] text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
                  >
                    <span className="block truncate text-sm font-semibold">{item.name}</span>
                    <span className={`mt-1 block text-xs ${activeId === item.id ? 'text-white/50' : 'text-zinc-400'}`}>{formatDate(item.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </aside>

            {project.isError ? (
              <QueryErrorState
                title="Não foi possível abrir este projeto"
                error={project.error}
                onRetry={() => void project.refetch()}
                className="min-h-[520px] xl:col-span-2"
              />
            ) : project.isLoading || !current ? (
              <div className="col-span-2 flex min-h-[520px] items-center justify-center rounded-2xl border border-zinc-200 bg-white"><Spinner /></div>
            ) : (
              <>
                <PhonePreview
                  key={current.id}
                  project={current}
                  config={draft}
                  onExactPreview={() => render.mutate(true)}
                  exactPreviewPending={render.isPending || hasActiveJob}
                  canRenderExact={draft.selectedClipIds.length > 0 && !clipValidationError && !hasActiveJob}
                />

                <div className="min-w-0 space-y-5">
                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Nome do projeto"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className="min-w-[220px] flex-1 border-0 bg-zinc-100 text-base font-semibold focus:bg-white"
                      />
                      <Button variant="secondary" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}><Copy size={16} /> Duplicar</Button>
                      {confirmDelete ? (
                        <div className="flex items-center gap-1">
                          <Button variant="danger" onClick={() => removeProject.mutate()} disabled={removeProject.isPending}>Excluir</Button>
                          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
                        </div>
                      ) : (
                        <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Excluir projeto"><Trash2 size={16} /></Button>
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Video size={18} className="text-violet-600" /> Clipes</h2>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">Organize, corte, acelere e ajuste cada clipe. O áudio original será removido.</p>
                      </div>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{clips.length}</span>
                    </div>
                    <ClipSequenceEditor
                      assets={clips}
                      config={draft}
                      onChange={setDraft}
                      removingAssetId={removeAsset.isPending ? removeAsset.variables?.id ?? null : null}
                      onRemove={(asset) => removeAsset.mutate(asset)}
                    />
                    <div className={clips.length > 0 ? 'mt-3' : ''}>
                      <UploadZone kind="clip" multiple busy={upload.isPending && upload.variables?.kind === 'clip'} onFiles={(files) => upload.mutate({ kind: 'clip', files })} />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Music2 size={18} className="text-violet-600" /> Música de fundo</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Envie um arquivo de áudio ou cole o link HTTPS direto de um arquivo que você pode usar no anúncio.</p>
                    <div className="mt-4 space-y-2">
                      {music.map((asset, index) => (
                        <AssetRow
                          key={asset.id}
                          asset={asset}
                          ordinal={index + 1}
                          selected={(draft.musicTracks ?? []).some((track) => track.assetId === asset.id) || draft.musicAssetId === asset.id}
                          onToggle={() => toggleAsset(asset)}
                          removing={removeAsset.isPending && removeAsset.variables?.id === asset.id}
                          onRemove={() => removeAsset.mutate(asset)}
                        />
                      ))}
                      <div className={music.length > 0 ? 'pt-1' : ''}>
                        <UploadZone kind="music" multiple busy={upload.isPending && upload.variables?.kind === 'music'} onFiles={uploadMusic} />
                      </div>
                    </div>
                    <form className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3" onSubmit={(event) => { event.preventDefault(); submitMusicUrl() }}>
                      <label htmlFor="ad-music-url" className="text-xs font-semibold text-zinc-800">Importar áudio por link direto</label>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input
                          id="ad-music-url"
                          type="url"
                          required
                          maxLength={2048}
                          placeholder="https://meus-arquivos.exemplo.com/musica.mp3"
                          value={musicUrl}
                          onChange={(event) => setMusicUrl(event.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
                        />
                        <Button type="submit" variant="secondary" disabled={importMusic.isPending || upload.isPending || !musicRightsConfirmed}>
                          {importMusic.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                          {importMusic.isPending ? 'Importando…' : 'Importar áudio'}
                        </Button>
                      </div>
                      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-zinc-700">
                        <input type="checkbox" checked={musicRightsConfirmed} onChange={(event) => setMusicRightsConfirmed(event.target.checked)} className="mt-1 accent-violet-600" />
                        Confirmo que tenho os direitos para usar este áudio em anúncios.
                      </label>
                      <p className="mt-2 text-[11px] leading-4 text-zinc-600">Use um arquivo de áudio público com até 10 minutos. YouTube e Spotify não oferecem download de faixas para sincronizar com anúncios; nesses casos, envie o arquivo licenciado.</p>
                    </form>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Sparkles size={18} className="text-violet-600" /> Textos</h2>
                        <p className="mt-1 text-xs text-zinc-500">Cada texto pode aparecer em combinações diferentes. Use Enter para controlar as quebras de linha.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDraft((value) => ({ ...value, texts: [...value.texts, ''] }))}
                        disabled={draft.texts.length >= 20}
                        className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 disabled:text-zinc-300"
                      ><Plus size={14} /> Adicionar</button>
                    </div>
                    <div className="space-y-2">
                      {draft.texts.map((text, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-[11px] font-bold text-violet-700">{index + 1}</span>
                          <textarea
                            ref={(node) => { textAreaRefs.current[index] = node }}
                            value={text}
                            onChange={(event) => updateText(index, event.target.value)}
                            rows={2}
                            maxLength={280}
                            aria-label={`Texto ${index + 1}`}
                            className="min-h-16 flex-1 resize-y rounded-xl border border-zinc-300 px-3 py-2 text-sm leading-5 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                          />
                          <div className="mt-1 flex shrink-0 flex-col gap-1">
                            <EmojiPicker onSelect={(emoji) => insertTextEmoji(index, emoji)} ariaLabel={`Adicionar emoji ao texto ${index + 1}`} align="right" />
                            <button
                              type="button"
                              onClick={() => setDraft((value) => ({ ...value, texts: value.texts.filter((_, textIndex) => textIndex !== index) }))}
                              disabled={draft.texts.length === 1}
                              className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                              aria-label={`Remover texto ${index + 1}`}
                            ><Trash2 size={15} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Scissors size={18} className="text-violet-600" /> Ritmo e formato</h2>
                    <div className="mt-4">
                      <div className="text-sm font-medium text-zinc-700">Formato de saída</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {OUTPUT_PRESETS.map((preset) => {
                          const selected = draft.output.width === preset.width && draft.output.height === preset.height
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setDraft((value) => ({
                                ...value,
                                output: { ...value.output, width: preset.width, height: preset.height },
                              }))}
                              className={`flex min-h-24 flex-col items-start rounded-xl border p-3 text-left transition ${selected ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100' : 'border-zinc-200 hover:border-violet-300 hover:bg-violet-50/40'}`}
                            >
                              <span className="flex w-full items-start justify-between gap-2">
                                <span
                                  className={`block h-8 rounded-[4px] border-2 ${selected ? 'border-violet-600 bg-violet-100' : 'border-zinc-400 bg-zinc-100'}`}
                                  style={{ aspectRatio: `${preset.width}/${preset.height}` }}
                                  aria-hidden="true"
                                />
                                <span className={`text-[11px] font-semibold ${selected ? 'text-violet-700' : 'text-zinc-500'}`}>{preset.ratio}</span>
                              </span>
                              <span className="mt-2 text-xs font-semibold text-zinc-800">{preset.label}</span>
                              <span className="mt-0.5 text-[10px] text-zinc-500">{preset.placement}</span>
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        {outputPresetFor(draft.output)?.label ?? 'Formato personalizado'} · {draft.output.width} × {draft.output.height} px · {outputPresetFor(draft.output)?.ratio ?? 'proporção personalizada'}
                      </p>
                      <div className="mt-3 grid gap-3 rounded-xl bg-zinc-50 p-3 sm:grid-cols-3">
                        <label className="text-xs font-medium text-zinc-600">
                          Largura
                          <div className="relative mt-1.5"><Input type="number" min={360} max={2160} step={2} value={draft.output.width} onChange={(event) => setDraft((value) => ({ ...value, output: { ...value.output, width: Number(event.target.value) } }))} className="pr-9" /><span className="absolute right-2.5 top-2 text-xs text-zinc-400">px</span></div>
                        </label>
                        <label className="text-xs font-medium text-zinc-600">
                          Altura
                          <div className="relative mt-1.5"><Input type="number" min={640} max={3840} step={2} value={draft.output.height} onChange={(event) => setDraft((value) => ({ ...value, output: { ...value.output, height: Number(event.target.value) } }))} className="pr-9" /><span className="absolute right-2.5 top-2 text-xs text-zinc-400">px</span></div>
                        </label>
                        <label className="text-xs font-medium text-zinc-600">
                          Quadros por segundo
                          <select value={draft.output.fps} onChange={(event) => setDraft((value) => ({ ...value, output: { ...value.output, fps: Number(event.target.value) as 24 | 25 | 30 } }))} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500">
                            <option value={24}>24 fps · cinema</option>
                            <option value={25}>25 fps</option>
                            <option value={30}>30 fps · fluido</option>
                          </select>
                        </label>
                      </div>
                      {selectedClips.length > 0 && (mismatchedClipCount > 0 || lowResolutionClipCount > 0) ? (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                          {mismatchedClipCount > 0 ? `${mismatchedClipCount} ${mismatchedClipCount === 1 ? 'clipe tem' : 'clipes têm'} outra proporção e ${mismatchedClipCount === 1 ? 'será adaptado' : 'serão adaptados'} pelo enquadramento escolhido.` : ''}
                          {mismatchedClipCount > 0 && lowResolutionClipCount > 0 ? ' ' : ''}
                          {lowResolutionClipCount > 0 ? `${lowResolutionClipCount} ${lowResolutionClipCount === 1 ? 'clipe pode' : 'clipes podem'} perder nitidez ao ampliar.` : ''}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Troca de cena
                        <select
                          value={draft.timing.mode}
                          onChange={(event) => {
                            const mode = event.target.value as 'fixed' | 'beat'
                            setDraft((value) => ({
                              ...value,
                              timing: mode === 'fixed'
                                ? { mode: 'fixed', seconds: value.timing.mode === 'fixed' ? value.timing.seconds : 2.5 }
                                : { mode: 'beat' },
                            }))
                          }}
                          className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
                        >
                          <option value="fixed">A cada intervalo</option>
                          <option value="beat">No ritmo da música</option>
                        </select>
                      </label>
                      {draft.timing.mode === 'fixed' ? (
                        <label className="text-sm font-medium text-zinc-700">
                          Intervalo
                          <div className="relative mt-1.5"><Input type="number" min={0.5} max={15} step={0.1} value={draft.timing.seconds ?? 2.5} onChange={(event) => setDraft((value) => ({ ...value, timing: { ...value.timing, seconds: Number(event.target.value) } }))} className="pr-12" /><span className="absolute right-3 top-2 text-sm text-zinc-400">seg</span></div>
                        </label>
                      ) : (
                        <div className="rounded-xl bg-violet-50 p-3 text-xs leading-5 text-violet-700"><AudioLines size={17} className="mb-1" />Os cortes acompanham os picos da música escolhida.</div>
                      )}
                      <label className="text-sm font-medium text-zinc-700">
                        Duração do anúncio
                        <div className="relative mt-1.5"><Input type="number" min={3} max={60} value={draft.output.durationSeconds} onChange={(event) => setDraft((value) => ({ ...value, output: { ...value.output, durationSeconds: Number(event.target.value) } }))} className="pr-12" /><span className="absolute right-3 top-2 text-sm text-zinc-400">seg</span></div>
                      </label>
                      <label className="text-sm font-medium text-zinc-700">
                        Variações
                        <Input type="number" min={1} max={20} value={draft.variationCount} onChange={(event) => setDraft((value) => ({ ...value, variationCount: Number(event.target.value) }))} className="mt-1.5" />
                      </label>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Crop size={18} className="text-violet-600" /> Enquadramento</h2>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">Escolha como clipes de outras proporções ocupam o formato final.</p>
                      </div>
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">Prévia ao vivo</span>
                    </div>
                    <div className="mt-4 grid gap-2">
                      {FRAMING_MODES.map((mode) => {
                        const framing = draft.framing ?? DEFAULT_FRAMING
                        const selected = framing.mode === mode.id
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setDraft((value) => ({
                              ...value,
                              framing: { ...(value.framing ?? DEFAULT_FRAMING), mode: mode.id },
                            }))}
                            className={`rounded-xl border px-3 py-2.5 text-left transition ${selected ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100' : 'border-zinc-200 hover:border-violet-300'}`}
                          >
                            <span className="block text-xs font-semibold text-zinc-800">{mode.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{mode.description}</span>
                          </button>
                        )
                      })}
                    </div>
                    {(draft.framing ?? DEFAULT_FRAMING).mode === 'cover' ? (
                      <div className="mt-4 rounded-xl bg-zinc-50 p-3">
                        <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold text-zinc-700">
                          <span className="flex items-center gap-1.5"><Focus size={15} className="text-violet-600" /> Ponto de foco</span>
                          <button
                            type="button"
                            onClick={() => setDraft((value) => ({ ...value, framing: { ...(value.framing ?? DEFAULT_FRAMING), focusX: 50, focusY: 50 } }))}
                            className="text-[11px] font-medium text-violet-700 hover:text-violet-900"
                          >Centralizar</button>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-xs font-medium text-zinc-600">Horizontal <span className="float-right text-zinc-400">{(draft.framing ?? DEFAULT_FRAMING).focusX}%</span><input type="range" min={0} max={100} value={(draft.framing ?? DEFAULT_FRAMING).focusX} onChange={(event) => setDraft((value) => ({ ...value, framing: { ...(value.framing ?? DEFAULT_FRAMING), focusX: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                          <label className="text-xs font-medium text-zinc-600">Vertical <span className="float-right text-zinc-400">{(draft.framing ?? DEFAULT_FRAMING).focusY}%</span><input type="range" min={0} max={100} value={(draft.framing ?? DEFAULT_FRAMING).focusY} onChange={(event) => setDraft((value) => ({ ...value, framing: { ...(value.framing ?? DEFAULT_FRAMING), focusY: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                        </div>
                      </div>
                    ) : null}
                    {(draft.framing ?? DEFAULT_FRAMING).mode === 'contain-solid' ? (
                      <label className="mt-4 flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">
                        Cor do fundo
                        <span className="flex items-center gap-2 text-[11px] text-zinc-400">
                          {(draft.framing ?? DEFAULT_FRAMING).backgroundColor.toUpperCase()}
                          <input type="color" value={(draft.framing ?? DEFAULT_FRAMING).backgroundColor} onChange={(event) => setDraft((value) => ({ ...value, framing: { ...(value.framing ?? DEFAULT_FRAMING), backgroundColor: event.target.value } }))} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" />
                        </span>
                      </label>
                    ) : null}
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-800">
                      <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                      Mantenha texto e produto dentro da área pontilhada da prévia. Botões, nome do perfil e legendas da Meta podem cobrir as bordas.
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <h2 className="text-base font-semibold text-zinc-900">Estilo do texto</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Ajuste a leitura da copy sobre qualquer cena.</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-medium text-zinc-600">Tamanho do texto <span className="float-right text-zinc-400">{draft.textStyle.fontSize}px</span><input type="range" min={36} max={140} value={draft.textStyle.fontSize} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, fontSize: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                      <label className="text-xs font-medium text-zinc-600">Altura na tela <span className="float-right text-zinc-400">{draft.textStyle.positionY}%</span><input type="range" min={15} max={85} value={draft.textStyle.positionY} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, positionY: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                      <label className="text-xs font-medium text-zinc-600 sm:col-span-2">Espessura do contorno <span className="float-right text-zinc-400">{draft.textStyle.borderWidth}px</span><input type="range" min={0} max={12} value={draft.textStyle.borderWidth} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, borderWidth: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                      <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">Cor do texto<input type="color" value={draft.textStyle.fontColor} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, fontColor: event.target.value } }))} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" /></label>
                      <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">Contorno<input type="color" value={draft.textStyle.borderColor} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, borderColor: event.target.value } }))} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" /></label>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="mb-4">
                      <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><WandSparkles size={18} className="text-violet-600" /> Direção criativa</h2>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Aplique uma receita pronta ou combine acabamento, gancho inicial e trilhas em camadas.</p>
                    </div>
                    <CreativeControls config={draft} assets={current.assets ?? []} onChange={setDraft} />
                  </section>

                  <div className="sticky bottom-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl shadow-zinc-900/10 backdrop-blur">
                    <Button variant="secondary" onClick={() => save.mutate()} disabled={!dirty || save.isPending || Boolean(clipValidationError)}><Save size={16} /> {save.isPending ? 'Salvando…' : dirty ? 'Salvar projeto' : 'Salvo'}</Button>
                    <Button
                      onClick={() => render.mutate(false)}
                      disabled={draft.selectedClipIds.length === 0 || render.isPending || hasActiveJob || Boolean(clipValidationError)}
                      className="bg-[#ee5b47] hover:bg-[#db4c39] disabled:bg-[#f4a397]"
                    >
                      {render.isPending || hasActiveJob ? <LoaderCircle size={16} className="animate-spin" /> : <Clapperboard size={16} />}
                      {hasActiveJob ? 'Renderizando…' : `Gerar ${draft.variationCount} ${draft.variationCount === 1 ? 'variação' : 'variações'}`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          {current && (
            <section className="mt-7">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-zinc-900">Vídeos gerados</h2>
                  <p className="mt-1 text-sm text-zinc-500">Pré-visualize, baixe e acompanhe os renders deste projeto.</p>
                </div>
                {hasActiveJob && <span className="flex items-center gap-2 text-xs font-medium text-violet-700"><Clock3 size={15} /> Atualizando automaticamente</span>}
              </div>
              {jobs.isError ? (
                <QueryErrorState
                  title="Não foi possível carregar os vídeos gerados"
                  error={jobs.error}
                  onRetry={() => void jobs.refetch()}
                  className="min-h-40"
                />
              ) : jobs.isLoading ? (
                <div className="flex h-32 items-center justify-center rounded-2xl border border-zinc-200 bg-white"><Spinner /></div>
              ) : jobs.data?.length ? (
                <div className="space-y-4">
                  {jobs.data.map((job, index) => <RenderCard key={job.id} projectId={current.id} job={job} initiallyExpanded={index === 0} onCancel={() => cancelJob.mutate(job.id)} />)}
                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 text-center text-sm text-zinc-500">Os vídeos aparecerão aqui depois do primeiro render.</div>
              )}
            </section>
          )}
        </>
      )}
      <p className="mt-8 text-xs leading-5 text-zinc-500">
        Confira texto, margens e direitos de uso antes de publicar. Para Reels, use música original ou livre de direitos.
        Emojis por <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer" className="underline">Twemoji</a>,
        sob <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY 4.0</a>.
      </p>
    </div>
  )
}
