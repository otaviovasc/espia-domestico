import { memo, useMemo, useState, type DragEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Clock3,
  Film,
  Focus,
  Gauge,
  GripVertical,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import type {
  AdAsset,
  AdClipEdit,
  AdClipSpeed,
  AdProjectConfig,
  AdTransitionPreset,
  AdTransitionSfx,
} from '@/lib/api'
import {
  clipSequenceValidation,
  DEFAULT_TRANSITION,
  getAdClipEdit,
  MIN_TRIMMED_DURATION,
} from '@/lib/adClipConfig'

const SPEEDS: AdClipSpeed[] = [0.5, 0.75, 1, 1.25, 1.5, 2]
const MAX_TRIM_SECONDS = 3600
const TIMELINE_COLORS = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500']

const TRANSITIONS: Array<{
  id: AdTransitionPreset
  label: string
  description: string
}> = [
  { id: 'cut', label: 'Corte seco', description: 'Direto e rápido' },
  { id: 'fade', label: 'Fade', description: 'Entrada suave' },
  { id: 'dissolve', label: 'Dissolver', description: 'Mistura as cenas' },
  { id: 'slide-left', label: 'Deslizar', description: 'Movimento lateral' },
  { id: 'slide-up', label: 'Subir', description: 'Movimento vertical' },
  { id: 'zoom', label: 'Zoom', description: 'Pulso de aproximação' },
]

const SFX_OPTIONS: Array<{ id: AdTransitionSfx; label: string }> = [
  { id: 'none', label: 'Sem efeito' },
  { id: 'whoosh', label: 'Whoosh' },
  { id: 'pop', label: 'Pop' },
  { id: 'click', label: 'Click' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function seconds(value: number): string {
  if (value >= 60) {
    const minutes = Math.floor(value / 60)
    return `${minutes}min ${Math.round(value % 60)}s`
  }
  return `${value.toFixed(value < 10 ? 1 : 0)}s`
}

function clipEdit(config: AdProjectConfig, assetId: number): AdClipEdit {
  return getAdClipEdit(config, assetId)
}

function availableDuration(asset: AdAsset, edit: AdClipEdit): number {
  const sourceEnd = edit.trimEnd ?? asset.durationSeconds
  return Math.max(0, sourceEnd - edit.trimStart) / edit.speed
}

function withClipEdit(
  config: AdProjectConfig,
  asset: AdAsset,
  patch: Partial<AdClipEdit>,
): AdProjectConfig {
  const current = clipEdit(config, asset.id)
  const sourceDuration = Math.min(MAX_TRIM_SECONDS, Math.max(0.1, asset.durationSeconds))
  const next = { ...current, ...patch }
  next.trimStart = clamp(next.trimStart, 0, Math.max(0, (next.trimEnd ?? sourceDuration) - MIN_TRIMMED_DURATION))
  next.trimEnd = next.trimEnd === null
    ? null
    : clamp(next.trimEnd, next.trimStart + MIN_TRIMMED_DURATION, sourceDuration)
  next.focusX = Math.round(clamp(next.focusX, 0, 100))
  next.focusY = Math.round(clamp(next.focusY, 0, 100))
  next.zoom = clamp(next.zoom, 1, 3)
  return {
    ...config,
    clipEdits: { ...(config.clipEdits ?? {}), [String(asset.id)]: next },
  }
}

interface ClipSequenceEditorProps {
  assets: AdAsset[]
  config: AdProjectConfig
  onChange: (config: AdProjectConfig) => void
  onRemove?: (asset: AdAsset) => void
  removingAssetId?: number | null
}

function ClipSequenceEditor({
  assets,
  config,
  onChange,
  onRemove,
  removingAssetId = null,
}: ClipSequenceEditorProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const selectedSet = useMemo(() => new Set(config.selectedClipIds), [config.selectedClipIds])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const selectableIds = useMemo(
    () => assets.filter((asset) => asset.durationSeconds >= MIN_TRIMMED_DURATION).map((asset) => asset.id),
    [assets],
  )
  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id))
  const ordered = useMemo(() => {
    const selected = config.selectedClipIds
      .map((id) => assetById.get(id))
      .filter((asset): asset is AdAsset => Boolean(asset))
    const unselected = assets.filter((asset) => !selectedSet.has(asset.id))
    return [...selected, ...unselected]
  }, [assetById, assets, config.selectedClipIds, selectedSet])
  const selectedDuration = useMemo(() => config.selectedClipIds.reduce((total, id) => {
    const asset = assetById.get(id)
    return asset ? total + availableDuration(asset, clipEdit(config, id)) : total
  }, 0), [assetById, config])
  const validationError = clipSequenceValidation(assets, config)
  const timeline = useMemo(() => {
    const total = Math.max(0.1, config.output.durationSeconds)
    const interval = config.timing.mode === 'fixed' ? config.timing.seconds : 2.5
    const cuts = [0]
    for (let time = interval; time < total - 0.1; time += interval) cuts.push(time)
    cuts.push(total)
    const hookId = config.hook?.enabled
      ? config.hook.clipAssetId ?? config.selectedClipIds[0]
      : undefined
    const hookAsset = hookId === undefined ? undefined : assetById.get(hookId)
    if (hookAsset && config.hook) {
      const hookEnd = Math.min(total, config.hook.durationSeconds)
      if (hookEnd >= total - 0.1) cuts.splice(1, cuts.length - 1, total)
      else cuts.splice(1, cuts.length - 1, hookEnd, ...cuts.slice(1).filter((cut) => cut > hookEnd + 0.1))
    }
    const clipOrder = hookAsset
      ? [hookAsset, ...config.selectedClipIds.filter((id) => id !== hookAsset.id).map((id) => assetById.get(id)).filter((asset): asset is AdAsset => Boolean(asset))]
      : config.selectedClipIds.map((id) => assetById.get(id)).filter((asset): asset is AdAsset => Boolean(asset))
    const segments = cuts.slice(0, -1).flatMap((start, index) => {
      const asset = clipOrder[index % clipOrder.length]
      if (!asset) return []
      const segmentSeconds = cuts[index + 1] - start
      const isHook = Boolean(hookAsset && index === 0)
      return [{
        key: `scene:${index}`,
        label: `${isHook ? 'Gancho' : `Cena ${index + 1}`} · ${asset.originalName} · ${seconds(segmentSeconds)}`,
        seconds: segmentSeconds,
        className: isHook ? 'bg-fuchsia-500' : TIMELINE_COLORS[index % TIMELINE_COLORS.length],
      }]
    })
    const shortestScene = cuts.slice(1).reduce((shortest, end, index) => Math.min(shortest, end - cuts[index]), total)
    return { total, segments, estimated: config.timing.mode === 'beat', shortestScene }
  }, [assetById, config])

  function replaceOrder(ids: number[]) {
    onChange({ ...config, selectedClipIds: ids })
  }

  function toggle(assetId: number) {
    replaceOrder(selectedSet.has(assetId)
      ? config.selectedClipIds.filter((id) => id !== assetId)
      : [...config.selectedClipIds, assetId])
  }

  function move(assetId: number, direction: -1 | 1) {
    const from = config.selectedClipIds.indexOf(assetId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= config.selectedClipIds.length) return
    const next = [...config.selectedClipIds]
    const target = next[to]
    next[to] = next[from]
    next[from] = target
    replaceOrder(next)
  }

  function dropOn(targetId: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (draggingId === null || draggingId === targetId) return
    const next = config.selectedClipIds.filter((id) => id !== draggingId)
    const targetIndex = next.indexOf(targetId)
    if (targetIndex < 0) return
    next.splice(targetIndex, 0, draggingId)
    replaceOrder(next)
    setDraggingId(null)
  }

  function resetEdit(assetId: number) {
    const edits = { ...(config.clipEdits ?? {}) }
    delete edits[String(assetId)]
    onChange({ ...config, clipEdits: edits })
  }

  const transition = { ...DEFAULT_TRANSITION, ...(config.transition ?? {}) }
  const effectiveTransitionSeconds = Math.min(transition.durationSeconds, Math.max(0.1, timeline.shortestScene - 0.05))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs text-zinc-600">
          <Clock3 size={14} className="text-violet-600" />
          <span><strong className="text-zinc-800">{config.selectedClipIds.length}</strong> selecionados</span>
          <span aria-hidden="true" className="text-zinc-300">•</span>
          <span><strong className="text-zinc-800">{seconds(selectedDuration)}</strong> disponíveis</span>
          <span aria-hidden="true" className="text-zinc-300">→</span>
          <span><strong className="text-zinc-800">{seconds(config.output.durationSeconds)}</strong> no anúncio</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          {config.selectedClipIds.length > 1 ? (
            <button type="button" onClick={() => replaceOrder([...config.selectedClipIds].reverse())} className="text-zinc-600 hover:text-violet-700">
              Inverter ordem
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => replaceOrder(allSelectableSelected ? [] : selectableIds)}
            className="text-violet-700 hover:text-violet-900"
          >
            {allSelectableSelected ? 'Limpar seleção' : 'Selecionar todos'}
          </button>
        </div>
      </div>
      {validationError ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">{validationError} Ajuste o corte antes de salvar ou gerar.</p> : null}
      {config.selectedClipIds.length > 0 ? (
        <div className="mb-3 rounded-xl border border-zinc-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
            <span className="font-semibold text-zinc-700">Cenas {timeline.estimated ? 'estimadas' : 'planejadas'}</span>
            <span className="text-zinc-600">{seconds(timeline.total)} finais</span>
          </div>
          <div
            role="img"
            aria-label={`Linha do tempo de ${seconds(timeline.total)} com ${timeline.segments.map((segment) => segment.label).join(', ')}`}
            className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200"
          >
            {timeline.segments.map((segment) => (
              <span
                key={segment.key}
                title={segment.label}
                className={`h-full border-r border-white/50 last:border-r-0 ${segment.className}`}
                style={{ width: `${(segment.seconds / timeline.total) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600">
            {timeline.segments.map((segment) => <span key={segment.key}>{segment.label}</span>)}
          </div>
          {timeline.estimated ? <p className="mt-2 text-[11px] text-amber-700">No modo batida, o render ajusta os cortes à música. Esta linha mostra intervalos de 2,5 s apenas para orientar a edição.</p> : null}
        </div>
      ) : null}

      {ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center">
          <Film size={24} className="mx-auto text-zinc-300" />
          <p className="mt-2 text-sm font-medium text-zinc-600">Nenhum clipe enviado</p>
          <p className="mt-1 text-xs text-zinc-400">Adicione vídeos para montar a sequência.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordered.map((asset) => {
            const selected = selectedSet.has(asset.id)
            const position = config.selectedClipIds.indexOf(asset.id)
            const edit = clipEdit(config, asset.id)
            const expanded = selected && expandedId === asset.id
            const customized = Boolean(config.clipEdits?.[String(asset.id)])
            const effectiveDuration = availableDuration(asset, edit)
            const tooShort = asset.durationSeconds < MIN_TRIMMED_DURATION
            const displayedFocusX = edit.framingOverride ? edit.focusX : config.framing.focusX
            const displayedFocusY = edit.framingOverride ? edit.focusY : config.framing.focusY
            const displayedZoom = edit.framingOverride ? edit.zoom : 1
            return (
              <div
                key={asset.id}
                onDragOver={(event) => selected && event.preventDefault()}
                onDrop={(event) => selected && dropOn(asset.id, event)}
                className={`overflow-hidden rounded-xl border transition ${
                  draggingId === asset.id
                    ? 'border-violet-400 bg-violet-50 opacity-60'
                    : selected
                      ? 'border-violet-200 bg-white'
                      : 'border-zinc-200 bg-white opacity-75'
                }`}
              >
                <div className="flex items-center gap-2.5 p-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(asset.id)}
                    disabled={!selected && tooShort}
                    aria-pressed={selected}
                    aria-label={selected ? `Retirar ${asset.originalName} da sequência` : `Adicionar ${asset.originalName} à sequência`}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 ${selected ? 'border-violet-600 bg-violet-600 text-white' : 'border-zinc-300 text-transparent hover:border-violet-400'}`}
                  >
                    <Check size={15} />
                  </button>
                  {selected ? (
                    <span
                      draggable
                      onDragStart={() => setDraggingId(asset.id)}
                      onDragEnd={() => setDraggingId(null)}
                      className="hidden shrink-0 cursor-grab rounded p-0.5 text-zinc-300 active:cursor-grabbing sm:block"
                      title="Arraste para reordenar"
                    ><GripVertical size={16} aria-hidden="true" /></span>
                  ) : null}
                  <div className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
                    {selected ? <span className="text-xs font-bold">{position + 1}</span> : <Film size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-zinc-800" title={asset.originalName}>{asset.originalName}</span>
                      {customized ? <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">Editado</span> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {tooShort ? 'Curto demais para usar' : `${seconds(effectiveDuration)} a ${edit.speed}×`}
                      {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                    </div>
                  </div>
                  {selected ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button type="button" onClick={() => move(asset.id, -1)} disabled={position === 0} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-violet-700 disabled:opacity-25" aria-label={`Mover ${asset.originalName} para cima`}><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => move(asset.id, 1)} disabled={position === config.selectedClipIds.length - 1} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-violet-700 disabled:opacity-25" aria-label={`Mover ${asset.originalName} para baixo`}><ArrowDown size={14} /></button>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : asset.id)}
                        aria-expanded={expanded}
                        className={`rounded-lg p-1.5 ${expanded ? 'bg-violet-50 text-violet-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'}`}
                        aria-label={`Editar ${asset.originalName}`}
                      ><ChevronsUpDown size={15} /></button>
                    </div>
                  ) : null}
                  {onRemove ? (
                    <button type="button" disabled={removingAssetId === asset.id} onClick={() => onRemove(asset)} className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label={`Excluir ${asset.originalName}`}><Trash2 size={15} /></button>
                  ) : null}
                </div>

                {expanded ? (
                  <div className="border-t border-zinc-100 bg-zinc-50/70 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700"><Scissors size={14} className="text-violet-600" /> Corte e velocidade</span>
                      <button type="button" onClick={() => resetEdit(asset.id)} disabled={!customized} className="flex items-center gap-1 text-[11px] font-semibold text-violet-700 disabled:text-zinc-300"><RotateCcw size={12} /> Restaurar</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <label className="text-[11px] font-medium text-zinc-600">
                        Início
                        <span className="relative mt-1 block"><input type="number" min={0} max={Math.max(0, Math.min(MAX_TRIM_SECONDS, edit.trimEnd ?? asset.durationSeconds) - MIN_TRIMMED_DURATION)} step={0.05} value={edit.trimStart} aria-describedby={`clip-${asset.id}-trim-start-help`} onChange={(event) => onChange(withClipEdit(config, asset, { trimStart: Number(event.target.value) }))} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-7 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                        <span id={`clip-${asset.id}-trim-start-help`} className="mt-1 block text-[11px] font-normal text-zinc-600">De 0 a {Math.max(0, Math.min(MAX_TRIM_SECONDS, edit.trimEnd ?? asset.durationSeconds) - MIN_TRIMMED_DURATION).toFixed(2)}s</span>
                      </label>
                      <label className="text-[11px] font-medium text-zinc-600">
                        Fim
                        <span className="relative mt-1 block"><input type="number" min={edit.trimStart + MIN_TRIMMED_DURATION} max={Math.min(MAX_TRIM_SECONDS, asset.durationSeconds)} step={0.05} placeholder={asset.durationSeconds.toFixed(1)} value={edit.trimEnd ?? ''} aria-describedby={`clip-${asset.id}-trim-end-help`} onChange={(event) => onChange(withClipEdit(config, asset, { trimEnd: event.target.value === '' ? null : Number(event.target.value) }))} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-7 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                        <span id={`clip-${asset.id}-trim-end-help`} className="mt-1 block text-[11px] font-normal text-zinc-600">Vazio usa o fim · máximo {Math.min(MAX_TRIM_SECONDS, asset.durationSeconds).toFixed(2)}s</span>
                      </label>
                      <label className="col-span-2 text-[11px] font-medium text-zinc-600 sm:col-span-1">
                        <span className="flex items-center gap-1"><Gauge size={12} /> Velocidade</span>
                        <select value={edit.speed} onChange={(event) => onChange(withClipEdit(config, asset, { speed: Number(event.target.value) as AdClipSpeed }))} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-violet-500">
                          {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×{speed === 1 ? ' · original' : ''}</option>)}
                        </select>
                      </label>
                    </div>
                    {effectiveDuration * edit.speed < MIN_TRIMMED_DURATION ? <p role="alert" className="mt-2 text-[11px] font-medium text-red-600">O trecho de origem precisa ter pelo menos 0,25 segundo.</p> : null}

                    <div className="mt-4 border-t border-zinc-200 pt-3">
                      <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold text-zinc-700">
                        <span className="flex items-center gap-1.5"><Focus size={14} className="text-violet-600" /> Enquadramento deste clipe</span>
                        <button
                          type="button"
                          aria-pressed={edit.framingOverride}
                          onClick={() => onChange(withClipEdit(config, asset, {
                            framingOverride: !edit.framingOverride,
                            ...(!edit.framingOverride
                              ? { focusX: config.framing.focusX, focusY: config.framing.focusY, zoom: 1 }
                              : { focusX: 50, focusY: 50, zoom: 1 }),
                          }))}
                          className={`rounded-full px-2 py-1 text-[10px] font-semibold ${edit.framingOverride ? 'bg-violet-100 text-violet-700' : 'bg-zinc-200 text-zinc-600'}`}
                        >{edit.framingOverride ? 'Usar ajuste geral' : 'Personalizar neste clipe'}</button>
                      </div>
                      <div className={`grid gap-3 sm:grid-cols-2 ${edit.framingOverride ? '' : 'opacity-45'}`}>
                        <label className="text-[11px] font-medium text-zinc-600">Horizontal <span className="float-right text-zinc-400">{displayedFocusX}%</span><input disabled={!edit.framingOverride} type="range" min={0} max={100} value={displayedFocusX} onChange={(event) => onChange(withClipEdit(config, asset, { framingOverride: true, focusX: Number(event.target.value) }))} className="mt-1.5 w-full accent-violet-600 disabled:cursor-not-allowed" /></label>
                        <label className="text-[11px] font-medium text-zinc-600">Vertical <span className="float-right text-zinc-400">{displayedFocusY}%</span><input disabled={!edit.framingOverride} type="range" min={0} max={100} value={displayedFocusY} onChange={(event) => onChange(withClipEdit(config, asset, { framingOverride: true, focusY: Number(event.target.value) }))} className="mt-1.5 w-full accent-violet-600 disabled:cursor-not-allowed" /></label>
                        <label className="text-[11px] font-medium text-zinc-600 sm:col-span-2">Zoom <span className="float-right text-zinc-400">{displayedZoom.toFixed(2)}×</span><input disabled={!edit.framingOverride} type="range" min={1} max={3} step={0.05} value={displayedZoom} onChange={(event) => onChange(withClipEdit(config, asset, { framingOverride: true, zoom: Number(event.target.value) }))} className="mt-1.5 w-full accent-violet-600 disabled:cursor-not-allowed" /></label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800"><Sparkles size={14} className="text-violet-600" /> Transição entre clipes</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">O efeito aparece a cada troca de cena.</p>
          </div>
          {transition.preset !== 'cut' ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{effectiveTransitionSeconds.toFixed(2)}s no vídeo</span> : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {TRANSITIONS.map((item) => {
            const selected = transition.preset === item.id
            return (
              <button key={item.id} type="button" aria-pressed={selected} onClick={() => onChange({ ...config, transition: { ...transition, preset: item.id } })} className={`rounded-lg border px-2 py-2 text-left ${selected ? 'border-violet-500 bg-white ring-1 ring-violet-100' : 'border-zinc-200 bg-white hover:border-violet-300'}`}>
                <span className="block text-[11px] font-semibold text-zinc-800">{item.label}</span>
                <span className="mt-0.5 block text-[11px] text-zinc-600">{item.description}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {transition.preset !== 'cut' ? (
            <label className="text-[11px] font-medium text-zinc-600">Duração <span className="float-right text-zinc-400">{transition.durationSeconds.toFixed(2)}s</span><input type="range" min={0.1} max={1.5} step={0.05} value={transition.durationSeconds} onChange={(event) => onChange({ ...config, transition: { ...transition, durationSeconds: Number(event.target.value) } })} className="mt-1.5 w-full accent-violet-600" /></label>
          ) : <div className="hidden sm:block" />}
          <label className="text-[11px] font-medium text-zinc-600">
            <span className="flex items-center gap-1"><Volume2 size={12} /> Efeito sonoro</span>
            <select value={transition.sfx} onChange={(event) => onChange({ ...config, transition: { ...transition, sfx: event.target.value as AdTransitionSfx } })} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-violet-500">
              {SFX_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          {transition.sfx !== 'none' ? (
            <label className="text-[11px] font-medium text-zinc-600 sm:col-start-2">Volume do efeito <span className="float-right text-zinc-400">{Math.round(transition.sfxVolume * 100)}%</span><input type="range" min={0} max={0.5} step={0.01} value={transition.sfxVolume} onChange={(event) => onChange({ ...config, transition: { ...transition, sfxVolume: Number(event.target.value) } })} className="mt-1.5 w-full accent-violet-600" /></label>
          ) : null}
        </div>
        {transition.preset !== 'cut' && effectiveTransitionSeconds < transition.durationSeconds - 0.001 ? (
          <p className="mt-2 text-[11px] text-amber-700">A cena mais curta limita a transição a {effectiveTransitionSeconds.toFixed(2)} s no vídeo final.</p>
        ) : null}
      </div>
    </div>
  )
}

export default memo(ClipSequenceEditor)
