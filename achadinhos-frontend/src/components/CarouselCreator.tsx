import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Image,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  adProjectApi,
  type AdAsset,
  type AdCarouselSlide,
  type AdProject,
  type AdProjectConfig,
} from '@/lib/api'
import { Button } from '@/components/ui'
import { previewClipGeometry } from '@/lib/adPreviewFraming'

function CarouselMedia({
  projectId,
  asset,
  config,
  durationSeconds,
}: {
  projectId: number
  asset: AdAsset
  config: AdProjectConfig
  durationSeconds: number
}) {
  const background = useRef<HTMLVideoElement>(null)
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
  const framing = config.framing
  const geometry = previewClipGeometry(
    config.output,
    asset,
    framing.mode,
    framing.focusX,
    framing.focusY,
    1,
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
          src={url}
          controls
          playsInline
          loop={asset.durationSeconds < durationSeconds}
          onPlay={() => {
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
            if (event.currentTarget.currentTime >= durationSeconds) {
              event.currentTarget.pause()
              event.currentTarget.currentTime = 0
            }
          }}
        />
      )}
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
  const slides = config.carousel?.slides ?? []
  const selectedIndex = Math.min(index, Math.max(0, slides.length - 1))
  const slide = slides[selectedIndex]
  const asset = project.assets.find((item) => item.id === slide?.assetId)
  const captionInput = JSON.stringify({
    texts: slide?.text.trim() ? [slide.text.trim()] : [],
    output: config.output,
    textStyle: config.textStyle,
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
    <section className="ad-stage-panel">
      <div className="p-5 text-white">
        <h2 className="font-semibold">Prévia do carrossel</h2>
        <p className="mt-1 text-xs text-white/60">
          {config.output.width}×{config.output.height} · {slides.length} de 20
          slides
        </p>
      </div>
      <div className="mx-auto w-full max-w-[360px] px-4">
        <div
          className="relative overflow-hidden rounded-xl"
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
        <div className="my-4 flex items-center justify-between text-white">
          <button
            type="button"
            aria-label="Slide anterior"
            disabled={selectedIndex === 0}
            onClick={() => onIndexChange(selectedIndex - 1)}
            className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm">
            {slides.length ? selectedIndex + 1 : 0} / {slides.length}
          </span>
          <button
            type="button"
            aria-label="Próximo slide"
            disabled={selectedIndex >= slides.length - 1}
            onClick={() => onIndexChange(selectedIndex + 1)}
            className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <p className="pb-5 text-xs leading-5 text-white/60">
          Exporte os slides e selecione os arquivos numerados nessa ordem no
          Instagram. Imagens viram JPG; vídeos viram MP4 com o áudio original.
        </p>
      </div>
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
