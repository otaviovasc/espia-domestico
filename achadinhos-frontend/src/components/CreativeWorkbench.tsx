import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Download, FileJson, LayoutTemplate } from 'lucide-react'
import type { AdProject, AdProjectConfig } from '@/lib/api'
import {
  exportCreativeRecipe, MAX_RECIPE_BYTES, parseCreativeRecipe, reviewCreativeRecipe,
  stageStoryboard, STORYBOARD_GOALS,
} from '@/lib/adCreativeWorkbench'
import type { RecipeReview, StoryboardGoal } from '@/lib/adCreativeWorkbench'

export interface CreativeWorkbenchProps {
  project: AdProject
  config: AdProjectConfig
  onChange: (config: AdProjectConfig) => void
  disabled: boolean
  onError?: (message: string) => void
}
type Staged = { projectId: number; source: string; config: AdProjectConfig | null; label: string; review?: RecipeReview; ctaNote?: string }
const button = 'min-h-10 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

/** Keeps all recipes in a review stage until one explicit, undoable onChange. */
export function CreativeWorkbench({ project, config, onChange, disabled, onError }: CreativeWorkbenchProps) {
  const workbenchId = useId()
  const [goal, setGoal] = useState<StoryboardGoal>('showcase')
  const [addCta, setAddCta] = useState(false)
  const [raw, setRaw] = useState('')
  const [staged, setStaged] = useState<Staged | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reading, setReading] = useState(false)
  const latest = useRef({ project, config })
  useLayoutEffect(() => { latest.current = { project, config } }, [project, config])
  const readToken = useRef(0)
  useEffect(() => () => { readToken.current += 1 }, [])
  const source = JSON.stringify(config)
  const activeStage = staged?.projectId === project.id ? staged : null
  const stale = activeStage !== null && activeStage.source !== source

  function fail(cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Não foi possível ler a receita.'
    setError(message)
    onError?.(message)
  }
  function stageImport(text: string) {
    setError('')
    setNotice('')
    setOverwrite(false)
    setStaged(null)
    try {
      const review = reviewCreativeRecipe(parseCreativeRecipe(text), project.assets, config)
      setStaged({ projectId: project.id, source, config: review.config, label: `Receita: ${review.recipe.name}`, review })
    } catch (cause) { fail(cause) }
  }
  async function readFile(file: File) {
    const token = ++readToken.current
    const projectId = project.id
    const sourceAtRead = source
    setError('')
    setNotice('')
    setStaged(null)
    setOverwrite(false)
    if (file.size > MAX_RECIPE_BYTES) { fail(new Error('A receita deve ter até 1 MB.')); return }
    setReading(true)
    try {
      const text = await file.text()
      if (token !== readToken.current) return
      if (latest.current.project.id !== projectId || JSON.stringify(latest.current.config) !== sourceAtRead) {
        setNotice('O projeto mudou durante a leitura. Importe o arquivo novamente no projeto atual.')
        return
      }
      setRaw(text)
      const review = reviewCreativeRecipe(parseCreativeRecipe(text), latest.current.project.assets, latest.current.config)
      setStaged({ projectId, source: sourceAtRead, config: review.config, label: `Receita: ${review.recipe.name}`, review })
    } catch (cause) {
      if (token === readToken.current && latest.current.project.id === projectId) fail(cause)
    } finally { if (token === readToken.current) setReading(false) }
  }
  function exportRecipe() {
    setError('')
    try {
      const recipe = exportCreativeRecipe(project, config)
      const text = JSON.stringify(recipe, null, 2)
      setRaw(text)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'criativo'}.recipe.json`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Receita exportada. Os arquivos de mídia precisam estar disponíveis no projeto de destino.')
    } catch (cause) { fail(cause) }
  }
  const preview = activeStage?.config
  const sceneIds = preview?.kind === 'carousel'
    ? preview.carousel?.slides.map(slide => slide.assetId) ?? []
    : preview?.selectedClipIds ?? []
  return <div className="mt-4 space-y-4 text-ink [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-accent [&_summary]:focus-visible:outline-2 [&_summary]:focus-visible:outline-accent [&_input]:accent-accent">
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="min-w-0 rounded-xl border border-line bg-surface p-4" aria-labelledby={`${workbenchId}-storyboard-title`}>
        <h3 id={`${workbenchId}-storyboard-title`} className="flex items-center gap-2 text-sm font-semibold"><LayoutTemplate size={16} aria-hidden="true" /> Roteiro visual</h3>
        <p className="mt-2 text-xs text-muted">Escolha a apresentação das cenas. Mídias, recortes, trilhas e fatos dos produtos são preservados.</p>
        <div role="radiogroup" aria-label="Apresentação das cenas" className="mt-3 space-y-2">
          {STORYBOARD_GOALS.map(item => <label key={item.id} className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${goal === item.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
            <input type="radio" name={`storyboard-${project.id}`} value={item.id} checked={goal === item.id} disabled={disabled} onChange={() => setGoal(item.id)} />
            <span><span className="block text-sm font-medium">{item.name}</span><span className="block text-xs text-muted">{item.description}</span></span>
          </label>)}
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={addCta} disabled={disabled} onChange={event => setAddCta(event.target.checked)} /><span>{config.kind === 'carousel' ? 'Adicionar chamada no último slide' : 'Mostrar chamada em todas as cenas'}: “Veja os detalhes no link.” Os textos existentes são preservados.</span></label>
        <button type="button" className={`${button} mt-3`} disabled={disabled || reading} onClick={() => {
          readToken.current += 1
          setReading(false)
          setError('')
          setNotice('')
          setOverwrite(false)
          setStaged(null)
          try { setStaged({ projectId: project.id, source, config: stageStoryboard(config, goal, addCta), label: STORYBOARD_GOALS.find(item => item.id === goal)!.name, ...(addCta ? { ctaNote: config.kind === 'carousel' ? 'A chamada será acrescentada ao texto do último slide.' : 'A chamada aparecerá como uma camada de texto em todas as cenas do vídeo.' } : {}) }) } catch (cause) { fail(cause) }
        }}>Revisar roteiro</button>
      </section>
      <section className="min-w-0 rounded-xl border border-line bg-surface p-4" aria-labelledby={`${workbenchId}-json-title`}>
        <h3 id={`${workbenchId}-json-title`} className="flex items-center gap-2 text-sm font-semibold"><FileJson size={16} aria-hidden="true" /> Receita editável</h3>
        <p className="mt-2 text-xs text-muted">JSON versão 1 com textos, estilos, recortes e nomes das mídias. Não inclui arquivos, IDs de produtos, credenciais ou endereços das mídias. Limite de 1 MB.</p>
        <button type="button" className={`${button} mt-3 inline-flex items-center gap-2`} disabled={disabled || reading} onClick={exportRecipe}><Download size={15} aria-hidden="true" /> Exportar receita</button>
        <label className="mt-3 block text-xs font-medium">Importar arquivo JSON
          <input type="file" accept=".json,application/json" disabled={disabled || reading} className="mt-1 block min-h-10 w-full rounded-lg border border-line-strong bg-surface p-2 text-xs text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-2 file:py-1 file:text-ink focus-visible:outline-2 focus-visible:outline-accent" onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void readFile(file)
          }} />
        </label>
        <details className="mt-3 rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-xs font-medium">Colar ou editar receita JSON</summary>
        <label className="mt-3 block text-xs font-medium">Editar JSON antes de revisar
          <textarea rows={5} value={raw} maxLength={MAX_RECIPE_BYTES} disabled={disabled || reading} onChange={event => {
            setRaw(event.target.value)
            setStaged(null)
            setOverwrite(false)
          }} spellCheck={false} className="mt-1 w-full rounded-lg border border-line-strong bg-surface p-3 font-mono text-xs text-ink focus:outline-2 focus:outline-accent" />
        </label>
        <button type="button" className={`${button} mt-2`} disabled={disabled || reading || !raw.trim()} onClick={() => stageImport(raw)}>Revisar importação</button>
        </details>
        {reading ? <p role="status" className="mt-2 text-xs">Lendo receita…</p> : null}
      </section>
    </div>
    {error ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-muted">{notice}</p> : null}
    {activeStage ? <section className="rounded-xl border border-accent bg-accent-soft/50 p-4" aria-labelledby={`${workbenchId}-review-title`}>
      <h3 id={`${workbenchId}-review-title`} className="text-sm font-semibold">Revisão: {activeStage.label}</h3>
      <p className="mt-1 text-xs text-muted">Aplicar substitui a configuração editável deste projeto. Os produtos vinculados ao projeto atual permanecem. Você poderá desfazer a alteração no editor.</p>
      {activeStage.ctaNote ? <p className="mt-2 text-xs font-medium text-accent">{activeStage.ctaNote}</p> : null}
      {activeStage.review ? <div className="mt-3 space-y-1">
        <p className="text-xs font-medium">{activeStage.review.matches.filter(match => !match.issue).length} de {activeStage.review.matches.length} mídias encontradas</p>
        {activeStage.review.matches.map(match => <p key={match.media.key} className={`break-all text-xs ${match.issue ? 'text-danger' : 'text-muted'}`}>
          {match.media.filename}: {match.issue === 'ambiguous' ? 'nome duplicado; renomeie os arquivos' : match.issue === 'missing' ? 'ausente ou metadados diferentes; envie a mídia correspondente' : 'vinculada à mídia atual'}
        </p>)}
        {!activeStage.config ? <p role="alert" className="text-xs text-danger">A importação está bloqueada até todas as mídias terem uma correspondência única. Depois de enviar ou renomear arquivos, revise novamente.</p> : null}
      </div> : null}
      {preview ? <>
        <p className="mt-3 text-xs font-medium">{preview.output.width}×{preview.output.height} · {preview.output.durationSeconds} s · {preview.transition.preset} · {preview.timing.mode === 'fixed' ? `${preview.timing.seconds} s por cena` : 'ritmo da música'}</p>
        {preview.audioFinishing?.normalizeLoudness ? <p className="mt-1 text-xs">Normalização de volume: {preview.audioFinishing.targetLufs} LUFS</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {sceneIds.map((assetId, index) => <div key={`${assetId}-${index}`} className="min-w-0 rounded-lg border border-line bg-surface p-3">
            <p className="text-xs text-accent">Cena {index + 1}</p>
            <p className="mt-1 truncate text-xs font-medium">{project.assets.find(asset => asset.id === assetId)?.originalName ?? 'Mídia indisponível'}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink">{preview.kind === 'carousel' ? preview.carousel?.slides[index].text || 'Sem texto' : preview.texts[index % preview.texts.length]}</p>
          </div>)}
        </div>
        <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Textos, camadas e legenda da receita</summary><div className="mt-2 space-y-2">{preview.texts.map((text, index) => <p key={index} className="whitespace-pre-wrap break-words">{text}</p>)}{preview.hook.enabled && preview.hook.text ? <p className="whitespace-pre-wrap break-words">Abertura: {preview.hook.text}</p> : null}{preview.overlays?.map(layer => <p key={layer.id} className="whitespace-pre-wrap break-words">Camada {layer.name}{layer.hidden ? ' (oculta)' : ''}: {layer.type === 'text' ? layer.text : layer.type === 'image' ? project.assets.find(asset => asset.id === layer.assetId)?.originalName : layer.shape}</p>)}{preview.carousel?.caption ? <p className="whitespace-pre-wrap break-words">Legenda: {preview.carousel.caption}</p> : null}</div></details>
      </> : null}
      {stale ? <p role="alert" className="mt-3 text-xs text-warning">O projeto mudou depois desta revisão. Revise novamente antes de aplicar.</p> : null}
      <label className="mt-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={overwrite} disabled={disabled || stale || !activeStage.config} onChange={event => setOverwrite(event.target.checked)} />Revisei os textos e autorizo substituir a configuração atual.</label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-10 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled || reading || stale || !overwrite || !activeStage.config} onClick={() => {
          if (!activeStage.config || activeStage.projectId !== latest.current.project.id || activeStage.source !== JSON.stringify(latest.current.config)) return
          onChange(structuredClone(activeStage.config))
          setStaged(null)
          setOverwrite(false)
          setNotice('Configuração aplicada. Use Desfazer no editor para restaurar a anterior.')
        }}>Aplicar ao projeto atual</button>
        <button type="button" className={button} disabled={disabled} onClick={() => { setStaged(null); setOverwrite(false) }}>Descartar revisão</button>
      </div>
    </section> : null}
  </div>
}

export default CreativeWorkbench
