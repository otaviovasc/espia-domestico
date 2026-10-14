import { useMemo, useRef, useState } from 'react'
import { Image, Film, Music, Check } from 'lucide-react'
import { Button } from '@/components/ui'
import { adProjectApi, apiErrorMessage } from '@/lib/api'
import type { AdProject, AdProjectConfig } from '@/lib/api'
import { studioApi } from '@/lib/adStudioApi'
import { attachMediaLibrarySelection, createLibraryRequestStore, filterMediaLibrary, hasPossibleMediaCopy, libraryAssetIsSelected, preflightMediaLibrary } from '@/lib/adMediaLibrary'
import type { MediaLibraryKind, MediaLibraryRecord } from '@/lib/adMediaLibrary'

const kinds: { kind: MediaLibraryKind; label: string }[] = [
  { kind: 'all', label: 'Todas' }, { kind: 'image', label: 'Imagens' },
  { kind: 'clip', label: 'Vídeos' }, { kind: 'music', label: 'Músicas' },
]

export function MediaLibraryPicker({ records, loading, search, onSearch, project, config, name, disabled,
  onBusy, onChange, onProject, onError, onEdit, onDelete,
}: {
  records: MediaLibraryRecord[]; loading: boolean; search: string; onSearch: (value: string) => void
  project: AdProject; config: AdProjectConfig; name: string; disabled: boolean
  onBusy: (value: boolean) => void; onChange: (config: AdProjectConfig) => void
  onProject: (project: AdProject) => Promise<void>; onError: (message: string) => void
  onEdit: (record: MediaLibraryRecord) => void; onDelete: (record: MediaLibraryRecord) => void
}) {
  const [kind, setKind] = useState<MediaLibraryKind>('all')
  const [selected, setSelected] = useState<MediaLibraryRecord[]>([])
  const [attached, setAttached] = useState<number[]>([])
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryPending, setRecoveryPending] = useState(false)
  const requestKeys = useMemo(() => createLibraryRequestStore({
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
  }, project.id), [project.id])
  const active = useRef(false)
  const visible = filterMediaLibrary(records, search, kind)
  let limitError = ''
  try {
    // Retry preflight must reconcile pending receipts against server state first.
    if (!selected.some((record) => requestKeys.peek(record.id)))
      preflightMediaLibrary(config, selected.map((record) => record.payload))
  }
  catch (error) { limitError = apiErrorMessage(error) }
  const locked = disabled || busy

  function toggle(record: MediaLibraryRecord) {
    setSelected((current) => current.some((item) => item.id === record.id)
      ? current.filter((item) => item.id !== record.id) : [...current, record])
  }

  async function attachSelected() {
    if (active.current || locked || !selected.length || limitError) return
    active.current = true
    setBusy(true)
    onBusy(true)
    const total = selected.length
    setProgress(`Adicionando 0 de ${total}…`)
    try {
      const result = await attachMediaLibrarySelection({ project, config, records: selected,
        requestKeys,
        loadProject: () => adProjectApi.get(project.id),
        attach: (recordId, requestKey) => studioApi.attach(project.id, recordId, requestKey),
        save: (next, expectedRevision) => adProjectApi.update(project.id, { name: name.trim(), config: next, expectedRevision }),
        remove: (assetId) => adProjectApi.removeAsset(project.id, assetId),
        recoverPersisted: async (assetId) => {
          const fresh = await adProjectApi.get(project.id)
          return libraryAssetIsSelected(fresh.config, assetId) ? fresh : null
        },
        onSaved: async (recordId, saved, completed) => {
          setSelected((current) => current.filter((item) => item.id !== recordId))
          setAttached((current) => [...current, recordId])
          setProgress(`Adicionando ${completed} de ${total}…`)
          onChange(saved.config)
          await onProject(saved)
        },
      })
      if (result.error) {
        setRecoveryPending(Boolean(result.cleanupError))
        setProgress(`${result.completedIds.length} de ${total} adicionadas. A seleção restante foi mantida para tentar novamente.`)
        onError(`${apiErrorMessage(result.error)}${result.cleanupError ? ' A solicitação foi preservada. Tente novamente para conferir a mesma cópia no servidor.' : ''}`)
      } else {
        setRecoveryPending(false)
        setProgress(`${result.completedIds.length} mídias adicionadas na ordem selecionada.`)
      }
    } catch (error) { onError(apiErrorMessage(error)) }
    finally { active.current = false; setBusy(false); onBusy(false) }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <input className="min-w-0 flex-1 rounded-lg border border-zinc-300 p-2 text-sm" aria-label="Buscar biblioteca de mídias"
        placeholder="Buscar nome, tags ou produto" value={search} disabled={locked} onChange={(event) => onSearch(event.target.value)} />
      <span className="text-xs text-zinc-500">{loading ? 'Buscando…' : `${visible.length} mídias`}</span>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Filtrar tipo de mídia">
      {kinds.map((item) => <button key={item.kind} type="button" aria-pressed={kind === item.kind} disabled={locked}
        onClick={() => setKind(item.kind)} className={`rounded-full border px-3 py-1.5 text-xs ${kind === item.kind ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-700'}`}>{item.label}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={locked || !visible.some((record) => !attached.includes(record.id))}
        onClick={() => setSelected((current) => [...current, ...visible.filter((record) => !attached.includes(record.id) && !current.some((item) => item.id === record.id))])}>Selecionar visíveis</Button>
      <Button variant="secondary" disabled={locked || !selected.length} onClick={() => setSelected([])}>Limpar seleção</Button>
      <Button disabled={locked || !selected.length || Boolean(limitError)} onClick={() => void attachSelected()}>
        {busy ? 'Adicionando…' : `Adicionar ${selected.length || ''} ao projeto`}
      </Button>
    </div>
    {selected.length > 0 ? <p className="text-xs text-zinc-600">{selected.length} selecionadas. A ordem dos números será usada no projeto; a seleção permanece ao filtrar.</p> : null}
    {limitError ? <p className="text-sm text-red-700" role="alert">{limitError}</p> : null}
    {recoveryPending ? <p className="text-sm text-amber-700" role="alert">Ao tentar novamente, a solicitação anterior será conferida para evitar uma cópia duplicada.</p> : null}
    <p className="text-xs text-zinc-600" role="status" aria-live="polite">{progress}</p>
    <div className="grid max-h-80 gap-2 overflow-auto sm:grid-cols-2" aria-busy={loading}>
      {visible.map((record) => {
        const order = selected.findIndex((item) => item.id === record.id)
        const added = attached.includes(record.id)
        const media = record.payload
        const Icon = media.kind === 'image' ? Image : media.kind === 'clip' ? Film : Music
        return <div key={record.id} className={`space-y-2 rounded-xl border p-3 text-xs ${order >= 0 ? 'border-emerald-600 bg-emerald-50' : 'border-zinc-200'}`}>
          <button type="button" disabled={locked || added} aria-pressed={order >= 0} aria-label={`${order >= 0 ? 'Desmarcar' : 'Selecionar'} ${media.name}`}
            onClick={() => toggle(record)} className="flex w-full items-center gap-3 text-left disabled:opacity-60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
              {added ? <Check size={18} aria-hidden="true" /> : order >= 0 ? <span className="font-semibold">{order + 1}</span> : <Icon size={18} aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1"><span className="block break-words font-medium">{media.name}</span>
              <span className="text-zinc-500">{kinds.find((item) => item.kind === media.kind)?.label} · {(media.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
            </span>
          </button>
          <div className="flex flex-wrap gap-1 text-zinc-600">
            {media.width && media.height ? <span className="rounded bg-zinc-100 px-2 py-1">{media.width}×{media.height}</span> : null}
            {media.kind !== 'image' && media.durationSeconds > 0 ? <span className="rounded bg-zinc-100 px-2 py-1">{media.durationSeconds.toFixed(1)} s</span> : null}
            {media.tags.map((tag) => <span key={tag} className="rounded bg-zinc-100 px-2 py-1">{tag}</span>)}
          </div>
          {added ? <p className="text-emerald-700">Adicionada neste lote</p> : hasPossibleMediaCopy(media, project.assets) ? <p className="text-amber-700">Possível cópia no projeto. Você pode adicionar outra.</p> : null}
          {media.productIds.length ? <p className="text-zinc-500">Produtos: {media.productIds.join(', ')}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={locked} onClick={() => onEdit(record)}>Aplicar tags e produtos</Button>
            <Button variant="secondary" disabled={locked || order >= 0} onClick={() => onDelete(record)}>Excluir da biblioteca</Button>
          </div>
        </div>
      })}
      {!loading && !visible.length ? <p className="p-3 text-sm text-zinc-500 sm:col-span-2">Nenhuma mídia corresponde a estes filtros.</p> : null}
    </div>
  </div>
}
