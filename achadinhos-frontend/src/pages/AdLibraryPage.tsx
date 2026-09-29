import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
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
  WandSparkles,
  X,
} from 'lucide-react'
import {
  adProjectApi,
  apiErrorMessage,
  getAuthToken,
  type AdAsset,
  type AdColorPreset,
  type AdFramingMode,
  type AdProject,
  type AdProjectConfig,
  type AdRenderJob,
} from '@/lib/api'
import { Button, Input, Spinner } from '@/components/ui'

const DEFAULT_CONFIG: AdProjectConfig = {
  variationCount: 5,
  texts: [
    'Sua casa merece esse achadinho ✨',
    'Eu não sabia que precisava disso 😍',
    'O preço que todo mundo estava esperando',
  ],
  selectedClipIds: [],
  musicAssetId: null,
  timing: { mode: 'fixed', seconds: 2.5 },
  output: { width: 1080, height: 1920, durationSeconds: 15, fps: 30 },
  framing: { mode: 'cover', focusX: 50, focusY: 50, backgroundColor: '#101018' },
  colorPreset: 'natural',
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

const COLOR_PRESETS: Array<{ id: AdColorPreset; label: string; swatch: string }> = [
  { id: 'natural', label: 'Natural', swatch: 'linear-gradient(135deg,#746f64,#ded7c8)' },
  { id: 'vibrant', label: 'Vibrante', swatch: 'linear-gradient(135deg,#f15b47,#6f4bf2)' },
  { id: 'warm', label: 'Quente', swatch: 'linear-gradient(135deg,#9a3d29,#f6bd60)' },
  { id: 'cool', label: 'Frio', swatch: 'linear-gradient(135deg,#183d5d,#63b3c8)' },
  { id: 'none', label: 'Original', swatch: 'linear-gradient(135deg,#404040,#b8b8b8)' },
]

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

function copyConfig(config: AdProjectConfig): AdProjectConfig {
  return {
    ...config,
    texts: [...config.texts],
    selectedClipIds: [...config.selectedClipIds],
    timing: { ...config.timing },
    output: { ...config.output },
    framing: { ...DEFAULT_FRAMING, ...(config.framing ?? {}) },
    textStyle: { ...config.textStyle },
  }
}

function useMediaBlobUrl(
  requestKey: string,
  directUrl: string,
  fetchBlob: () => Promise<Blob>,
  enabled = true,
): { url: string | null; error: boolean } {
  const bearerAuth = Boolean(getAuthToken())
  const fetchBlobRef = useRef(fetchBlob)
  useEffect(() => {
    fetchBlobRef.current = fetchBlob
  }, [fetchBlob])
  const [result, setResult] = useState<{ key: string; url: string | null; error: boolean }>({
    key: '',
    url: null,
    error: false,
  })

  useEffect(() => {
    if (!bearerAuth || !enabled) return
    let disposed = false
    let objectUrl: string | null = null
    void fetchBlobRef.current()
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (disposed) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setResult({ key: requestKey, url: objectUrl, error: false })
      })
      .catch(() => {
        if (!disposed) setResult({ key: requestKey, url: null, error: true })
      })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bearerAuth, enabled, requestKey])

  const activeResult = result.key === requestKey ? result : null
  return {
    url: enabled ? (bearerAuth ? activeResult?.url ?? null : directUrl) : null,
    error: activeResult?.error ?? false,
  }
}

function AssetRow({
  asset,
  selected,
  onToggle,
  onRemove,
  removing,
}: {
  asset: AdAsset
  selected: boolean
  onToggle: () => void
  onRemove: () => void
  removing: boolean
}) {
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5">
      <div className="relative flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-950 text-white">
        {asset.kind === 'clip' ? <Film size={18} /> : <Music2 size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-800" title={asset.originalName}>
          {asset.originalName}
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
        aria-label={`Remover ${asset.originalName}`}
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

function PhonePreview({ project, config }: { project: AdProject; config: AdProjectConfig }) {
  const clips = (project.assets ?? []).filter((asset) => asset.kind === 'clip' && config.selectedClipIds.includes(asset.id))
  const [clipIndex, setClipIndex] = useState(0)
  const [textIndex, setTextIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [showSafeZone, setShowSafeZone] = useState(true)
  const activeClip = clips[clipIndex % Math.max(1, clips.length)]
  const activeText = config.texts[textIndex % Math.max(1, config.texts.length)] ?? ''
  const previewSeconds = config.timing.mode === 'fixed' ? config.timing.seconds : 2.5
  const media = useMediaBlobUrl(
    `asset:${project.id}:${activeClip?.id ?? 'none'}`,
    activeClip ? adProjectApi.assetContentUrl(project.id, activeClip.id) : '',
    () => adProjectApi.assetContent(project.id, activeClip!.id),
    Boolean(activeClip),
  )

  useEffect(() => {
    if (!playing || clips.length === 0) return
    const interval = window.setInterval(() => {
      setClipIndex((current) => (current + 1) % clips.length)
      setTextIndex((current) => (current + 1) % Math.max(1, config.texts.length))
    }, previewSeconds * 1000)
    return () => window.clearInterval(interval)
  }, [playing, clips.length, config.texts.length, previewSeconds])

  const filter = {
    natural: 'saturate(1.05) contrast(1.04)',
    vibrant: 'saturate(1.35) contrast(1.08)',
    warm: 'sepia(.16) saturate(1.18) contrast(1.04)',
    cool: 'hue-rotate(9deg) saturate(1.08) contrast(1.05)',
    none: 'none',
  }[config.colorPreset]
  const preset = outputPresetFor(config.output)
  const framing = config.framing ?? DEFAULT_FRAMING
  const objectPosition = `${framing.focusX}% ${framing.focusY}%`
  const isReelsFormat = config.output.width * 16 === config.output.height * 9
  const safeAreaStyle = isReelsFormat
    ? { inset: '14% 6% 35%' }
    : preset?.id === 'feed-portrait' || preset?.id === 'feed-portrait-hd'
      ? { inset: '7% 6% 12%' }
      : { inset: '7%' }

  return (
    <section className="ad-stage-panel">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Prévia da composição</h2>
          <p className="mt-1 text-xs text-white/55">A prévia simula cortes e estilo. O vídeo final é processado no servidor.</p>
        </div>
          <div className="flex gap-1 rounded-lg bg-white/10 p-1">
            <button
              type="button"
              onClick={() => setShowSafeZone((current) => !current)}
              className={`rounded-md p-1.5 ${showSafeZone ? 'bg-white/15 text-white' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}
              aria-label={showSafeZone ? 'Ocultar área segura' : 'Mostrar área segura'}
              aria-pressed={showSafeZone}
              title="Alternar área segura"
            >
              <ShieldCheck size={15} />
            </button>
            <button
            type="button"
            onClick={() => setPlaying((current) => !current)}
            className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            aria-label={playing ? 'Pausar prévia' : 'Reproduzir prévia'}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
      </div>

        <div
          className="ad-phone-stage"
          style={{
            aspectRatio: `${config.output.width} / ${config.output.height}`,
            backgroundColor: framing.backgroundColor,
          }}
        >
          {activeClip && media.url ? (
            <>
              {framing.mode === 'contain-blur' ? (
                <video
                  aria-hidden="true"
                  src={media.url}
                  autoPlay={playing}
                  muted
                  loop
                  playsInline
                  className="absolute -inset-[7%] h-[114%] w-[114%] object-cover opacity-75 blur-xl"
                  style={{ filter: `${filter === 'none' ? '' : filter} blur(20px)`, objectPosition }}
                />
              ) : null}
              <video
                key={activeClip.id}
                src={media.url}
                autoPlay={playing}
                muted
                loop
                playsInline
                className={`absolute inset-0 h-full w-full ${framing.mode === 'cover' ? 'object-cover' : 'object-contain'}`}
                style={{ filter, objectPosition }}
              />
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
              style={{ left: `${framing.focusX}%`, top: `${framing.focusY}%` }}
              aria-hidden="true"
            />
          ) : null}
        {activeText && (
          <div
            className="absolute left-[7%] right-[7%] z-10 -translate-y-1/2 whitespace-pre-wrap text-center font-black leading-[1.04]"
            style={{
              top: `${config.textStyle.positionY}%`,
              color: config.textStyle.fontColor,
              fontSize: `${Math.max(18, config.textStyle.fontSize * 0.42)}px`,
              WebkitTextStroke: `${Math.max(1, config.textStyle.borderWidth * 0.42)}px ${config.textStyle.borderColor}`,
              paintOrder: 'stroke fill',
              textShadow: '0 3px 10px rgba(0,0,0,.35)',
            }}
          >
            {activeText}
          </div>
        )}
        <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between text-[10px] font-medium text-white/75">
            <span className="rounded-md bg-black/45 px-2 py-1 backdrop-blur-sm">{preset?.ratio ?? `${config.output.width}:${config.output.height}`} · sem áudio original</span>
          <span className="rounded-md bg-black/45 px-2 py-1 backdrop-blur-sm">{clipIndex + 1}/{Math.max(1, clips.length)}</span>
        </div>
      </div>

      <div className="mt-4 flex gap-1.5 overflow-hidden">
        {clips.slice(0, 8).map((clip, index) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => setClipIndex(index)}
            aria-label={`Ver clipe ${index + 1}`}
            className={`h-1.5 flex-1 rounded-full ${index === clipIndex ? 'bg-[#ff735e]' : 'bg-white/20'}`}
          />
        ))}
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
  const media = useMediaBlobUrl(
    `output:${projectId}:${jobId}:${output.index}`,
    adProjectApi.outputUrl(projectId, jobId, output.index),
    () => adProjectApi.outputContent(projectId, jobId, output.index),
    loadMedia,
  )
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
        </div>
        {media.url && (
          <a href={media.url} download={output.fileName} className="rounded-lg bg-white/10 p-2 hover:bg-white/20" aria-label={`Baixar ${output.fileName}`}>
            <Download size={15} />
          </a>
        )}
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
  const loadedProjectId = useRef<number | null>(null)

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
    setDraftName(project.data.name)
    setDraft(copyConfig(project.data.config))
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
      return adProjectApi.update(activeId!, { name: draftName.trim(), config: { ...draft, texts } })
    },
    onSuccess: async (saved) => {
      setDraftName(saved.name)
      setDraft(copyConfig(saved.config))
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
      const persisted = current?.config ?? draft
      const persistedConfig: AdProjectConfig = variables.kind === 'clip'
        ? { ...persisted, selectedClipIds: [...new Set([...persisted.selectedClipIds, ...draft.selectedClipIds, ...assets.map((asset) => asset.id)])] }
        : { ...persisted, musicAssetId: assets[0]?.id ?? null }
      await adProjectApi.update(activeId!, { config: persistedConfig })
      return { assets, variables }
    },
    onSuccess: async ({ assets, variables }) => {
      setDraft((value) => variables.kind === 'clip'
        ? { ...value, selectedClipIds: [...new Set([...value.selectedClipIds, ...assets.map((asset) => asset.id)])] }
        : { ...value, musicAssetId: assets[0]?.id ?? null })
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
  const removeAsset = useMutation({
    mutationFn: async (asset: AdAsset) => {
      const persisted = current?.config ?? draft
      const persistedConfig: AdProjectConfig = {
        ...persisted,
        selectedClipIds: persisted.selectedClipIds.filter((id) => id !== asset.id),
        musicAssetId: persisted.musicAssetId === asset.id ? null : persisted.musicAssetId,
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
      setDraft((value) => ({
        ...value,
        selectedClipIds: value.selectedClipIds.filter((id) => id !== asset.id),
        musicAssetId: value.musicAssetId === asset.id ? null : value.musicAssetId,
      }))
      await queryClient.invalidateQueries({ queryKey: ['ad-projects', activeId] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const render = useMutation({
    mutationFn: async () => {
      if (!draftName.trim()) throw new Error('Dê um nome ao projeto antes de gerar.')
      if (draft.texts.every((text) => !text.trim())) throw new Error('Adicione pelo menos um texto.')
      const normalizedConfig = { ...draft, texts: draft.texts.map((text) => text.trim()).filter(Boolean) }
      const saved = await adProjectApi.update(activeId!, {
        name: draftName.trim(),
        config: normalizedConfig,
      })
      const job = await adProjectApi.render(activeId!)
      return { job, saved }
    },
    onSuccess: async ({ saved }) => {
      setDraftName(saved.name)
      setDraft(copyConfig(saved.config))
      setFeedback('Render iniciado. Você pode acompanhar o progresso abaixo.')
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

  function updateText(index: number, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      texts: currentDraft.texts.map((text, textIndex) => textIndex === index ? value : text),
    }))
  }

  function toggleAsset(asset: AdAsset) {
    setDraft((currentDraft) => asset.kind === 'clip'
      ? {
          ...currentDraft,
          selectedClipIds: currentDraft.selectedClipIds.includes(asset.id)
            ? currentDraft.selectedClipIds.filter((id) => id !== asset.id)
            : [...currentDraft.selectedClipIds, asset.id],
        }
      : {
          ...currentDraft,
          musicAssetId: currentDraft.musicAssetId === asset.id ? null : asset.id,
        })
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
          <div className="grid items-start gap-5 xl:grid-cols-[240px_minmax(310px,420px)_minmax(360px,1fr)]">
            <aside className="rounded-2xl border border-zinc-200 bg-white p-3 xl:sticky xl:top-0">
              <div className="flex items-center justify-between px-2 pb-3 pt-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800"><FolderOpen size={16} /> Projetos</div>
                <span className="text-xs text-zinc-400">{projects.data.length}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto xl:flex-col xl:overflow-visible">
                {projects.data.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
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
                <PhonePreview project={current} config={draft} />

                <div className="space-y-5">
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
                        <p className="mt-1 text-xs leading-5 text-zinc-500">A ordem e os pontos de início variam automaticamente. O áudio original será removido.</p>
                      </div>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{clips.length}</span>
                    </div>
                    <div className="space-y-2">
                      {clips.map((asset) => (
                        <AssetRow
                          key={asset.id}
                          asset={asset}
                          selected={draft.selectedClipIds.includes(asset.id)}
                          onToggle={() => toggleAsset(asset)}
                          removing={removeAsset.isPending && removeAsset.variables?.id === asset.id}
                          onRemove={() => removeAsset.mutate(asset)}
                        />
                      ))}
                    </div>
                    <div className={clips.length > 0 ? 'mt-3' : ''}>
                      <UploadZone kind="clip" multiple busy={upload.isPending && upload.variables?.kind === 'clip'} onFiles={(files) => upload.mutate({ kind: 'clip', files })} />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900"><Music2 size={18} className="text-violet-600" /> Música de fundo</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Use sua própria faixa. O volume e os fades são aplicados no render.</p>
                    <div className="mt-4 space-y-2">
                      {music.map((asset) => (
                        <AssetRow
                          key={asset.id}
                          asset={asset}
                          selected={draft.musicAssetId === asset.id}
                          onToggle={() => toggleAsset(asset)}
                          removing={removeAsset.isPending && removeAsset.variables?.id === asset.id}
                          onRemove={() => removeAsset.mutate(asset)}
                        />
                      ))}
                      {music.length === 0 && <UploadZone kind="music" multiple={false} busy={upload.isPending && upload.variables?.kind === 'music'} onFiles={(files) => upload.mutate({ kind: 'music', files })} />}
                    </div>
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
                            value={text}
                            onChange={(event) => updateText(index, event.target.value)}
                            rows={2}
                            maxLength={280}
                            aria-label={`Texto ${index + 1}`}
                            className="min-h-16 flex-1 resize-y rounded-xl border border-zinc-300 px-3 py-2 text-sm leading-5 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                          />
                          <button
                            type="button"
                            onClick={() => setDraft((value) => ({ ...value, texts: value.texts.filter((_, textIndex) => textIndex !== index) }))}
                            disabled={draft.texts.length === 1}
                            className="mt-2 rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                            aria-label={`Remover texto ${index + 1}`}
                          ><Trash2 size={15} /></button>
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
                    <h2 className="text-base font-semibold text-zinc-900">Tratamento de cor</h2>
                    <div className="mt-3 grid grid-cols-5 gap-2">
                      {COLOR_PRESETS.map((preset) => (
                        <button key={preset.id} type="button" onClick={() => setDraft((value) => ({ ...value, colorPreset: preset.id }))} className={`rounded-xl border p-1.5 text-center ${draft.colorPreset === preset.id ? 'border-violet-500 ring-2 ring-violet-100' : 'border-zinc-200'}`}>
                          <span className="block h-8 rounded-lg" style={{ background: preset.swatch }} />
                          <span className="mt-1.5 block truncate text-[10px] font-medium text-zinc-600">{preset.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-medium text-zinc-600">Tamanho do texto <span className="float-right text-zinc-400">{draft.textStyle.fontSize}px</span><input type="range" min={36} max={140} value={draft.textStyle.fontSize} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, fontSize: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                      <label className="text-xs font-medium text-zinc-600">Altura na tela <span className="float-right text-zinc-400">{draft.textStyle.positionY}%</span><input type="range" min={15} max={85} value={draft.textStyle.positionY} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, positionY: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                      <label className="text-xs font-medium text-zinc-600 sm:col-span-2">Espessura do contorno <span className="float-right text-zinc-400">{draft.textStyle.borderWidth}px</span><input type="range" min={0} max={12} value={draft.textStyle.borderWidth} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, borderWidth: Number(event.target.value) } }))} className="mt-2 w-full accent-violet-600" /></label>
                      <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">Cor do texto<input type="color" value={draft.textStyle.fontColor} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, fontColor: event.target.value } }))} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" /></label>
                      <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">Contorno<input type="color" value={draft.textStyle.borderColor} onChange={(event) => setDraft((value) => ({ ...value, textStyle: { ...value.textStyle, borderColor: event.target.value } }))} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" /></label>
                    </div>
                  </section>

                  <div className="sticky bottom-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl shadow-zinc-900/10 backdrop-blur">
                    <Button variant="secondary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}><Save size={16} /> {save.isPending ? 'Salvando…' : dirty ? 'Salvar projeto' : 'Salvo'}</Button>
                    <Button
                      onClick={() => render.mutate()}
                      disabled={draft.selectedClipIds.length === 0 || render.isPending || hasActiveJob}
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
