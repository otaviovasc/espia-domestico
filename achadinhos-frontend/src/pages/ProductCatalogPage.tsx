import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileJson, FolderPlus, Pencil, Search, Tags, Upload, X } from 'lucide-react'
import {
  apiErrorMessage,
  campaignApi,
  classificationProfileApi,
  groupApi,
  offerIdentity,
  savedProductApi,
  type ImportResult,
  type Offer,
  type SavedProduct,
  type SavedProductOfferPatch,
} from '@/lib/api'
import { productGroupApi } from '@/lib/productGroups'
import { Badge, Button, Card, Input, Label, Spinner } from '@/components/ui'
import { ClassificationProfilePanel } from '@/components/ClassificationProfilePanel'
import { ProductDeliveryStatus } from '@/components/ProductDeliveryStatus'

const CATEGORIES = ['A', 'B', 'C', 'D'] as const
const TONES = { A: 'green', B: 'blue', C: 'amber', D: 'red' } as const
const FIELD_LABELS: Record<string, string> = {
  title: 'título',
  description: 'descrição',
  category: 'categoria',
  discountedPrice: 'preço atual',
  originalPrice: 'preço original',
  discountPercent: 'desconto',
  commissionRate: 'comissão',
  commissionPercent: 'comissão exibida',
  commissioned: 'comissionado',
  coupon: 'cupom',
  affiliateUrl: 'link afiliado',
  imageUrl: 'imagem',
  relevanceScore: 'pontuação Jev',
}
const EDITABLE_FIELDS = [
  'title',
  'description',
  'category',
  'discountedPrice',
  'originalPrice',
  'discountPercent',
  'commissionRate',
  'commissionPercent',
  'commissioned',
  'coupon',
  'affiliateUrl',
  'imageUrl',
] as const satisfies readonly (keyof SavedProductOfferPatch)[]

function changedOfferFields(original: Offer, current: Offer): SavedProductOfferPatch {
  const patch: SavedProductOfferPatch = {}
  for (const field of EDITABLE_FIELDS) {
    if (original[field] !== current[field]) {
      Object.assign(patch, { [field]: current[field] ?? null })
    }
  }
  return patch
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export default function ProductCatalogPage() {
  const queryClient = useQueryClient()
  const [jsonText, setJsonText] = useState('')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<'all' | typeof CATEGORIES[number]>('all')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [catalogFeedback, setCatalogFeedback] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editOffer, setEditOffer] = useState<Offer | null>(null)
  const [originalEditOffer, setOriginalEditOffer] = useState<Offer | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogCategory, setCatalogCategory] = useState<'all' | typeof CATEGORIES[number]>('all')
  const [classificationProfileId, setClassificationProfileId] = useState('default')
  const [catalogProfileId, setCatalogProfileId] = useState('all')
  const [catalogGroupId, setCatalogGroupId] = useState('all')
  const [selectedSavedIds, setSelectedSavedIds] = useState<Set<number>>(new Set())
  const [saveGroupIds, setSaveGroupIds] = useState<Set<number>>(new Set())
  const [assignmentGroupId, setAssignmentGroupId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<number | null>(null)
  const [renamingGroupName, setRenamingGroupName] = useState('')
  const [deleteGroupConfirmId, setDeleteGroupConfirmId] = useState<number | null>(null)
  const [groupError, setGroupError] = useState<string | null>(null)
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null)
  const [editClassificationProfileId, setEditClassificationProfileId] = useState<string>('default')

  const classificationProfiles = useQuery({
    queryKey: ['classification-profiles'],
    queryFn: classificationProfileApi.list,
  })
  const productGroups = useQuery({
    queryKey: ['product-groups'],
    queryFn: productGroupApi.list,
  })

  const catalog = useInfiniteQuery({
    queryKey: ['saved-products', 'pages'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => savedProductApi.list(100, pageParam),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total && last.items.length > 0 ? loaded : undefined
    },
  })
  const savedItems = useMemo(() => catalog.data?.pages.flatMap((page) => page.items) ?? [], [catalog.data])
  const catalogProfileOptions = useMemo(() => {
    const options = new Map((classificationProfiles.data ?? []).map((profile) => [profile.id, profile.name]))
    for (const item of savedItems) {
      for (const [profileId, classification] of Object.entries(item.classifications ?? {})) {
        if (!options.has(profileId)) options.set(profileId, `${classification.profileName} (arquivado)`)
      }
    }
    return [...options].map(([id, name]) => ({ id, name }))
  }, [classificationProfiles.data, savedItems])
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupApi.list(),
    retry: false,
  })
  const groupIds = useMemo(() => groups.data?.map((group) => group.id).sort() ?? [], [groups.data])
  const groupNames = useMemo(
    () => new Map((groups.data ?? []).map((group) => [group.id, group.name])),
    [groups.data],
  )
  const savedItemIds = useMemo(() => savedItems.map((item) => item.id), [savedItems])
  const delivery = useQuery({
    queryKey: ['offer-group-delivery', savedItemIds, groupIds],
    queryFn: () => campaignApi.checkOffersBatched(
      savedItems.map((item) => ({
        savedProductId: item.offer.savedProductId ?? item.id,
        source: item.offer.source,
        productId: item.offer.productId,
        affiliateUrl: item.offer.affiliateUrl,
      })),
      groupIds.length > 0 ? groupIds : undefined,
    ),
    enabled: savedItems.length > 0,
  })
  const savedKeys = useMemo(() => new Set(savedItems.map((item) =>
    item.offer.source && item.offer.productId
      ? `${item.offer.source}:${item.offer.productId}`
      : item.offer.affiliateUrl,
  )), [savedItems])
  const remove = useMutation({
    mutationFn: savedProductApi.remove,
    onSuccess: async (_, removedId) => {
      setSelectedSavedIds((current) => {
        const next = new Set(current)
        next.delete(removedId)
        return next
      })
      setCatalogFeedback('Produto removido do catálogo.')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
        queryClient.invalidateQueries({ queryKey: ['offer-group-delivery'] }),
      ])
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const update = useMutation({
    mutationFn: ({ id, offer, classificationProfileId: profileId }: { id: number; offer: SavedProductOfferPatch; classificationProfileId?: string }) => savedProductApi.update(id, offer, profileId),
    onSuccess: async () => {
      setEditingId(null)
      setEditOffer(null)
      setOriginalEditOffer(null)
      setEditError(null)
      setCatalogFeedback('Produto atualizado.')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
        queryClient.invalidateQueries({ queryKey: ['offer-group-delivery'] }),
      ])
    },
    onError: (cause) => setEditError(apiErrorMessage(cause)),
  })
  const createGroup = useMutation({
    mutationFn: (name: string) => productGroupApi.create(name),
    onSuccess: async (created) => {
      setNewGroupName('')
      setAssignmentGroupId(String(created.id))
      setGroupError(null)
      setGroupFeedback(`Grupo “${created.name}” criado.`)
      await queryClient.invalidateQueries({ queryKey: ['product-groups'] })
    },
    onError: (cause) => setGroupError(apiErrorMessage(cause)),
  })
  const renameGroup = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => productGroupApi.update(id, name),
    onSuccess: async (updatedGroup) => {
      setRenamingGroupId(null)
      setRenamingGroupName('')
      setGroupError(null)
      setGroupFeedback(`Grupo renomeado para “${updatedGroup.name}”.`)
      await queryClient.invalidateQueries({ queryKey: ['product-groups'] })
    },
    onError: (cause) => setGroupError(apiErrorMessage(cause)),
  })
  const deleteGroup = useMutation({
    mutationFn: productGroupApi.remove,
    onSuccess: async (_, removedId) => {
      if (catalogGroupId === String(removedId)) setCatalogGroupId('all')
      if (assignmentGroupId === String(removedId)) setAssignmentGroupId('')
      setDeleteGroupConfirmId(null)
      setGroupError(null)
      setGroupFeedback('Grupo removido. Os produtos continuam no catálogo.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
      ])
    },
    onError: (cause) => setGroupError(apiErrorMessage(cause)),
  })
  const assignGroups = useMutation({
    mutationFn: (mode: 'add' | 'remove') => productGroupApi.assign({
      productIds: [...selectedSavedIds],
      groupIds: [Number(assignmentGroupId)],
      mode,
    }),
    onSuccess: async (data) => {
      setSelectedSavedIds(new Set())
      setGroupError(null)
      setGroupFeedback(`${data.updated} produto(s) atualizado(s).`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
      ])
    },
    onError: (cause) => setGroupError(apiErrorMessage(cause)),
  })
  const classify = useMutation({
    mutationFn: () => campaignApi.importOffers(jsonText, { classificationProfileId }),
    onSuccess: (data) => {
      setResult(data)
      setSelected(new Set())
      setCategoryFilter('all')
      setError(null)
      setFeedback(null)
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const save = useMutation({
    mutationFn: () => savedProductApi.save(result?.offers.filter((_, index) => selected.has(index)) ?? []),
    onSuccess: async (data) => {
      setSelected(new Set())
      let groupAssignmentFailed = false
      if (saveGroupIds.size > 0 && data.saved.length > 0) {
        try {
          await productGroupApi.assign({
            productIds: data.saved.map((item) => item.id),
            groupIds: [...saveGroupIds],
            mode: 'add',
          })
        } catch (cause) {
          groupAssignmentFailed = true
          setError(`Os produtos foram salvos, mas não foi possível adicioná-los aos grupos: ${apiErrorMessage(cause)}`)
        }
      }
      setFeedback(`${data.created} produto(s) salvo(s), ${data.updated} atualizado(s).${saveGroupIds.size > 0 && !groupAssignmentFailed ? ' Grupos aplicados.' : ''}`)
      if (!groupAssignmentFailed) setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
        queryClient.invalidateQueries({ queryKey: ['offer-group-delivery'] }),
        queryClient.invalidateQueries({ queryKey: ['product-groups'] }),
      ])
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const counts = useMemo(() => {
    const next = { A: 0, B: 0, C: 0, D: 0, uncategorized: 0 }
    for (const offer of result?.offers ?? []) {
      if (offer.category && offer.category in next) next[offer.category]++
      else next.uncategorized++
    }
    return next
  }, [result])
  const visibleOffers = useMemo(() => (result?.offers ?? []).map((offer, index) => ({ offer, index }))
    .filter(({ offer }) => categoryFilter === 'all' || offer.category === categoryFilter), [result, categoryFilter])
  const selectVisible = () => setSelected((current) => new Set([
    ...current,
    ...visibleOffers.filter(({ offer }) => !!offer.category).map(({ index }) => index),
  ]))

  const updateText = (value: string) => {
    setJsonText(value)
    setResult(null)
    setSelected(new Set())
    setCategoryFilter('all')
    setFeedback(null)
    setCatalogFeedback(null)
    setError(null)
  }

  const readFile = async (file?: File) => {
    if (!file) return
    setFileName(file.name)
    setFileError(null)
    try {
      updateText(await file.text())
    } catch {
      setFileError('Não foi possível ler o arquivo. Escolha outro arquivo JSON.')
    }
  }

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const startEditing = (item: SavedProduct) => {
    const availableProfileIds = new Set((classificationProfiles.data ?? []).map((profile) => profile.id))
    const currentProfileId = item.offer.classificationProfileId
    const profileId = currentProfileId && availableProfileIds.has(currentProfileId)
      ? currentProfileId
      : Object.keys(item.classifications ?? {}).find((id) => availableProfileIds.has(id)) ?? 'default'
    const classification = item.classifications?.[profileId]
    const offer = {
      ...item.offer,
      category: classification?.category ?? item.offer.category,
      relevanceScore: classification?.relevanceScore ?? item.offer.relevanceScore,
    }
    setEditingId(item.id)
    setEditClassificationProfileId(profileId)
    setEditOffer(offer)
    setOriginalEditOffer(offer)
    setEditError(null)
    setError(null)
    setFeedback(null)
    setCatalogFeedback(null)
  }

  const updateEdit = <K extends keyof Offer>(field: K, value: Offer[K]) => {
    setEditOffer((current) => current ? { ...current, [field]: value } : current)
  }

  const numberOrUndefined = (value: string): number | undefined => {
    if (!value.trim()) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const visibleSavedItems = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase('pt-BR')
    return savedItems.filter((item) => {
      if (catalogGroupId !== 'all' && !item.groupIds?.includes(Number(catalogGroupId))) return false
      const classifications = Object.entries(item.classifications ?? {})
      const selectedClassification = catalogProfileId === 'all'
        ? null
        : item.classifications?.[catalogProfileId]
      if (catalogProfileId !== 'all' && !selectedClassification) return false
      if (catalogCategory !== 'all') {
        const matchesCategory = selectedClassification
          ? selectedClassification.category === catalogCategory
          : classifications.length > 0
            ? classifications.some(([, value]) => value.category === catalogCategory)
            : item.offer.category === catalogCategory
        if (!matchesCategory) return false
      }
      if (!query) return true
      return item.offer.title.toLocaleLowerCase('pt-BR').includes(query)
        || item.offer.productId?.toLocaleLowerCase('pt-BR').includes(query)
        || item.offer.affiliateUrl.toLocaleLowerCase('pt-BR').includes(query)
        || item.offer.classificationProfileName?.toLocaleLowerCase('pt-BR').includes(query)
        || classifications.some(([, value]) => value.profileName.toLocaleLowerCase('pt-BR').includes(query))
    })
  }, [catalogCategory, catalogGroupId, catalogProfileId, catalogSearch, savedItems])

  const toggleSaved = (id: number) => {
    setSelectedSavedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const changeEditClassification = (item: SavedProduct, profileId: string) => {
    const classification = item.classifications?.[profileId]
    setEditClassificationProfileId(profileId)
    setOriginalEditOffer((current) => current ? {
      ...item.offer,
      category: classification?.category ?? item.offer.category,
      relevanceScore: classification?.relevanceScore ?? item.offer.relevanceScore,
    } : current)
    setEditOffer((current) => current ? {
      ...current,
      category: classification?.category ?? item.offer.category,
      relevanceScore: classification?.relevanceScore ?? item.offer.relevanceScore,
    } : current)
    setEditError(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Classificar produtos</h1>
        <p className="mt-1 text-sm text-zinc-600">Escolha um nicho, envie um JSON de produtos, revise as categorias e salve o que quer usar em campanhas.</p>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <FileJson size={18} className="text-violet-600" />
          <h2 className="font-semibold">Classificação de um arquivo</h2>
        </div>
        <ClassificationProfilePanel
          profiles={classificationProfiles.data ?? []}
          selectedId={classificationProfileId}
          onSelect={setClassificationProfileId}
          isLoading={classificationProfiles.isPending}
          isError={classificationProfiles.isError}
          disabled={classify.isPending || save.isPending}
          onRetry={() => { void classificationProfiles.refetch() }}
        />
        <div className="mt-5">
        <label htmlFor="catalog-json" className="mb-1 block text-sm font-medium text-zinc-700">Conteúdo do arquivo</label>
        <textarea
          id="catalog-json"
          value={jsonText}
          disabled={classify.isPending || save.isPending}
          onChange={(event) => { setFileName(''); updateText(event.target.value) }}
          placeholder="Cole um array de produtos ou um JSON exportado de um marketplace"
          className="h-36 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
        />
          <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-violet-400">
            <Upload size={16} /> Escolher JSON
            <input type="file" accept=".json,application/json" className="sr-only" disabled={classify.isPending || save.isPending} onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = '' }} />
          </label>
          {fileName && <span className="text-sm text-zinc-500">{fileName}</span>}
          <Button onClick={() => classify.mutate()} disabled={!jsonText.trim() || classify.isPending || save.isPending || classificationProfiles.isPending || classificationProfiles.isError}>
            {classify.isPending ? 'Classificando…' : 'Classificar produtos'}
          </Button>
        </div>
        </div>
        {fileError && <p role="alert" className="mt-3 text-sm text-red-700">{fileError}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {feedback && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} />{feedback}</p>}
      </Card>

      {result && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Revisar classificação</h2>
              <p className="text-sm text-zinc-500">{result.offers.length} produto(s) reconhecido(s) de {result.totalSeen} no arquivo.</p>
              {result.categorization?.profile && <p className="mt-1 text-xs text-violet-700">Perfil usado: <strong>{result.categorization.profile.name}</strong></p>}
            </div>
            <Button onClick={() => save.mutate()} disabled={selected.size === 0 || save.isPending}>
              {save.isPending ? 'Salvando…' : `Salvar ${selected.size} selecionado(s)`}
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">Até 100 produtos por arquivo. Cada produto válido é avaliado por Jev, então a classificação pode levar alguns minutos.</p>
          {(productGroups.data?.length ?? 0) > 0 && (
            <fieldset className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <legend className="px-1 text-sm font-medium text-zinc-700">Adicionar os produtos salvos a grupos</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {(productGroups.data ?? []).map((group) => (
                  <label key={group.id} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                    <input type="checkbox" checked={saveGroupIds.has(group.id)} disabled={save.isPending} onChange={(event) => setSaveGroupIds((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(group.id)
                      else next.delete(group.id)
                      return next
                    })} />
                    {group.name}{group.isDefault ? ' (padrão)' : ''}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">A seleção vale para este salvamento e pode ser alterada depois no catálogo.</p>
            </fieldset>
          )}
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Filtrar por categoria">
              <button type="button" aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === 'all' ? 'ring-2 ring-violet-500' : ''}`}><Badge>Todos: {result.offers.length}</Badge></button>
              {CATEGORIES.map((category) => <button type="button" key={category} aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === category ? 'ring-2 ring-violet-500' : ''}`}><Badge tone={TONES[category]}>{category}: {counts[category]}</Badge></button>)}
              {counts.uncategorized > 0 && <Badge>Sem categoria: {counts.uncategorized}</Badge>}
            </div>
            <p className="mt-2 text-xs text-zinc-500">A combina alta afinidade com o nicho, desconto e comissão; D indica baixa prioridade. A afinidade aparece ao passar o cursor sobre a categoria.</p>
            {result.offers.some((offer) => !!offer.category) && <div className="mt-3 flex gap-4 text-sm"><button type="button" className="text-violet-700 underline" onClick={selectVisible}>Selecionar visíveis</button><button type="button" className="text-zinc-600 underline" onClick={() => setSelected(new Set())}>Limpar seleção</button></div>}
          {counts.uncategorized > 0 && <p className="mt-2 text-sm text-amber-800">Produtos sem categoria não podem ser salvos. Confira os avisos da importação.</p>}
          {result.errors.length > 0 && <p className="mt-3 text-sm text-amber-800">{result.errors.length} item(ns) não puderam ser importados. {result.errors.slice(0, 3).map((item) => item.message).join(' ')}</p>}
            {visibleOffers.length === 0 ? (
              <p className="mt-5 text-sm text-zinc-600">Nenhum produto nesta categoria.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-zinc-200 text-xs text-zinc-500"><th className="px-2 py-2">Salvar</th><th className="px-2 py-2">Produto</th><th className="px-2 py-2">Categoria</th><th className="px-2 py-2">Desconto</th><th className="px-2 py-2">Comissão</th><th className="px-2 py-2">Preço</th><th className="px-2 py-2">Link</th></tr></thead>
                  <tbody>
                    {visibleOffers.map(({ offer, index }) => (
                    <tr key={`${offer.productId || offer.affiliateUrl}-${index}`} className="border-b border-zinc-100">
                      <td className="px-2 py-3"><input type="checkbox" aria-label={`Salvar ${offer.title}`} checked={selected.has(index)} disabled={!offer.category || save.isPending} onChange={() => toggle(index)} /></td>
                        <td className="px-2 py-3"><div className="flex min-w-48 items-center gap-2">{offer.imageUrl && <img src={offer.imageUrl} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" />}<span>{offer.title}</span>{savedKeys.has(offer.source && offer.productId ? `${offer.source}:${offer.productId}` : offer.affiliateUrl) && <Badge tone="green">Salvo</Badge>}</div></td>
                        <td className="px-2 py-3">{offer.category ? <span title={`Afinidade com o nicho: ${offer.relevanceScore ?? '—'}/100`}><Badge tone={TONES[offer.category]}>Categoria {offer.category}</Badge></span> : <Badge>Sem categoria</Badge>}</td>
                        <td className="whitespace-nowrap px-2 py-3">{offer.discountPercent != null ? `${offer.discountPercent}%` : '—'}</td>
                        <td className="whitespace-nowrap px-2 py-3">{offer.commissioned === false ? 'Sem comissão' : offer.commissionRate != null ? `${offer.commissionRate}%` : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-3">{money(offer.discountedPrice)}</td>
                      <td className="px-2 py-3"><a href={offer.affiliateUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">Abrir</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">Catálogo salvo</h2><p className="text-sm text-zinc-500">Produtos disponíveis para campanhas futuras, com histórico por grupo nesta conexão do WhatsApp.</p></div>
          <Link to="/compose" className="text-sm font-medium text-violet-700 underline">Criar campanha</Link>
        </div>
        {groups.isError && (
          <p role="alert" className="mt-3 text-sm text-amber-800">
            Não foi possível carregar os grupos conectados. O histórico enviado continua disponível,
            mas os grupos que ainda faltam só aparecem depois de reconectar o WhatsApp.
            {' '}<button type="button" className="underline" onClick={() => void groups.refetch()}>Tentar novamente</button>
          </p>
        )}
        {delivery.isError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Não foi possível carregar o histórico de envios.
            {' '}<button type="button" className="underline" onClick={() => void delivery.refetch()}>Tentar novamente</button>
          </p>
        )}
        {catalogFeedback && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} />{catalogFeedback}</p>}
        <section className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4" aria-labelledby="product-groups-heading">
          <div className="flex items-center gap-2"><Tags size={17} className="text-violet-600" /><h3 id="product-groups-heading" className="font-semibold">Grupos de produtos</h3></div>
          <p className="mt-1 text-xs text-zinc-500">Um produto pode ficar em vários grupos. Use os grupos para organizar seleções por tema, campanha ou público.</p>
          {productGroups.isPending ? <div className="mt-3"><Spinner /></div> : productGroups.isError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">Não foi possível carregar os grupos de produtos. <button type="button" className="underline" onClick={() => void productGroups.refetch()}>Tentar novamente</button></p>
          ) : (
            <>
              <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const name = newGroupName.trim(); if (name) createGroup.mutate(name) }}>
                <Input value={newGroupName} maxLength={120} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Nome do novo grupo" aria-label="Nome do novo grupo de produtos" />
                <Button type="submit" variant="secondary" disabled={!newGroupName.trim() || createGroup.isPending}><FolderPlus size={15} />{createGroup.isPending ? 'Criando…' : 'Criar grupo'}</Button>
              </form>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {(productGroups.data ?? []).map((group) => (
                  <div key={group.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
                    {renamingGroupId === group.id ? (
                      <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); const name = renamingGroupName.trim(); if (name) renameGroup.mutate({ id: group.id, name }) }}>
                        <Input autoFocus value={renamingGroupName} maxLength={120} onChange={(event) => setRenamingGroupName(event.target.value)} aria-label={`Novo nome para ${group.name}`} />
                        <Button type="submit" className="px-3" disabled={!renamingGroupName.trim() || renameGroup.isPending}>Salvar</Button>
                        <Button type="button" className="px-3" variant="ghost" onClick={() => setRenamingGroupId(null)}>Cancelar</Button>
                      </form>
                    ) : (
                      <>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCatalogGroupId(String(group.id))} title={`Filtrar por ${group.name}`}>
                          <span className="truncate font-medium">{group.name}</span>
                          <span className="ml-2 text-xs text-zinc-500">{group.productCount} produto(s)</span>
                          {group.isDefault && <span className="ml-2"><Badge>Padrão</Badge></span>}
                        </button>
                        {!group.isDefault && (
                          <span className="flex shrink-0 items-center gap-2 text-xs">
                            <button type="button" className="text-violet-700 underline" onClick={() => { setRenamingGroupId(group.id); setRenamingGroupName(group.name); setGroupError(null) }}>Renomear</button>
                            {deleteGroupConfirmId === group.id ? <>
                              <button type="button" className="font-semibold text-red-700 underline" disabled={deleteGroup.isPending} onClick={() => deleteGroup.mutate(group.id)}>Confirmar</button>
                              <button type="button" className="text-zinc-600 underline" onClick={() => setDeleteGroupConfirmId(null)}>Cancelar</button>
                            </> : <button type="button" className="text-red-700 underline" onClick={() => setDeleteGroupConfirmId(group.id)}>Remover</button>}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {groupError && <p role="alert" className="mt-3 text-sm text-red-700">{groupError}</p>}
          {groupFeedback && <p role="status" className="mt-3 text-sm text-green-700">{groupFeedback}</p>}
        </section>
        {savedItems.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-zinc-400" />
                <Input className="pl-9" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Buscar nos produtos carregados" aria-label="Buscar no catálogo carregado" />
              </div>
              <select value={catalogGroupId} onChange={(event) => setCatalogGroupId(event.target.value)} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Filtrar catálogo por grupo de produtos">
                <option value="all">Todos os grupos</option>
                {(productGroups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <select value={catalogProfileId} onChange={(event) => setCatalogProfileId(event.target.value)} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Filtrar catálogo por perfil de classificação">
                <option value="all">Todos os nichos</option>
                {catalogProfileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <select value={catalogCategory} onChange={(event) => setCatalogCategory(event.target.value as typeof catalogCategory)} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Filtrar catálogo salvo por categoria">
                <option value="all">Todas as categorias</option>
                {CATEGORIES.map((category) => <option key={category} value={category}>Categoria {category}</option>)}
              </select>
            </div>
            <p className="text-xs text-zinc-500">
              {visibleSavedItems.length} resultado(s) entre {savedItems.length} produto(s) carregado(s).
              {(catalog.data?.pages[0]?.total ?? savedItems.length) > savedItems.length
                ? ' Carregue mais para pesquisar o restante do catálogo.'
                : ' Todo o catálogo está carregado.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3">
              <button type="button" className="text-sm text-violet-700 underline" onClick={() => setSelectedSavedIds(new Set(visibleSavedItems.map((item) => item.id)))}>Selecionar resultados visíveis</button>
              {selectedSavedIds.size > 0 && <button type="button" className="text-sm text-zinc-600 underline" onClick={() => setSelectedSavedIds(new Set())}>Limpar seleção</button>}
              <span className="text-xs text-zinc-500">{selectedSavedIds.size} selecionado(s)</span>
              <select value={assignmentGroupId} onChange={(event) => setAssignmentGroupId(event.target.value)} className="h-9 min-w-48 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Grupo para atribuição em massa">
                <option value="">Escolha um grupo</option>
                {(productGroups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <Button type="button" className="px-3 py-1.5" disabled={selectedSavedIds.size === 0 || !assignmentGroupId || assignGroups.isPending} onClick={() => assignGroups.mutate('add')}>Adicionar ao grupo</Button>
              <Button type="button" variant="secondary" className="px-3 py-1.5" disabled={selectedSavedIds.size === 0 || !assignmentGroupId || assignGroups.isPending} onClick={() => assignGroups.mutate('remove')}>Remover do grupo</Button>
            </div>
          </div>
        )}
        {catalog.isPending ? <div className="mt-4"><Spinner /></div> : catalog.isError ? (
          <p role="alert" className="mt-4 text-sm text-red-700">Não foi possível carregar o catálogo. <button type="button" className="underline" onClick={() => void catalog.refetch()}>Tentar novamente</button></p>
        ) : savedItems.length ? (
          <div className="mt-4 space-y-2">
            {visibleSavedItems.map((item) => {
              const flag = delivery.data?.[offerIdentity({
                ...item.offer,
                savedProductId: item.offer.savedProductId ?? item.id,
              })]
              const itemGroups = (productGroups.data ?? []).filter((group) => item.groupIds?.includes(group.id))
              const itemClassifications = Object.entries(item.classifications ?? {})
              return (
                <div key={item.id} className="grid gap-2 border-b border-zinc-100 py-3 text-sm md:grid-cols-[auto_minmax(0,1fr)_minmax(12rem,auto)_minmax(13rem,auto)_auto] md:items-start">
                  <input type="checkbox" className="mt-1" checked={selectedSavedIds.has(item.id)} onChange={() => toggleSaved(item.id)} aria-label={`Selecionar ${item.offer.title} para organizar em grupos`} />
                  <span className="min-w-0 truncate font-medium" title={item.offer.title}>{item.offer.title}</span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1">
                      {itemClassifications.length > 0 ? itemClassifications.map(([profileId, classification]) => (
                        <span key={profileId} title={`Afinidade: ${classification.relevanceScore ?? '—'}/100 · classificado em ${new Date(classification.classifiedAt).toLocaleString('pt-BR')}`}>
                          <Badge tone={TONES[classification.category]}>{classification.profileName}: {classification.category}</Badge>
                        </span>
                      )) : <Badge tone={item.offer.category ? TONES[item.offer.category] : 'zinc'}>{item.offer.category || 'Sem categoria'}</Badge>}
                    </div>
                    {itemGroups.length > 0 && <p className="text-xs text-zinc-500">{itemGroups.map((group) => group.name).join(' · ')}</p>}
                    {(item.manualOverrides?.length ?? 0) > 0 && <span title={`Campos ajustados: ${item.manualOverrides?.map((field) => FIELD_LABELS[field] ?? field).join(', ')}`}><Badge tone="violet">Editado manualmente</Badge></span>}
                  </div>
                  {delivery.isPending ? (
                    <span className="text-xs text-zinc-400">Carregando histórico…</span>
                  ) : delivery.isError ? (
                    <span className="text-xs text-red-600">Histórico indisponível</span>
                  ) : (
                    <ProductDeliveryStatus
                      groups={flag?.groups ?? []}
                      savedProductId={item.offer.savedProductId ?? item.id}
                      groupNames={groupNames}
                      compact
                      emptyLabel={groupIds.length > 0 ? 'Pronto para todos os grupos desta conexão' : 'Nunca enviado nesta conexão'}
                    />
                  )}
                  <div className="flex gap-3 md:justify-end">
                    <button type="button" disabled={update.isPending} onClick={() => startEditing(item)} className="inline-flex items-center gap-1 text-violet-700 underline disabled:opacity-50" aria-label={`Editar ${item.offer.title}`}><Pencil size={13} />Editar</button>
                    {deleteConfirmId === item.id ? (
                      <span className="inline-flex flex-wrap items-center gap-2 text-xs text-red-800">
                        Remover?
                        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id, { onSuccess: () => setDeleteConfirmId(null) })} className="font-semibold underline disabled:opacity-50">Confirmar</button>
                        <button type="button" disabled={remove.isPending} onClick={() => setDeleteConfirmId(null)} className="text-zinc-600 underline">Cancelar</button>
                      </span>
                    ) : <button type="button" disabled={remove.isPending || update.isPending} onClick={() => setDeleteConfirmId(item.id)} className="text-red-700 underline disabled:opacity-50" aria-label={`Remover ${item.offer.title}`}>Remover</button>}
                  </div>
                  {editingId === item.id && editOffer && (
                    <form
                      className="col-span-full mt-2 rounded-lg border border-violet-200 bg-violet-50/40 p-4"
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (!originalEditOffer) return
                        const patch = changedOfferFields(originalEditOffer, editOffer)
                        if (Object.keys(patch).length === 0) {
                          setEditError('Faça ao menos uma alteração antes de salvar.')
                          return
                        }
                        update.mutate({ id: item.id, offer: patch, classificationProfileId: editClassificationProfileId })
                      }}
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-zinc-900">Editar produto</h3>
                          <p className="text-xs text-zinc-500">A origem e o ID do produto identificam o histórico e não podem ser alterados.</p>
                        </div>
                        <button type="button" aria-label="Fechar edição" onClick={() => { setEditingId(null); setEditOffer(null); setOriginalEditOffer(null); setEditError(null) }} className="rounded p-1 text-zinc-500 hover:bg-white"><X size={17} /></button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2"><Label>Título</Label><Input required value={editOffer.title} onChange={(event) => updateEdit('title', event.target.value)} /></div>
                        <div className="md:col-span-2"><Label>Descrição</Label><textarea value={editOffer.description ?? ''} onChange={(event) => updateEdit('description', event.target.value || undefined)} className="min-h-20 w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" /></div>
                        <div className="md:col-span-2"><Label>Link afiliado</Label><Input required type="url" value={editOffer.affiliateUrl} onChange={(event) => updateEdit('affiliateUrl', event.target.value)} /></div>
                        <div className="md:col-span-2"><Label>URL da imagem</Label><Input type="url" value={editOffer.imageUrl ?? ''} onChange={(event) => updateEdit('imageUrl', event.target.value || undefined)} /></div>
                        <div><Label>Preço atual</Label><Input required type="number" min="0.01" step="0.01" value={editOffer.discountedPrice} onChange={(event) => updateEdit('discountedPrice', Number(event.target.value))} /></div>
                        <div><Label>Preço original</Label><Input type="number" min="0.01" step="0.01" value={editOffer.originalPrice ?? ''} onChange={(event) => updateEdit('originalPrice', numberOrUndefined(event.target.value))} /></div>
                        <div><Label>Desconto (%)</Label><Input type="number" min="0" max="100" step="0.01" value={editOffer.discountPercent ?? ''} onChange={(event) => updateEdit('discountPercent', numberOrUndefined(event.target.value))} /></div>
                        <div><Label>Comissão (%)</Label><Input type="number" min="0" max="100" step="0.01" value={editOffer.commissionRate ?? ''} disabled={editOffer.commissioned === false} onChange={(event) => {
                          const rate = numberOrUndefined(event.target.value)
                          setEditOffer((current) => current ? {
                            ...current,
                            commissionRate: rate,
                            commissionPercent: rate === undefined ? undefined : `${rate}%`,
                          } : current)
                        }} /></div>
                        <div><Label>Cupom</Label><Input value={editOffer.coupon ?? ''} onChange={(event) => updateEdit('coupon', event.target.value || undefined)} /></div>
                        <div>
                          <label htmlFor={`edit-profile-${item.id}`} className="mb-1 block text-sm font-medium text-zinc-700">Nicho da categoria</label>
                          <select
                            id={`edit-profile-${item.id}`}
                            value={editClassificationProfileId}
                            onChange={(event) => changeEditClassification(item, event.target.value)}
                            className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                          >
                            {(classificationProfiles.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{item.classifications?.[profile.id] ? '' : ' (sem avaliação)'}</option>)}
                            {(classificationProfiles.data?.length ?? 0) === 0 && <option value="default">Doméstico</option>}
                          </select>
                          <p className="mt-1 text-xs text-zinc-500">Cada nicho mantém sua própria categoria.</p>
                        </div>
                        <div>
                          <Label>Categoria (ajuste manual)</Label>
                          <select
                            value={editOffer.category ?? ''}
                            onChange={(event) => setEditOffer((current) => current ? {
                              ...current,
                              category: (event.target.value || undefined) as Offer['category'],
                            } : current)}
                            className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                          >
                            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                          <p className="mt-1 text-xs text-zinc-500">A alteração afeta somente o nicho selecionado e passa a ser identificada como ajuste manual.</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm md:col-span-2">
                          <input
                            type="checkbox"
                            checked={editOffer.commissioned !== false}
                            onChange={(event) => setEditOffer((current) => current ? {
                              ...current,
                              commissioned: event.target.checked,
                              ...(!event.target.checked ? { commissionRate: undefined, commissionPercent: undefined } : {}),
                            } : current)}
                          />
                          Produto com comissão afiliada
                        </label>
                        {(editOffer.source || editOffer.productId) && (
                          <div className="rounded-md bg-white p-3 text-xs text-zinc-500 md:col-span-2">
                            Origem: <strong>{editOffer.source ?? 'genérica'}</strong>
                            {editOffer.productId ? <> · ID: <strong>{editOffer.productId}</strong></> : null}
                          </div>
                        )}
                      </div>
                      {editError && <p role="alert" className="mt-3 text-sm text-red-700">{editError}</p>}
                      <div className="mt-4 flex gap-2">
                        <Button type="submit" disabled={update.isPending || !editOffer.title.trim() || !editOffer.affiliateUrl.trim() || !originalEditOffer || Object.keys(changedOfferFields(originalEditOffer, editOffer)).length === 0}>{update.isPending ? 'Salvando…' : 'Salvar alterações'}</Button>
                        <Button type="button" variant="secondary" disabled={update.isPending} onClick={() => { setEditingId(null); setEditOffer(null); setOriginalEditOffer(null); setEditError(null) }}>Cancelar</Button>
                      </div>
                    </form>
                  )}
                </div>
              )
            })}
            {visibleSavedItems.length === 0 && <p className="py-4 text-center text-sm text-zinc-500">Nenhum produto carregado corresponde à busca e ao filtro.</p>}
            <p className="text-xs text-zinc-500">Mostrando {savedItems.length} de {catalog.data?.pages[0]?.total ?? savedItems.length} produtos.</p>
            {catalog.hasNextPage && <Button variant="secondary" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>{catalog.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</Button>}
          </div>
        ) : <p className="mt-4 text-sm text-zinc-600">Nenhum produto salvo. Classifique um JSON e escolha os produtos acima.</p>}
      </Card>
    </div>
  )
}
