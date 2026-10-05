import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ChevronLeft,
  ChevronRight,
  Image,
  Plus,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Trash2,
} from 'lucide-react'
import {
  adProjectApi,
  type AdAsset,
  type AdCarouselSlide,
  type AdProject,
  type AdProjectConfig,
} from '@/lib/api'
import { usePreviewFullscreen } from '@/hooks/usePreviewFullscreen'
import { DEFAULT_CLIP_EDIT } from '@/lib/adClipConfig'
import { Button } from '@/components/ui'
import { previewClipGeometry } from '@/lib/adPreviewFraming'

function CarouselMedia({
  projectId,
  asset,
  config,
  durationSeconds,
  edit,
  playing,
  muted,
  onFinished,
}: {
  projectId: number
  asset: AdAsset
  config: AdProjectConfig
  durationSeconds: number
  edit: AdCarouselSlide['edit']
  playing: boolean
  muted: boolean
  onFinished: () => void
}) {
  const background = useRef<HTMLVideoElement>(null)
  const foreground = useRef<HTMLVideoElement>(null)
  const started = useRef(0)
  const changes = { ...DEFAULT_CLIP_EDIT, ...edit }
  useEffect(() => {
    if (foreground.current) { foreground.current.volume = changes.volume ?? 1; foreground.current.playbackRate = changes.speed }
  }, [changes.volume, changes.speed])
  const [url, setUrl] = useState('')
  const [mediaError, setMediaError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    void adProjectApi
      .assetContent(projectId, asset.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setMediaError(true)
      })
    // Retain only the active slide's Blob; cancel downloads and free it when
    // moving between slides instead of caching up to twenty large videos.
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [projectId, asset.id])
  useEffect(() => {
    const video = foreground.current
    if (!video || !url) return
    if (playing) {
      if (video.paused) started.current = performance.now()
      void video.play().catch(onFinished)
    } else video.pause()
  }, [playing, url, onFinished])
  const framing = changes.framingOverride ? { ...config.framing, focusX: changes.focusX, focusY: changes.focusY } : config.framing
  const geometry = previewClipGeometry(
    config.output,
    asset,
    framing.mode,
    framing.focusX,
    framing.focusY,
    changes.framingOverride ? changes.zoom : 1,
  )
  const backgroundGeometry = previewClipGeometry(
    config.output,
    asset,
    'cover',
    framing.focusX,
    framing.focusY,
    1,
  )
  if (mediaError)
    return (
      <p role="alert" className="p-5 text-sm text-red-200">
        Não foi possível carregar esta mídia.
      </p>
    )
  if (!url)
    return (
      <p role="status" className="p-5 text-sm text-white/60">
        Carregando mídia...
      </p>
    )
  return (
    <>
      <style>{`@keyframes ad-zoom-in {from {transform:scale(1)} to {transform:scale(1.12)}} @keyframes ad-zoom-out {from {transform:scale(1.12)} to {transform:scale(1)}} @keyframes ad-pan-left {from {transform:scale(1.12) translateX(5.35%)} to {transform:scale(1.12) translateX(-5.35%)}} @keyframes ad-pan-right {from {transform:scale(1.12) translateX(-5.35%)} to {transform:scale(1.12) translateX(5.35%)}}`}</style>
      <div className="absolute inset-0" style={asset.kind === 'image' && changes.motion && changes.motion !== 'none' ? { animation: `ad-${changes.motion} ${durationSeconds}s linear forwards`, animationPlayState: playing ? 'running' : 'paused', transformOrigin: `${framing.focusX}% ${framing.focusY}%` } : undefined}>
      {framing.mode === 'contain-blur' ? (
        asset.kind === 'image' ? (
          <img
            src={url}
            alt=""
            className="absolute max-w-none"
            style={{
              ...backgroundGeometry,
              filter: `blur(${(28 / config.output.width) * 100}cqw)`,
            }}
          />
        ) : (
          <video
            ref={background}
            src={url}
            muted
            playsInline
            className="absolute max-w-none"
            style={{
              ...backgroundGeometry,
              filter: `blur(${(28 / config.output.width) * 100}cqw)`,
            }}
          />
        )
      ) : null}
      {asset.kind === 'image' ? (
        <img
          src={url}
          alt={asset.originalName}
          className="absolute max-w-none"
          style={geometry}
        />
      ) : (
        <video
          ref={foreground}
          src={url}
          muted={muted}
          playsInline
          loop={asset.durationSeconds < durationSeconds}
          onLoadedMetadata={(event) => { event.currentTarget.currentTime = changes.trimStart; event.currentTarget.playbackRate = changes.speed; event.currentTarget.volume = changes.volume ?? 1 }}
          onPlay={() => {
            started.current = performance.now()
            if (background.current && foreground.current) background.current.currentTime = foreground.current.currentTime
            void background.current?.play().catch(() => undefined)
          }}
          onPause={() => background.current?.pause()}
          className="absolute max-w-none"
          style={geometry}
          onTimeUpdate={(event) => {
            if (
              background.current &&
              Math.abs(
                background.current.currentTime -
                  event.currentTarget.currentTime,
              ) > 0.2
            )
              background.current.currentTime = event.currentTarget.currentTime
            if (event.currentTarget.currentTime >= (changes.trimEnd ?? asset.durationSeconds) - 0.05) event.currentTarget.currentTime = changes.trimStart
            if (playing && !event.currentTarget.paused && started.current > 0 && performance.now() - started.current >= durationSeconds * 1000) {
              event.currentTarget.pause()
              event.currentTarget.currentTime = changes.trimStart
              onFinished()
            }
          }}
        />
      )}
      </div>
    </>
  )
}

export function CarouselPreview({
  project,
  config,
  index,
  onIndexChange,
}: {
  project: AdProject
  config: AdProjectConfig
  index: number
  onIndexChange: (index: number) => void
}) {
  const { ref, expanded, toggle } = usePreviewFullscreen()
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [muted, setMuted] = useState(true)
  const slides = config.carousel?.slides ?? []
  const selectedIndex = Math.min(index, Math.max(0, slides.length - 1))
  const slide = slides[selectedIndex]
  const asset = project.assets.find((item) => item.id === slide?.assetId)
  const captionInput = JSON.stringify({
    texts: slide?.text.trim() ? [slide.text.trim()] : [],
    output: config.output,
    textStyle: slide?.textStyle ?? config.textStyle,
  })
  const [settledInput, setSettledInput] = useState(captionInput)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledInput(captionInput), 200)
    return () => window.clearTimeout(timer)
  }, [captionInput])
  const captions = useQuery({
    queryKey: ['carousel-caption', settledInput],
    queryFn: ({ signal }) =>
      adProjectApi.previewCaptions(JSON.parse(settledInput), signal),
    enabled: Boolean(JSON.parse(settledInput).texts.length),
    staleTime: 5 * 60 * 1000,
  })
  const artwork = captions.data?.find(
    (item) => item.text === slide?.text.trim(),
  )
  return (
    <section ref={ref} className={`ad-stage-panel ${expanded ? 'ad-stage-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label="Prévia do carrossel" style={{ '--ad-preview-ratio': config.output.width / config.output.height } as React.CSSProperties}>
      <div className="ad-preview-toolbar">
        <h2 className="text-sm font-semibold text-white">Prévia <span className="ml-2 text-xs font-normal text-white/50">{config.output.width === config.output.height ? '1:1' : '4:5'}</span></h2>
        <button type="button" onClick={() => void toggle()} className="ad-preview-tool-button" aria-label={expanded ? 'Reduzir prévia' : 'Ampliar prévia'} title={expanded ? 'Reduzir prévia' : 'Ampliar prévia'}>
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
      <div className="ad-carousel-canvas">
        <div
          className="relative overflow-hidden"
          style={{
            aspectRatio: `${config.output.width}/${config.output.height}`,
            backgroundColor: config.framing.backgroundColor,
            containerType: 'inline-size',
          }}
        >
          {asset && slide ? (
            <CarouselMedia
              key={`${project.id}:${asset.id}:${selectedIndex}`}
              projectId={project.id}
              asset={asset}
              config={config}
              durationSeconds={slide.durationSeconds}
              edit={slide.edit}
              playing={playingIndex === selectedIndex}
              muted={muted}
              onFinished={() => setPlayingIndex(null)}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/60">
              <Image size={32} />
              Adicione imagens ou vídeos para montar o carrossel.
            </div>
          )}
          {artwork ? (
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork.svg)}`}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          ) : null}
        </div>
        {captions.isError && slide?.text ? (
          <p role="alert" className="mt-2 text-xs text-red-200">
            Não foi possível carregar a prévia do texto.
          </p>
        ) : null}
      </div>
      {(asset?.kind === 'clip' || (slide?.edit?.motion && slide.edit.motion !== 'none')) ? <div className="ad-preview-transport">
        <button type="button" className="ad-preview-tool-button" onClick={() => setPlayingIndex(playingIndex === selectedIndex ? null : selectedIndex)}
          aria-label={playingIndex === selectedIndex ? 'Pausar slide' : 'Reproduzir slide'} title={playingIndex === selectedIndex ? 'Pausar slide' : 'Reproduzir slide'}>
          {playingIndex === selectedIndex ? <Pause size={16} /> : <Play size={16} />}
        </button>
        {asset?.kind === 'clip' ? <button type="button" className="ad-preview-tool-button" disabled={slide?.edit?.volume === 0} onClick={() => setMuted(!muted)}
          aria-label={slide?.edit?.volume === 0 ? 'Slide sem áudio' : muted ? 'Ligar áudio do slide' : 'Desligar áudio do slide'} title={slide?.edit?.volume === 0 ? 'O áudio está desativado nos ajustes deste slide' : muted ? 'Ligar áudio do slide' : 'Desligar áudio do slide'} aria-pressed={!muted}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button> : null}
        <span className="ml-auto pr-2 text-xs text-white/50">{slide?.durationSeconds}s</span>
      </div> : null}
      <div className="ad-preview-transport">
        <button type="button" aria-label="Slide anterior" disabled={selectedIndex === 0}
          onClick={() => onIndexChange(selectedIndex - 1)} className="ad-preview-tool-button">
          <ChevronLeft size={20} />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-xs text-white/65" title={asset?.originalName}>
          {slides.length ? selectedIndex + 1 : 0} / {slides.length}{asset ? ` · ${asset.originalName}` : ''}
        </span>
        <button type="button" aria-label="Próximo slide" disabled={selectedIndex >= slides.length - 1}
          onClick={() => onIndexChange(selectedIndex + 1)} className="ad-preview-tool-button">
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="ad-preview-filmstrip" aria-label="Slides do carrossel">
        {slides.map((item, i) => <button key={`${item.assetId}:${i}`} type="button" onClick={() => onIndexChange(i)}
          aria-label={`Ver slide ${i + 1}`} aria-pressed={i === selectedIndex}
          className={`ad-preview-scene ${i === selectedIndex ? 'ad-preview-scene-active' : ''}`}>{i + 1}</button>)}
      </div>
      <details className="ad-preview-details ad-carousel-details">
        <summary>Detalhes da exportação</summary>
        <p>{config.output.width} × {config.output.height}. Os arquivos numerados seguem a ordem dos slides.</p>
        <p>Imagens estáticas viram JPG; imagens com movimento e vídeos viram MP4. Baixe o ZIP em Arquivos gerados.</p>
      </details>
    </section>
  )
}

export function CarouselEditor({
  assets,
  config,
  onChange,
  onPreview,
  onRemove,
  removingAssetId,
  uploading,
  uploadImages,
  uploadVideos,
}: {
  assets: AdAsset[]
  config: AdProjectConfig
  onChange: (config: AdProjectConfig) => void
  onPreview: (index: number) => void
  onRemove: (asset: AdAsset) => void
  removingAssetId: number | null
  uploading: boolean
  uploadImages: ReactNode
  uploadVideos: ReactNode
}) {
  const carousel = config.carousel ?? { slides: [], caption: '' }
  const dragIndex = useRef<number | null>(null)
  const [captionCopied, setCaptionCopied] = useState(false)
  const [captionCopyError, setCaptionCopyError] = useState(false)
  function slidesChanged(slides: AdCarouselSlide[]) {
    onChange({ ...config, carousel: { ...carousel, slides } })
  }
  function edit(index: number, patch: Partial<AdCarouselSlide>) {
    slidesChanged(
      carousel.slides.map((slide, i) =>
        i === index ? { ...slide, ...patch } : slide,
      ),
    )
  }
  function move(index: number, offset: number) {
    const slides = [...carousel.slides]
    ;[slides[index], slides[index + offset]] = [
      slides[index + offset],
      slides[index],
    ]
    slidesChanged(slides)
    onPreview(index + offset)
  }
  return (
    <>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold text-zinc-900">Slides do carrossel</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Combine de 2 a 20 imagens e vídeos. Todos os slides usam a mesma
          proporção.
        </p>
        <div className="my-4 grid gap-2 sm:grid-cols-2">
          {uploadImages}
          {uploadVideos}
        </div>
        <ol className="space-y-3">
          {carousel.slides.map((slide, index) => {
            const asset = assets.find((item) => item.id === slide.assetId)
            return (
              <li
                draggable={!uploading}
                onDragStart={() => { dragIndex.current = index }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const from = dragIndex.current; dragIndex.current = null
                  if (from === null || from === index || uploading) return
                  const slides = [...carousel.slides]; const [moved] = slides.splice(from, 1); slides.splice(index, 0, moved)
                  slidesChanged(slides); onPreview(index)
                }}
                onDragEnd={() => { dragIndex.current = null }}
                key={`${index}:${slide.assetId}`}
                className="rounded-xl border border-zinc-200 p-3"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPreview(index)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-violet-700"
                  >
                    {index + 1}. {asset?.originalName ?? 'Mídia indisponível'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover slide ${index + 1} para cima`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded p-1.5 disabled:opacity-25"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover slide ${index + 1} para baixo`}
                    disabled={index === carousel.slides.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded p-1.5 disabled:opacity-25"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button type="button" aria-label={`Duplicar slide ${index + 1}`} disabled={uploading || carousel.slides.length >= 20} className="rounded p-1.5 disabled:opacity-25" onClick={() => { const slides = [...carousel.slides]; slides.splice(index + 1, 0, structuredClone(slide)); slidesChanged(slides); onPreview(index + 1) }}><Copy size={16} /></button>
                  <button
                    type="button"
                    aria-label={`Remover slide ${index + 1}`}
                    onClick={() =>
                      slidesChanged(
                        carousel.slides.filter((_, i) => i !== index),
                      )
                    }
                    className="rounded p-1.5 text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <label className="mt-3 block text-xs text-zinc-600">
                  Texto do slide {index + 1} (opcional)
                  <textarea
                    value={slide.text}
                    maxLength={280}
                    rows={2}
                    onFocus={() => onPreview(index)}
                    onChange={(event) =>
                      edit(index, { text: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm"
                  />
                </label>
                {asset?.kind === 'clip' ? (
                  <label className="mt-2 block text-xs text-zinc-600">
                    Duração do vídeo {index + 1} (segundos)
                    <input
                      type="number"
                      min={3}
                      max={60}
                      step={0.5}
                      value={slide.durationSeconds}
                      onChange={(event) =>
                        edit(index, {
                          durationSeconds: Number(event.target.value),
                        })
                      }
                      className="ml-2 w-20 rounded-lg border border-zinc-300 p-1.5"
                    />
                    <span className="mt-1 block text-[11px]">
                      Vídeos curtos se repetem até completar a duração.
                    </span>
                  </label>
                ) : null}
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium text-violet-700">Recorte, áudio e enquadramento</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {asset?.kind === 'clip' ? <>{(['trimStart', 'trimEnd'] as const).map((key) => <label key={key}>{key === 'trimStart' ? 'Início do recorte (s)' : 'Fim do recorte (s)'}<input className="mt-1 w-full rounded border border-zinc-300 p-2" type="number" min={0} max={asset.durationSeconds} step={0.1} value={slide.edit?.[key] ?? (key === 'trimEnd' ? asset.durationSeconds : 0)} onChange={(e) => edit(index, { edit: { ...DEFAULT_CLIP_EDIT, ...slide.edit, [key]: Number(e.target.value) } })} /></label>)}<label>Volume<input type="range" min={0} max={1} step={0.05} value={slide.edit?.volume ?? 1} onChange={(e) => edit(index, { edit: { ...DEFAULT_CLIP_EDIT, ...slide.edit, volume: Number(e.target.value) } })} /></label><Button variant="secondary" onClick={() => edit(index, { edit: { ...DEFAULT_CLIP_EDIT, ...slide.edit, volume: slide.edit?.volume === 0 ? 1 : 0 } })}>{slide.edit?.volume === 0 ? 'Ativar áudio' : 'Silenciar'}</Button></> : <label>Movimento da imagem (exporta MP4)<select className="mt-1 w-full rounded border border-zinc-300 p-2" value={slide.edit?.motion ?? 'none'} onChange={(e) => edit(index, { edit: { ...DEFAULT_CLIP_EDIT, ...slide.edit, motion: e.target.value as NonNullable<AdCarouselSlide['edit']>['motion'] } })}><option value="none">Imagem estática JPG</option><option value="zoom-in">Zoom gradual</option><option value="zoom-out">Afastar gradual</option><option value="pan-left">Panorâmica esquerda</option><option value="pan-right">Panorâmica direita</option></select></label>}
                    <label className="col-span-full"><input type="checkbox" checked={slide.edit?.framingOverride ?? false} onChange={(e) => edit(index, { edit: { ...DEFAULT_CLIP_EDIT, ...slide.edit, framingOverride: e.target.checked } })} /> Enquadramento próprio</label>
                    {slide.edit?.framingOverride ? (['focusX', 'focusY', 'zoom'] as const).map((key) => <label key={key}>{key === 'focusX' ? 'Foco horizontal' : key === 'focusY' ? 'Foco vertical' : 'Zoom'}<input type="range" min={key === 'zoom' ? 1 : 0} max={key === 'zoom' ? 3 : 100} step={key === 'zoom' ? 0.05 : 1} value={slide.edit![key]} onChange={(e) => edit(index, { edit: { ...DEFAULT_CLIP_EDIT, ...slide.edit, [key]: Number(e.target.value) } })} /></label>) : null}
                    <label>Cor do texto<input type="color" className="ml-2" value={slide.textStyle?.fontColor ?? config.textStyle.fontColor} onChange={(e) => edit(index, { textStyle: { ...config.textStyle, ...slide.textStyle, fontColor: e.target.value } })} /></label>
                    <label>Posição do texto<input type="range" min={15} max={85} value={slide.textStyle?.positionY ?? config.textStyle.positionY} onChange={(e) => edit(index, { textStyle: { ...config.textStyle, ...slide.textStyle, positionY: Number(e.target.value) } })} /></label>
                  </div>
                  <Button variant="secondary" className="mt-2" onClick={() => slidesChanged(carousel.slides.map((s) => ({ ...s, textStyle: slide.textStyle ?? config.textStyle })))}>Aplicar estilo de texto a todos</Button>
                  <Button variant="secondary" className="mt-2" onClick={() => slidesChanged(carousel.slides.map((s) => ({ ...s, textStyle: undefined })))}>Usar estilo global em todos</Button>
                </details>
              </li>
            )
          })}
        </ol>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-zinc-700">
            Mídias do projeto ({assets.length})
          </summary>
          <div className="mt-2 space-y-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs">
                  {asset.originalName}
                </span>
                <button
                  type="button"
                  aria-label={`Adicionar ${asset.originalName} ao carrossel`}
                  disabled={uploading || carousel.slides.length >= 20}
                  onClick={() =>
                    slidesChanged([
                      ...carousel.slides,
                      {
                        assetId: asset.id,
                        text: '',
                        durationSeconds: Math.min(
                          60,
                          Math.max(3, asset.durationSeconds || 5),
                        ),
                      },
                    ])
                  }
                  className="p-1.5 text-violet-700 disabled:opacity-30"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Excluir mídia ${asset.originalName}`}
                  disabled={removingAssetId === asset.id}
                  onClick={() => onRemove(asset)}
                  className="p-1.5 text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </details>
      </section>
      <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Formato e texto</h2>
        <div className="flex flex-wrap gap-2">
          {[1350, 1080].map((height) => (
            <Button
              key={height}
              variant={
                config.output.height === height ? 'primary' : 'secondary'
              }
              onClick={() =>
                onChange({
                  ...config,
                  output: { ...config.output, width: 1080, height },
                })
              }
            >
              {height === 1350 ? 'Retrato 4:5' : 'Quadrado 1:1'}
            </Button>
          ))}
        </div>
        <label className="block text-xs font-medium">
          Enquadramento
          <select
            value={config.framing.mode}
            onChange={(event) =>
              onChange({
                ...config,
                framing: {
                  ...config.framing,
                  mode: event.target
                    .value as AdProjectConfig['framing']['mode'],
                },
              })
            }
            className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm"
          >
            <option value="cover">Preencher com recorte</option>
            <option value="contain-blur">Mostrar inteiro com desfoque</option>
            <option value="contain-solid">Mostrar inteiro com fundo</option>
          </select>
        </label>
        {config.framing.mode === 'contain-solid' ? (
          <label className="flex items-center justify-between text-xs">
            Cor do fundo
            <input
              type="color"
              value={config.framing.backgroundColor}
              onChange={(event) =>
                onChange({
                  ...config,
                  framing: {
                    ...config.framing,
                    backgroundColor: event.target.value,
                  },
                })
              }
            />
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(['focusX', 'focusY'] as const).map((key) => (
              <label key={key} className="text-xs">
                Foco {key === 'focusX' ? 'horizontal' : 'vertical'}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={config.framing[key]}
                  onChange={(event) =>
                    onChange({
                      ...config,
                      framing: {
                        ...config.framing,
                        [key]: Number(event.target.value),
                      },
                    })
                  }
                  className="mt-1 w-full accent-violet-600"
                />
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Tamanho do texto
            <input
              type="range"
              min={36}
              max={140}
              value={config.textStyle.fontSize}
              onChange={(event) =>
                onChange({
                  ...config,
                  textStyle: {
                    ...config.textStyle,
                    fontSize: Number(event.target.value),
                  },
                })
              }
              className="mt-1 w-full accent-violet-600"
            />
          </label>
          <label className="text-xs">
            Posição do texto
            <input
              type="range"
              min={15}
              max={85}
              value={config.textStyle.positionY}
              onChange={(event) =>
                onChange({
                  ...config,
                  textStyle: {
                    ...config.textStyle,
                    positionY: Number(event.target.value),
                  },
                })
              }
              className="mt-1 w-full accent-violet-600"
            />
          </label>
          <label className="flex items-center justify-between text-xs">
            Cor do texto
            <input
              type="color"
              value={config.textStyle.fontColor}
              onChange={(event) =>
                onChange({
                  ...config,
                  textStyle: {
                    ...config.textStyle,
                    fontColor: event.target.value,
                  },
                })
              }
            />
          </label>
          <label className="flex items-center justify-between text-xs">
            Contorno
            <input
              type="color"
              value={config.textStyle.borderColor}
              onChange={(event) =>
                onChange({
                  ...config,
                  textStyle: {
                    ...config.textStyle,
                    borderColor: event.target.value,
                  },
                })
              }
            />
          </label>
        </div>
      </section>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <label className="block font-semibold">
          Legenda para Instagram
          <textarea
            maxLength={2200}
            rows={4}
            value={carousel.caption}
            onChange={(event) => {
              setCaptionCopied(false)
              setCaptionCopyError(false)
              onChange({
                ...config,
                carousel: { ...carousel, caption: event.target.value },
              })
            }}
            className="mt-3 w-full rounded-xl border border-zinc-300 p-3 text-sm font-normal"
          />
        </label>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-500">
            {carousel.caption.length}/2200
          </span>
          <Button
            variant="secondary"
            disabled={!carousel.caption}
            onClick={() => {
              setCaptionCopyError(false)
              if (!navigator.clipboard) {
                setCaptionCopyError(true)
                return
              }
              void navigator.clipboard
                .writeText(carousel.caption)
                .then(() => setCaptionCopied(true))
                .catch(() => {
                  setCaptionCopied(false)
                  setCaptionCopyError(true)
                })
            }}
          >
            {captionCopied ? 'Copiada' : 'Copiar legenda'}
          </Button>
        </div>
        {captionCopyError ? (
          <p role="alert" className="mt-2 text-xs text-red-600">
            Não foi possível copiar. Selecione a legenda e copie manualmente.
          </p>
        ) : null}
      </section>
    </>
  )
}
