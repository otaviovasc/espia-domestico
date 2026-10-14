import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, ImagePlus, Layers, Shapes, Trash2, Type } from 'lucide-react'
import { adProjectApi, type AdOverlay, type AdProject, type AdProjectConfig } from '@/lib/api'
import { compositionGeometry, duplicateCompositionLayer, MAX_COMPOSITION_LAYERS, moveCompositionLayer, newCompositionLayer, wrapCompositionText } from '@/lib/adComposition'

const fieldClass = 'w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200'
const actionClass = 'rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-30'

function NumericField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="space-y-1 text-xs text-zinc-500"><span>{label}</span><input className={fieldClass} type="number" value={value} min={min} max={max} step={step} onChange={(event) => {
    const next = event.currentTarget.valueAsNumber
    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, step === 1 ? Math.round(next) : next)))
  }} /></label>
}

export function CompositionLayers({ project, config, onChange, disabled = false }: { project: AdProject; config: AdProjectConfig; onChange: (config: AdProjectConfig) => void; disabled?: boolean }) {
  const [selectedId, select] = useState<string | null>(null)
  const layers = config.overlays ?? []
  const images = project.assets.filter((asset) => asset.kind === 'image')
  const selected = layers.find((layer) => layer.id === selectedId)
  const full = layers.length >= MAX_COMPOSITION_LAYERS
  const emit = (overlays: AdOverlay[]) => onChange({ ...config, overlays })
  const patch = (id: string, changes: Partial<AdOverlay>) => emit(layers.map((layer) => layer.id === id ? { ...layer, ...changes } as AdOverlay : layer))
  function add(type: AdOverlay['type']) {
    if (full || (type === 'image' && !images.length)) return
    const layer = newCompositionLayer(type, crypto.randomUUID(), images[0]?.id)
    emit([...layers, layer]); select(layer.id)
  }
  return <details className="rounded-2xl border border-zinc-200 bg-white p-4">
    <summary className="cursor-pointer text-sm font-semibold text-zinc-900"><Layers size={16} className="mr-2 inline align-text-bottom" />Camadas <span className="ml-2 font-normal text-zinc-400">{layers.length}/{MAX_COMPOSITION_LAYERS}</span></summary>
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-60">
    <p className="mt-2 text-xs leading-5 text-zinc-500">Texto, formas e imagens sobre todos os slides ou cenas. A primeira camada da lista fica na frente.</p>
    <div className="my-3 flex flex-wrap gap-2">
      <button type="button" disabled={full} onClick={() => add('text')} className={`${actionClass} inline-flex items-center gap-1.5 border border-zinc-200 text-xs`}><Type size={14} />Texto</button>
      <button type="button" disabled={full} onClick={() => add('shape')} className={`${actionClass} inline-flex items-center gap-1.5 border border-zinc-200 text-xs`}><Shapes size={14} />Forma</button>
      <button type="button" disabled={full || !images.length} title={!images.length ? 'Adicione uma imagem ao projeto primeiro' : undefined} onClick={() => add('image')} className={`${actionClass} inline-flex items-center gap-1.5 border border-zinc-200 text-xs`}><ImagePlus size={14} />Imagem</button>
    </div>
    {!layers.length ? <p className="text-xs text-zinc-400">Adicione uma camada para destacar sua oferta ou aplicar um logo.</p> : <ul className="space-y-1">
      {[...layers].reverse().map((layer) => { const index = layers.findIndex((item) => item.id === layer.id); return <li key={layer.id} className={`flex items-center gap-1 rounded-lg border p-1 ${selectedId === layer.id ? 'border-zinc-400 bg-zinc-50' : 'border-zinc-100'}`}>
        <button type="button" onClick={() => select(selectedId === layer.id ? null : layer.id)} className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs font-medium text-zinc-700 focus-visible:outline focus-visible:outline-2" aria-expanded={selectedId === layer.id}>{layer.name || 'Camada'}{layer.hidden ? <span className="ml-1 text-zinc-400">(oculta)</span> : null}</button>
        <button type="button" className={actionClass} title="Trazer para frente" aria-label={`Trazer ${layer.name} para frente`} disabled={index === layers.length - 1} onClick={() => emit(moveCompositionLayer(layers, layer.id, 1))}><ArrowUp size={14} /></button>
        <button type="button" className={actionClass} title="Enviar para trás" aria-label={`Enviar ${layer.name} para trás`} disabled={index === 0} onClick={() => emit(moveCompositionLayer(layers, layer.id, -1))}><ArrowDown size={14} /></button>
        <button type="button" className={actionClass} title={layer.hidden ? 'Mostrar camada' : 'Ocultar camada'} aria-label={`${layer.hidden ? 'Mostrar' : 'Ocultar'} ${layer.name}`} aria-pressed={layer.hidden} onClick={() => patch(layer.id, { hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        <button type="button" className={actionClass} disabled={full} title="Duplicar camada" aria-label={`Duplicar ${layer.name}`} onClick={() => { const id = crypto.randomUUID(); emit(duplicateCompositionLayer(layers, layer.id, id)); select(id) }}><Copy size={14} /></button>
        <button type="button" className={actionClass} title="Excluir camada" aria-label={`Excluir ${layer.name}`} onClick={() => emit(layers.filter((item) => item.id !== layer.id))}><Trash2 size={14} /></button>
      </li> })}
    </ul>}
    {selected ? <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3">
      <label className="block space-y-1 text-xs text-zinc-500"><span>Nome da camada</span><input className={fieldClass} value={selected.name} maxLength={80} onChange={(event) => patch(selected.id, { name: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumericField label="X (%)" value={selected.x} min={0} max={100} step={0.1} onChange={(x) => patch(selected.id, { x })} />
        <NumericField label="Y (%)" value={selected.y} min={0} max={100} step={0.1} onChange={(y) => patch(selected.id, { y })} />
        <NumericField label="Largura (%)" value={selected.width} min={1} max={100} step={0.1} onChange={(width) => patch(selected.id, { width })} />
        <NumericField label="Altura (%)" value={selected.height} min={1} max={100} step={0.1} onChange={(height) => patch(selected.id, { height })} />
      </div>
      <NumericField label="Opacidade (%)" value={Math.round(selected.opacity * 100)} min={0} max={100} onChange={(opacity) => patch(selected.id, { opacity: opacity / 100 })} />
      {selected.type === 'text' ? <>
        <label className="block space-y-1 text-xs text-zinc-500"><span>Texto</span><textarea className={fieldClass} rows={3} value={selected.text} maxLength={280} onChange={(event) => patch(selected.id, { text: event.target.value })} /></label>
        <div className="grid grid-cols-3 gap-2">
          <NumericField label="Tamanho (px)" value={selected.fontSize} min={12} max={200} onChange={(fontSize) => patch(selected.id, { fontSize })} />
          <label className="space-y-1 text-xs text-zinc-500"><span>Cor do texto</span><input className={`${fieldClass} h-8 p-1`} type="color" value={selected.color} onChange={(event) => patch(selected.id, { color: event.target.value })} /></label>
          <label className="space-y-1 text-xs text-zinc-500"><span>Fundo</span><input className={`${fieldClass} h-8 p-1`} type="color" value={selected.backgroundColor} onChange={(event) => patch(selected.id, { backgroundColor: event.target.value })} /></label>
        </div>
        <p className="text-xs text-zinc-400">Texto que ultrapassa a caixa será cortado. Ajuste o tamanho ou a altura.</p>
      </> : selected.type === 'shape' ? <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-zinc-500"><span>Forma</span><select className={fieldClass} value={selected.shape} onChange={(event) => patch(selected.id, { shape: event.target.value as 'rectangle' | 'ellipse' })}><option value="rectangle">Retângulo</option><option value="ellipse">Elipse</option></select></label>
        <label className="space-y-1 text-xs text-zinc-500"><span>Cor</span><input type="color" className={`${fieldClass} h-8 p-1`} value={selected.color} onChange={(event) => patch(selected.id, { color: event.target.value })} /></label>
      </div> : <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-zinc-500"><span>Imagem do projeto</span><select className={fieldClass} value={selected.assetId} onChange={(event) => patch(selected.id, { assetId: Number(event.target.value) })}>{!images.some((asset) => asset.id === selected.assetId) ? <option value={selected.assetId}>Imagem indisponível</option> : null}{images.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>
        <label className="space-y-1 text-xs text-zinc-500"><span>Enquadramento</span><select className={fieldClass} value={selected.fit} onChange={(event) => patch(selected.id, { fit: event.target.value as 'contain' | 'cover' })}><option value="contain">Imagem inteira</option><option value="cover">Preencher caixa</option></select></label>
      </div>}
    </div> : null}
    </fieldset>
  </details>
}

function OverlayImage({ projectId, layer, valid }: { projectId: number; layer: Extract<AdOverlay, { type: 'image' }>; valid: boolean }) {
  const [result, setResult] = useState<{ key: string; url: string; failed: boolean } | null>(null)
  const key = `${projectId}:${layer.assetId}`
  useEffect(() => {
    if (!valid) return
    const controller = new AbortController()
    let url: string | undefined
    void adProjectApi.assetContent(projectId, layer.assetId, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setResult({ key, url, failed: false })
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, url: '', failed: true }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [projectId, layer.assetId, key, valid])
  const ready = result?.key === key ? result : null
  if (!valid || ready?.failed) return <div role="alert" className="flex h-full items-center justify-center border border-red-300 bg-red-950/80 p-1 text-center text-xs text-white">Imagem indisponível</div>
  return ready?.url ? <img src={ready.url} alt="" className="h-full w-full" style={{ objectFit: layer.fit }} /> : <div className="h-full w-full animate-pulse bg-white/10" />
}

export function CompositionOverlay({ project, config }: { project: AdProject; config: AdProjectConfig }) {
  const instanceId = useId().replace(/:/g, '')
  return <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden" aria-label="Camadas da composição">
    <style>{`@font-face { font-family: 'AdComposition'; src: url('${import.meta.env.BASE_URL}fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }`}</style>
    {(config.overlays ?? []).slice(0, MAX_COMPOSITION_LAYERS).filter((layer) => !layer.hidden && layer.opacity > 0).map((layer, index) => {
      const geometry = compositionGeometry(layer, config.output)
      if (layer.type === 'image') return <div key={layer.id} className="absolute overflow-hidden" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity }}><OverlayImage projectId={project.id} layer={layer} valid={project.assets.some((asset) => asset.id === layer.assetId && asset.kind === 'image')} /></div>
      const clipId = `composition-${instanceId}-${index}`
      const padding = layer.type === 'text' ? layer.fontSize * 0.25 : 0
      return <svg key={layer.id} viewBox={`0 0 ${config.output.width} ${config.output.height}`} className="absolute inset-0 h-full w-full" opacity={layer.opacity}>
        <defs><clipPath id={clipId}><rect {...geometry} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>
          {layer.type === 'shape' ? layer.shape === 'ellipse' ? <ellipse cx={geometry.x + geometry.width / 2} cy={geometry.y + geometry.height / 2} rx={geometry.width / 2} ry={geometry.height / 2} fill={layer.color} /> : <rect {...geometry} fill={layer.color} /> : <>
            <rect {...geometry} fill={layer.backgroundColor} />
            <text x={geometry.x + padding} y={geometry.y + padding + layer.fontSize} fill={layer.color} fontSize={layer.fontSize} fontFamily="AdComposition, DejaVu Sans, sans-serif" fontWeight="700" xmlSpace="preserve">{wrapCompositionText(layer.text, geometry.width, layer.fontSize).map((line, lineIndex) => <tspan key={lineIndex} x={geometry.x + padding} y={geometry.y + padding + layer.fontSize + lineIndex * layer.fontSize * 1.2}>{line || '\u00a0'}</tspan>)}</text>
          </>}
        </g>
      </svg>
    })}
  </div>
}

export function SafeZoneOverlay({ output }: { output: { width: number; height: number } }) {
  const vertical = output.height / output.width > 1.5
  return <div className="pointer-events-none absolute inset-0 z-20" aria-label="Guia de área segura, não aparece na exportação"><div className="absolute rounded border border-dashed border-white/80" style={{ left: '8%', right: vertical ? '16%' : '8%', top: vertical ? '14%' : '8%', bottom: vertical ? '22%' : '8%' }} /><span className="absolute left-[8%] rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90" style={{ top: vertical ? '14%' : '8%' }}>Área segura</span></div>
}
