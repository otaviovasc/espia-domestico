import { useMemo, useRef, useState } from 'react'
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
import { classifyImportSession, createImportSession, importOriginLabel, importResult, importSummary, saveInChunks, type ImportSession } from '@/lib/importWorkflow'
import { applyFileRead, importInputError, MAX_IMPORT_BYTES, MAX_IMPORT_FILES, prepareImportPayloads, readImportFile, type ImportFileEntry } from '@/lib/importFiles'
import { productGroupApi } from '@/lib/productGroups'
import { Badge, Button, Card, Input, Label, Spinner } from '@/components/ui'
import { ClassificationProfilePanel } from '@/components/ClassificationProfilePanel'
import { ImportFeedbackList } from '@/components/ImportFeedbackList'
import { ProductExtensionEvidence } from '@/components/ProductExtensionEvidence'
import { ProductDeliveryStatus } from '@/components/ProductDeliveryStatus'

const PAGE_SIZE = 40
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
  const [importFiles, setImportFiles] = useState<ImportFileEntry[]>([])
  const importFilesRef = useRef<ImportFileEntry[]>([])
  const nextFileId = useRef(1)
  const classificationRunning = useRef(false)
  const cancelRequested = useRef(false)
  const [session, setSession] = useState<ImportSession | null>(null)
  const [reviewPage, setReviewPage] = useState(1)
  const [catalogPage, setCatalogPage] = useState(1)
  const [saveProgress, setSaveProgress] = useState<{ total: number; saved: number; failed: number } | null>(null)
  const [groupRetry, setGroupRetry] = useState<{ productIds: number[]; groupIds: number[] } | null>(null)
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

  const inputError = useMemo(() => importInputError(importFiles, jsonText), [importFiles, jsonText])
  const readingFiles = importFiles.some((file) => file.status === 'reading')
  const totalFileBytes = importFiles.reduce((total, file) => total + file.size, 0)

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
    mutationFn: async (mode: 'add' | 'remove') => {
      const productIds = [...selectedSavedIds]
      const groupIds = [Number(assignmentGroupId)]
      let updated = 0
      let failed = 0
      setGroupError(null)
      await saveInChunks(productIds,
        async (ids) => { const data = await productGroupApi.assign({ productIds: ids, groupIds, mode }); updated += data.updated },
        (ids) => setSelectedSavedIds((current) => { const next = new Set(current); ids.forEach((id) => next.delete(id)); return next }),
        (ids, cause) => { failed += ids.length; setGroupError(apiErrorMessage(cause)) },
        () => false,
      )
      return { updated, failed }
    },
    onSuccess: async (data) => {
      setGroupFeedback(`${data.updated} produto(s) atualizado(s), ${data.failed} falha(s). A seleção mantém as falhas para tentar novamente.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
      ])
    },
    onError: (cause) => setGroupError(apiErrorMessage(cause)),
  })
  const publishSession = (next: ImportSession) => {
    setSession(next)
    setResult(importResult(next))
  }
  const classify = useMutation({
    mutationFn: async (mode: 'new' | 'pending' | 'failed') => {
      classificationRunning.current = true
      cancelRequested.current = false
      if (mode === 'new') { setSelected(new Set()); setReviewPage(1); setCategoryFilter('all'); setSaveProgress(null) }
      setError(null)
      setFeedback(null)
      const initial = mode !== 'new' && session ? session : createImportSession(
        importFilesRef.current.length
          ? await campaignApi.importPayloads(prepareImportPayloads(importFilesRef.current, jsonText), classificationProfileId)
          : await campaignApi.importOffers(prepareImportPayloads([], jsonText)[0].json, { classificationProfileId, parseOnly: true }),
      )
      publishSession(initial)
      return classifyImportSession(initial,
        (offers, profile) => campaignApi.importOffers(offers, {
          classificationProfileId: profile.id, classificationProfileSnapshot: profile, partialResults: true,
        }),
        { retryFailed: mode === 'failed', cancelled: () => cancelRequested.current, onProgress: publishSession, errorMessage: apiErrorMessage },
      )
    },
    onSuccess: publishSession,
    onSettled: () => { classificationRunning.current = false },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const invalidateCatalog = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['saved-products'] }),
    queryClient.invalidateQueries({ queryKey: ['offer-group-delivery'] }),
    queryClient.invalidateQueries({ queryKey: ['product-groups'] }),
  ])
  const retryGroups = useMutation({
    mutationFn: async () => {
      if (!groupRetry) return
      const remaining = new Set(groupRetry.productIds)
      await saveInChunks(groupRetry.productIds,
        async (productIds) => { await productGroupApi.assign({ productIds, groupIds: groupRetry.groupIds, mode: 'add' }) },
        (productIds) => productIds.forEach((id) => remaining.delete(id)),
        (_, cause) => setError(apiErrorMessage(cause)),
        () => false,
      )
      setGroupRetry(remaining.size ? { ...groupRetry, productIds: [...remaining] } : null)
      await invalidateCatalog()
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const save = useMutation({
    mutationFn: async () => {
      cancelRequested.current = false
      const entries = (result?.offers ?? []).map((offer, index) => ({ offer, index: result?.offerIndexes?.[index] ?? index })).filter(({ index }) => selected.has(index))
      const groupIds = [...saveGroupIds]
      const failedGroupIds = new Set<number>()
      const progress = { total: entries.length, saved: 0, failed: 0 }
      let created = 0
      let updated = 0
      setSaveProgress({ ...progress })
      setError(null)
      await saveInChunks(entries,
        async (batch) => {
          const data = await savedProductApi.save(batch.map(({ offer }) => offer))
          created += data.created
          updated += data.updated
          if (groupIds.length && data.saved.length) {
            try { await productGroupApi.assign({ productIds: data.saved.map((item) => item.id), groupIds, mode: 'add' }) }
            catch (cause) {
              data.saved.forEach((item) => failedGroupIds.add(item.id))
              setError(`Produtos salvos; falhou a atribuição aos grupos: ${apiErrorMessage(cause)}`)
            }
          }
        },
        (batch) => {
          progress.saved += batch.length
          setSelected((current) => { const next = new Set(current); batch.forEach(({ index }) => next.delete(index)); return next })
          setSaveProgress({ ...progress })
        },
        (batch, cause) => { progress.failed += batch.length; setSaveProgress({ ...progress }); setError(apiErrorMessage(cause)) },
        () => cancelRequested.current,
      )
      if (failedGroupIds.size) setGroupRetry({ productIds: [...failedGroupIds], groupIds })
      setFeedback(`${created} produto(s) criado(s), ${updated} atualizado(s). ${progress.failed} falha(s), ${progress.total - progress.saved - progress.failed} pendente(s). A seleção mantém apenas os produtos que ainda precisam ser salvos.`)
      await invalidateCatalog()
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
  const filteredOffers = useMemo(() => (result?.offers ?? []).map((offer, index) => ({ offer, index: result?.offerIndexes?.[index] ?? index }))
    .filter(({ offer }) => categoryFilter === 'all' || offer.category === categoryFilter), [result, categoryFilter])
  const reviewPageCount = Math.max(1, Math.ceil(filteredOffers.length / PAGE_SIZE))
  const safeReviewPage = Math.min(reviewPage, reviewPageCount)
  const visibleOffers = filteredOffers.slice((safeReviewPage - 1) * PAGE_SIZE, safeReviewPage * PAGE_SIZE)
  const summary = session ? importSummary(session) : null
  const provenanceByIndex = useMemo(() => new Map(session?.items.map((item) => [item.sourceIndex, item.provenance]) ?? []), [session])
  const fileProgress = useMemo(() => {
    const progress = new Map<number, { classified: number; failed: number; pending: number }>()
    for (const item of session?.items ?? []) {
      if (!item.provenance) continue
      const counts = progress.get(item.provenance.fileIndex) ?? { classified: 0, failed: 0, pending: 0 }
      counts[item.status]++
      progress.set(item.provenance.fileIndex, counts)
    }
    return progress
  }, [session])
  const selectVisible = () => setSelected((current) => new Set([
    ...current,
    ...visibleOffers.filter(({ offer }) => !!offer.category).map(({ index }) => index),
  ]))

  const resetClassification = () => {
    setResult(null)
    setSession(null)
    setReviewPage(1)
    setSaveProgress(null)
    setSelected(new Set())
    setCategoryFilter('all')
    setFeedback(null)
    setCatalogFeedback(null)
    setError(null)
  }

  const updateText = (value: string) => {
    setJsonText(value)
    resetClassification()
  }

  const replaceFiles = (files: ImportFileEntry[]) => {
    importFilesRef.current = files
    setImportFiles(files)
  }

  const addFiles = async (files: File[]) => {
    if (!files.length || classificationRunning.current || save.isPending) return
    const existing = importFilesRef.current
    if (existing.length + files.length + (jsonText.trim() ? 1 : 0) > MAX_IMPORT_FILES) {
      setFileError(`A seleção ultrapassa ${MAX_IMPORT_FILES} arquivos, contando o JSON colado. Nenhum arquivo desta seleção foi adicionado.`)
      return
    }
    const bytes = [...existing, ...files].reduce((total, file) => total + file.size, 0) + new TextEncoder().encode(jsonText).length
    if (bytes > MAX_IMPORT_BYTES) {
      setFileError('A seleção ultrapassa 32 MB. Nenhum arquivo desta seleção foi adicionado.')
      return
    }
    setFileError(null)
    resetClassification()
    const entries = files.map((file) => ({ id: nextFileId.current++, name: file.name, size: file.size, status: 'reading' as const }))
    replaceFiles([...existing, ...entries])
    await Promise.all(files.map(async (file, index) => {
      const result = await readImportFile(file)
      replaceFiles(applyFileRead(importFilesRef.current, entries[index].id, result))
    }))
  }

  const removeFile = (id: number) => {
    if (classificationRunning.current || save.isPending) return
    replaceFiles(importFilesRef.current.filter((file) => file.id !== id))
    setFileError(null)
    resetClassification()
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

  const catalogPageCount = Math.max(1, Math.ceil(visibleSavedItems.length / PAGE_SIZE))
  const safeCatalogPage = Math.min(catalogPage, catalogPageCount)
  const pagedSavedItems = visibleSavedItems.slice((safeCatalogPage - 1) * PAGE_SIZE, safeCatalogPage * PAGE_SIZE)

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
          <h2 className="font-semibold">Classificação de arquivos</h2>
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
        <label htmlFor="catalog-json" className="mb-1 block text-sm font-medium text-zinc-700">JSON colado (opcional)</label>
        <textarea
          id="catalog-json"
          value={jsonText}
          disabled={classify.isPending || save.isPending}
          onChange={(event) => updateText(event.target.value)}
          placeholder="Cole um array de produtos ou um JSON exportado de um marketplace"
          className="h-36 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
        />
          <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-violet-400">
            <Upload size={16} /> Adicionar arquivos JSON
            <input type="file" accept=".json,application/json" multiple className="sr-only" disabled={classify.isPending || save.isPending} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          </label>
          <Button onClick={() => classify.mutate('new')} disabled={!!inputError || readingFiles || classify.isPending || save.isPending || classificationProfiles.isPending || classificationProfiles.isError}>
            {classify.isPending ? 'Classificando…' : session ? 'Iniciar nova classificação' : 'Classificar produtos'}
          </Button>
        </div>
        </div>
        {importFiles.length > 0 && <div className="mt-3 rounded-lg border border-zinc-200 p-3">
          <div className="flex items-center justify-between gap-3 text-sm"><span>{importFiles.length} arquivo(s) · {(totalFileBytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB{readingFiles ? ' · Lendo arquivos…' : ''}</span><button type="button" className="text-zinc-600 underline" disabled={classify.isPending || save.isPending} onClick={() => { replaceFiles([]); setFileError(null); resetClassification() }}>Limpar arquivos</button></div>
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">{importFiles.map((file) => <li key={file.id} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><span className="break-all font-medium">{file.name}</span> · {(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB · {file.status === 'reading' ? 'Lendo…' : file.status === 'ready' ? 'Pronto' : 'Erro'}{file.error && <p role="alert" className="text-xs text-red-700">{file.error}</p>}</div><button type="button" className="text-zinc-600 underline" aria-label={`Remover arquivo ${file.name}`} disabled={classify.isPending || save.isPending} onClick={() => removeFile(file.id)}>Remover</button></li>)}</ul>
        </div>}
        {inputError && (importFiles.length > 0 || jsonText.trim()) && <p role="status" className="mt-3 text-sm text-amber-800">{inputError}</p>}
        <p className="mt-3 text-xs text-zinc-500">Até 50 arquivos e 5.000 itens somados, com envio de até 32 MB. Cada arquivo mantém seu formato; produtos repetidos são avaliados uma única vez. A classificação usa lotes de 4. Cada avaliação usa Jev e pode ter custo. Os resultados concluídos ficam disponíveis durante esta sessão.</p>
        {summary && <div role="status" aria-live="polite" className="mt-3 rounded-lg bg-violet-50 p-3 text-sm text-violet-800">
          {summary.classified} classificado(s) · {summary.failed} falha(s) · {summary.skipped} inválido(s)/ignorado(s) · {session!.duplicateCount ?? 0} duplicado(s) · {summary.pending} pendente(s) de {session!.totalSeen} item(ns).
          <progress className="mt-2 w-full accent-violet-600" value={session!.totalSeen - summary.pending} max={Math.max(1, session!.totalSeen)} aria-label="Progresso da classificação" />
          <div className="mt-2 flex flex-wrap gap-3">
            {classify.isPending ? <Button variant="secondary" onClick={() => { cancelRequested.current = true }}>Parar após o lote atual</Button> : <>
              {summary.pending > 0 && <Button variant="secondary" disabled={save.isPending} onClick={() => classify.mutate('pending')}>Continuar pendentes</Button>}
              {session!.items.some((item) => item.status === 'failed' && item.retryable) && <Button variant="secondary" disabled={save.isPending} onClick={() => classify.mutate('failed')}>Tentar falhas novamente</Button>}
            </>}
          </div>
          <p className="mt-2 text-xs">Continuar e tentar falhas preservam as avaliações concluídas e o perfil original. Alterar o JSON inicia uma nova sessão; mantenha esta página aberta até salvar.</p>
        </div>}
        {session && <>
          {(session.files?.length ?? 0) > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-medium text-zinc-700">Resumo e progresso de cada arquivo</caption><thead><tr className="border-b border-zinc-200"><th className="px-2 py-2">Arquivo</th><th className="px-2 py-2">Formato</th><th className="px-2 py-2">Itens</th><th className="px-2 py-2">Válidos únicos</th><th className="px-2 py-2">Inválidos</th><th className="px-2 py-2">Duplicados</th><th className="px-2 py-2">Avisos</th><th className="px-2 py-2">Classificados</th><th className="px-2 py-2">Falhas</th><th className="px-2 py-2">Pendentes</th></tr></thead><tbody>{session.files!.map((file) => <tr key={file.fileIndex} className="border-b border-zinc-100"><td className="px-2 py-2">{file.name}</td><td className="px-2 py-2">{file.source}</td><td className="px-2 py-2">{file.totalSeen}</td><td className="px-2 py-2">{file.imported}</td><td className="px-2 py-2">{file.invalid}</td><td className="px-2 py-2">{file.duplicates}</td><td className="px-2 py-2">{file.warnings}</td><td className="px-2 py-2">{fileProgress.get(file.fileIndex)?.classified ?? 0}</td><td className="px-2 py-2">{fileProgress.get(file.fileIndex)?.failed ?? 0}</td><td className="px-2 py-2">{fileProgress.get(file.fileIndex)?.pending ?? 0}</td></tr>)}</tbody></table></div>}
          <ImportFeedbackList title="Falhas da classificação" entries={session.items.filter((item) => item.status === 'failed').map((item) => ({ key: item.sourceIndex, message: `${importOriginLabel(item.sourceIndex, item.provenance)}: ${item.offer.title}. ${item.message}` }))} />
          <ImportFeedbackList title="Avisos de importação" entries={session.warnings.map((warning, index) => ({ key: index, message: `${warning.fileName ? `${warning.fileName} · item ${(warning.itemIndex ?? warning.index) + 1}` : `Item ${warning.index + 1}`}: ${warning.message}` }))} />
          <ImportFeedbackList title="Produtos duplicados, avaliados somente na primeira ocorrência" entries={(session.duplicates ?? []).map((duplicate) => ({ key: duplicate.index, message: `${importOriginLabel(duplicate.index, duplicate)}: repetido do item global ${duplicate.duplicateOf + 1}.` }))} />
        </>}

        {groupRetry && <div role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{groupRetry.productIds.length} produto(s) salvo(s) aguardam atribuição aos grupos.<div className="mt-2 flex flex-wrap gap-3"><button className="underline" disabled={retryGroups.isPending || save.isPending} onClick={() => retryGroups.mutate()}>Tentar atribuição novamente</button><button className="underline" disabled={retryGroups.isPending || save.isPending} onClick={() => { setGroupRetry(null); setError(null); setFeedback('Os produtos continuam salvos. A atribuição pendente aos grupos foi dispensada.') }}>Manter salvos sem estes grupos</button></div></div>}
        {fileError && <p role="alert" className="mt-3 text-sm text-red-700">{fileError}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {feedback && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} />{feedback}</p>}
      </Card>

      {result && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Revisar classificação</h2>
              <p className="text-sm text-zinc-500">{result.offers.length} produto(s) reconhecido(s) de {result.totalSeen} nos dados enviados.</p>
              {result.categorization?.profile && <p className="mt-1 text-xs text-violet-700">Perfil usado: <strong>{result.categorization.profile.name}</strong></p>}
            </div>
            <Button onClick={() => save.mutate()} disabled={selected.size === 0 || save.isPending || classify.isPending || !!groupRetry}>
              {save.isPending ? 'Salvando…' : `Salvar ${selected.size} selecionado(s)`}
            </Button>
          </div>
          {saveProgress && <p role="status" className="mt-2 text-sm text-zinc-600">Salvamento: {saveProgress.saved} concluído(s), {saveProgress.failed} falha(s), {saveProgress.total - saveProgress.saved - saveProgress.failed} pendente(s).</p>}
            {save.isPending && <Button variant="secondary" className="mt-2" onClick={() => { cancelRequested.current = true }}>Parar salvamento após o lote atual</Button>}

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
              <button type="button" aria-pressed={categoryFilter === 'all'} onClick={() => { setCategoryFilter('all'); setReviewPage(1) }} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === 'all' ? 'ring-2 ring-violet-500' : ''}`}><Badge>Todos: {result.offers.length}</Badge></button>
              {CATEGORIES.map((category) => <button type="button" key={category} aria-pressed={categoryFilter === category} onClick={() => { setCategoryFilter(category); setReviewPage(1) }} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === category ? 'ring-2 ring-violet-500' : ''}`}><Badge tone={TONES[category]}>{category}: {counts[category]}</Badge></button>)}
              {counts.uncategorized > 0 && <Badge>Sem categoria: {counts.uncategorized}</Badge>}
            </div>
            <p className="mt-2 text-xs text-zinc-500">A combina alta afinidade com o nicho, desconto e comissão; D indica baixa prioridade. A afinidade aparece ao passar o cursor sobre a categoria.</p>
            {result.offers.some((offer) => !!offer.category) && <div className="mt-3 flex gap-4 text-sm"><button type="button" className="text-violet-700 underline" disabled={save.isPending || classify.isPending} onClick={selectVisible}>Selecionar página</button><button type="button" className="text-violet-700 underline" disabled={save.isPending || classify.isPending} onClick={() => setSelected(new Set(filteredOffers.filter(({ offer }) => !!offer.category).map(({ index }) => index)))}>Selecionar filtrados ({filteredOffers.length})</button><button type="button" className="text-zinc-600 underline" disabled={save.isPending || classify.isPending} onClick={() => setSelected(new Set())}>Limpar seleção</button></div>}
          {counts.uncategorized > 0 && <p className="mt-2 text-sm text-amber-800">Produtos sem categoria não podem ser salvos. Confira os avisos da importação.</p>}
          {result.errors.length > 0 && <p className="mt-3 text-sm text-amber-800">{result.errors.length} aviso(s) de importação. {result.errors.slice(0, 3).map((item) => item.message).join(' ')}</p>}
            {visibleOffers.length === 0 ? (
              <p className="mt-5 text-sm text-zinc-600">Nenhum produto nesta categoria.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-zinc-200 text-xs text-zinc-500"><th className="px-2 py-2">Salvar</th><th className="px-2 py-2">Produto</th><th className="px-2 py-2">Categoria</th><th className="px-2 py-2">Desconto</th><th className="px-2 py-2">Comissão</th><th className="px-2 py-2">Preço</th><th className="px-2 py-2">Link</th></tr></thead>
                  <tbody>
                    {visibleOffers.map(({ offer, index }) => (
                    <tr key={`${offer.productId || offer.affiliateUrl}-${index}`} className="border-b border-zinc-100">
                      <td className="px-2 py-3"><input type="checkbox" aria-label={`Salvar ${offer.title}`} checked={selected.has(index)} disabled={!offer.category || save.isPending || classify.isPending} onChange={() => toggle(index)} /></td>
                        <td className="px-2 py-3"><div className="flex min-w-48 items-center gap-2">{offer.imageUrl && <img src={offer.imageUrl} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" />}<div><span>{offer.title}</span><ProductExtensionEvidence evidence={offer.extensionEvidence} />{provenanceByIndex.get(index) && <p className="mt-1 text-xs text-zinc-500">{importOriginLabel(index, provenanceByIndex.get(index))}</p>}</div>{savedKeys.has(offer.source && offer.productId ? `${offer.source}:${offer.productId}` : offer.affiliateUrl) && <Badge tone="green">Salvo</Badge>}</div></td>
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
          <div className="mt-3 flex items-center justify-between gap-3 text-sm"><Button variant="secondary" disabled={safeReviewPage === 1} onClick={() => setReviewPage(safeReviewPage - 1)}>Anterior</Button><span>Página {safeReviewPage} de {reviewPageCount} · {filteredOffers.length} resultado(s)</span><Button variant="secondary" disabled={safeReviewPage === reviewPageCount} onClick={() => setReviewPage(safeReviewPage + 1)}>Próxima</Button></div>
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
                <Input className="pl-9" value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(1) }} placeholder="Buscar nos produtos carregados" aria-label="Buscar no catálogo carregado" />
              </div>
              <select value={catalogGroupId} onChange={(event) => { setCatalogGroupId(event.target.value); setCatalogPage(1) }} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Filtrar catálogo por grupo de produtos">
                <option value="all">Todos os grupos</option>
                {(productGroups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <select value={catalogProfileId} onChange={(event) => { setCatalogProfileId(event.target.value); setCatalogPage(1) }} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Filtrar catálogo por perfil de classificação">
                <option value="all">Todos os nichos</option>
                {catalogProfileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <select value={catalogCategory} onChange={(event) => { setCatalogCategory(event.target.value as typeof catalogCategory); setCatalogPage(1) }} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" aria-label="Filtrar catálogo salvo por categoria">
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
              <button type="button" className="text-sm text-violet-700 underline" disabled={assignGroups.isPending} onClick={() => setSelectedSavedIds(new Set(pagedSavedItems.map((item) => item.id)))}>Selecionar página</button><button type="button" className="text-sm text-violet-700 underline" disabled={assignGroups.isPending} onClick={() => setSelectedSavedIds(new Set(visibleSavedItems.map((item) => item.id)))}>Selecionar filtrados ({visibleSavedItems.length})</button>
              {selectedSavedIds.size > 0 && <button type="button" className="text-sm text-zinc-600 underline" disabled={assignGroups.isPending} onClick={() => setSelectedSavedIds(new Set())}>Limpar seleção</button>}
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
            {pagedSavedItems.map((item) => {
              const flag = delivery.data?.[offerIdentity({
                ...item.offer,
                savedProductId: item.offer.savedProductId ?? item.id,
              })]
              const itemGroups = (productGroups.data ?? []).filter((group) => item.groupIds?.includes(group.id))
              const itemClassifications = Object.entries(item.classifications ?? {})
              return (
                <div key={item.id} className="grid gap-2 border-b border-zinc-100 py-3 text-sm md:grid-cols-[auto_minmax(0,1fr)_minmax(12rem,auto)_minmax(13rem,auto)_auto] md:items-start">
                  <input type="checkbox" className="mt-1" checked={selectedSavedIds.has(item.id)} disabled={assignGroups.isPending} onChange={() => toggleSaved(item.id)} aria-label={`Selecionar ${item.offer.title} para organizar em grupos`} />
                  <div className="min-w-0"><p className="truncate font-medium" title={item.offer.title}>{item.offer.title}</p><ProductExtensionEvidence evidence={item.offer.extensionEvidence} /></div>
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
            <div className="flex items-center justify-between gap-3 text-sm"><Button variant="secondary" disabled={safeCatalogPage === 1} onClick={() => setCatalogPage(safeCatalogPage - 1)}>Anterior</Button><span>Página {safeCatalogPage} de {catalogPageCount}</span><Button variant="secondary" disabled={safeCatalogPage === catalogPageCount} onClick={() => setCatalogPage(safeCatalogPage + 1)}>Próxima</Button></div>
            <p className="text-xs text-zinc-500">Mostrando {savedItems.length} de {catalog.data?.pages[0]?.total ?? savedItems.length} produtos.</p>
            {catalog.hasNextPage && <Button variant="secondary" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>{catalog.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</Button>}
          </div>
        ) : <p className="mt-4 text-sm text-zinc-600">Nenhum produto salvo. Classifique um JSON e escolha os produtos acima.</p>}
      </Card>
    </div>
  )
}
