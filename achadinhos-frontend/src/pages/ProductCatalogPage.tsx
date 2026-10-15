import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileJson, FolderPlus, ImageOff, Pencil, Search, Tags, Upload, X } from 'lucide-react'
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
import { classificationFeedbackMessage, hasUnsavedImportWork } from '@/lib/catalogImportState'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/DataTable'
import { Badge, Button, Card, Input, Label, Spinner } from '@/components/ui'
import { BrandPattern } from '@/components/BrandPattern'
import { ClassificationProfilePanel } from '@/components/ClassificationProfilePanel'
import { ImportFeedbackList } from '@/components/ImportFeedbackList'
import { ProductExtensionEvidence } from '@/components/ProductExtensionEvidence'
import { ProductDeliveryStatus } from '@/components/ProductDeliveryStatus'
import './product-catalog.css'

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
  const [activeView, setActiveView] = useState<'catalog' | 'import'>('catalog')
  const [jsonText, setJsonText] = useState('')
  const [importFiles, setImportFiles] = useState<ImportFileEntry[]>([])
  const importFilesRef = useRef<ImportFileEntry[]>([])
  const nextFileId = useRef(1)
  const classificationRunning = useRef(false)
  const cancelRequested = useRef(false)
  useEffect(() => () => { cancelRequested.current = true }, [])
  const [session, setSession] = useState<ImportSession | null>(null)
  const [savedImportIndexes, setSavedImportIndexes] = useState<Set<number>>(new Set())
  const [profileDirty, setProfileDirty] = useState(false)
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
      if (mode === 'new') { setSavedImportIndexes(new Set()); setSelected(new Set()); setReviewPage(1); setCategoryFilter('all'); setSaveProgress(null) }
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
        { retryFailed: mode === 'failed', cancelled: () => cancelRequested.current, onProgress: publishSession, errorMessage: (cause) => classificationFeedbackMessage(apiErrorMessage(cause)) },
      )
    },
    onSuccess: publishSession,
    onSettled: () => { classificationRunning.current = false },
    onError: (cause) => setError(classificationFeedbackMessage(apiErrorMessage(cause))),
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
      let merged = 0
      setSaveProgress({ ...progress })
      setError(null)
      await saveInChunks(entries,
        async (batch) => {
          const data = await savedProductApi.save(batch.map(({ offer }) => offer))
          created += data.created
          updated += data.updated
          merged += data.merged ?? 0
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
          setSavedImportIndexes((current) => new Set([...current, ...batch.map(({ index }) => index)]))
          setSelected((current) => { const next = new Set(current); batch.forEach(({ index }) => next.delete(index)); return next })
          setSaveProgress({ ...progress })
        },
        (batch, cause) => { progress.failed += batch.length; setSaveProgress({ ...progress }); setError(apiErrorMessage(cause)) },
        () => cancelRequested.current,
      )
      if (failedGroupIds.size) setGroupRetry({ productIds: [...failedGroupIds], groupIds })
      setFeedback(`${created} produto(s) criado(s), ${updated} atualizado(s)${merged ? `, ${merged} duplicado(s) unificado(s) automaticamente` : ''}. ${progress.failed} falha(s), ${progress.total - progress.saved - progress.failed} pendente(s). A seleção mantém apenas os produtos que ainda precisam ser salvos.`)
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
    setSavedImportIndexes(new Set())
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

  // A filter change starts a fresh selection; bulk actions never include hidden filters.
  const changeCatalogFilter = <T,>(setter: (value: T) => void, value: T) => {
    setter(value)
    setCatalogPage(1)
    setSelectedSavedIds(new Set())
    if (selectedSavedIds.size) setCatalogFeedback('Seleção limpa após alterar os filtros. Selecione os produtos que deseja organizar.')
  }
  const selectedOnOtherPages = [...selectedSavedIds].filter((id) => !pagedSavedItems.some((item) => item.id === id)).length

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

  const importDirty = hasUnsavedImportWork({
    session,
    savedIndexes: savedImportIndexes,
    hasInput: !!jsonText.trim() || importFiles.length > 0,
    working: classify.isPending || save.isPending || retryGroups.isPending,
    hasPendingGroups: !!groupRetry?.productIds.length,
  })
  const productDirty = !!(editOffer && originalEditOffer && Object.keys(changedOfferFields(originalEditOffer, editOffer)).length)
  const { prompt } = useUnsavedChanges(
    importDirty || productDirty || profileDirty,
    'Há arquivos, avaliações de produtos ou alterações que ainda não foram salvos. Sair descarta esse trabalho, incluindo avaliações já realizadas. Continue nesta página para salvar os produtos ou concluir os lotes pendentes.',
  )

  return (
    <div className="workspace-page catalog-workspace">
      {prompt}
      <header className="page-header">
        <div>
          <h1 className="page-title">Produtos</h1>
          <p className="page-description">Organize suas ofertas, confira os envios e prepare a próxima campanha.</p>
        </div>
        <Link to="/compose" className="catalog-primary-link">Criar campanha</Link>
      </header>
      <nav className="catalog-navigation" aria-label="Áreas de produtos">
        <button type="button" aria-pressed={activeView === 'catalog'} onClick={() => setActiveView('catalog')}>Catálogo salvo <span>{catalog.data?.pages[0]?.total ?? '—'}</span></button>
        <button type="button" aria-pressed={activeView === 'import'} onClick={() => setActiveView('import')}>Importar e classificar{classify.isPending ? <span>Em andamento</span> : result ? <span>{result.offers.length} para revisar</span> : null}</button>
      </nav>

      <div hidden={activeView !== 'import'} className="catalog-import-flow space-y-5">
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <FileJson size={18} className="text-accent" />
          <h2 className="section-heading">Importar produtos</h2>
        </div>
        <p className="mb-4 text-sm text-muted">Adicione os arquivos, escolha o público e revise as avaliações antes de salvar no catálogo.</p>
        <ClassificationProfilePanel
          profiles={classificationProfiles.data ?? []}
          selectedId={classificationProfileId}
          onSelect={setClassificationProfileId}
          isLoading={classificationProfiles.isPending}
          isError={classificationProfiles.isError}
          disabled={classify.isPending || save.isPending}
          onRetry={() => { void classificationProfiles.refetch() }}
          onDirtyChange={setProfileDirty}
        />
        <div className="mt-5">
        <label htmlFor="catalog-json" className="mb-1 block text-sm font-medium text-ink">JSON colado (opcional)</label>
        <textarea
          id="catalog-json"
          value={jsonText}
          disabled={classify.isPending || save.isPending}
          onChange={(event) => updateText(event.target.value)}
          placeholder="Cole um array de produtos ou um JSON exportado de um marketplace"
          className="catalog-json-input h-36 w-full rounded-lg border border-line-strong bg-surface text-ink p-3 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
          <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="catalog-upload-control inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted focus-within:ring-2 focus-within:ring-accent">
            <Upload size={16} /> Adicionar arquivos JSON
            <input type="file" accept=".json,application/json" multiple className="sr-only" disabled={classify.isPending || save.isPending} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          </label>
          <Button onClick={() => classify.mutate('new')} disabled={!!inputError || readingFiles || classify.isPending || save.isPending || classificationProfiles.isPending || classificationProfiles.isError}>
            {classify.isPending ? 'Classificando…' : session ? 'Iniciar nova classificação' : 'Classificar produtos'}
          </Button>
        </div>
        </div>
        {importFiles.length > 0 && <div className="mt-3 rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-3 text-sm"><span>{importFiles.length} arquivo(s) · {(totalFileBytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB{readingFiles ? ' · Lendo arquivos…' : ''}</span><button type="button" className="text-muted underline" disabled={classify.isPending || save.isPending} onClick={() => { replaceFiles([]); setFileError(null); resetClassification() }}>Limpar arquivos</button></div>
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">{importFiles.map((file) => <li key={file.id} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><span className="break-all font-medium">{file.name}</span> · {(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB · {file.status === 'reading' ? 'Lendo…' : file.status === 'ready' ? 'Pronto' : 'Erro'}{file.error && <p role="alert" className="text-xs text-danger">{file.error}</p>}</div><button type="button" className="text-muted underline" aria-label={`Remover arquivo ${file.name}`} disabled={classify.isPending || save.isPending} onClick={() => removeFile(file.id)}>Remover</button></li>)}</ul>
        </div>}
        {inputError && (importFiles.length > 0 || jsonText.trim()) && <p role="status" className="mt-3 text-sm text-warning">{inputError}</p>}
        <p className="mt-3 text-xs text-muted">Até 50 arquivos e 5.000 itens somados, com envio de até 32 MB. Cada arquivo mantém seu formato; produtos repetidos são avaliados uma única vez. A classificação usa lotes de 4. Cada avaliação usa Jev e pode ter custo. Os resultados concluídos ficam disponíveis durante esta sessão.</p>
        {summary && <div role="status" aria-live="polite" className="mt-3 rounded-lg bg-accent-soft p-3 text-sm text-accent">
          {summary.classified} classificado(s) · {summary.failed} falha(s) · {summary.skipped} inválido(s)/ignorado(s) · {session!.duplicateCount ?? 0} duplicado(s) · {summary.pending} pendente(s) de {session!.totalSeen} item(ns).
          <progress className="mt-2 w-full accent-accent" value={session!.totalSeen - summary.pending} max={Math.max(1, session!.totalSeen)} aria-label="Progresso da classificação" />
          <div className="mt-2 flex flex-wrap gap-3">
            {classify.isPending ? <Button variant="secondary" onClick={() => { cancelRequested.current = true }}>Parar após o lote atual</Button> : <>
              {summary.pending > 0 && <Button variant="secondary" disabled={save.isPending} onClick={() => classify.mutate('pending')}>Continuar pendentes</Button>}
              {session!.items.some((item) => item.status === 'failed' && item.retryable) && <Button variant="secondary" disabled={save.isPending} onClick={() => classify.mutate('failed')}>Tentar falhas novamente</Button>}
            </>}
          </div>
          <p className="mt-2 text-xs">Continuar e tentar falhas preservam as avaliações concluídas e o perfil original. Alterar o JSON inicia uma nova sessão; mantenha esta página aberta até salvar.</p>
        </div>}
        {session && <>
          {(session.files?.length ?? 0) > 0 && <div className="mt-3"><Table scrollLabel="Progresso por arquivo: role para ver todas as colunas" className="catalog-file-table w-full text-left text-xs"><TableCaption className="caption-top mb-2 text-left font-medium text-ink">Resumo e progresso de cada arquivo</TableCaption><TableHeader><TableRow className="border-b border-line"><TableHead className="px-2 py-2">Arquivo</TableHead><TableHead className="px-2 py-2">Formato</TableHead><TableHead className="px-2 py-2">Itens</TableHead><TableHead className="px-2 py-2">Válidos únicos</TableHead><TableHead className="px-2 py-2">Inválidos</TableHead><TableHead className="px-2 py-2">Duplicados</TableHead><TableHead className="px-2 py-2">Avisos</TableHead><TableHead className="px-2 py-2">Classificados</TableHead><TableHead className="px-2 py-2">Falhas</TableHead><TableHead className="px-2 py-2">Pendentes</TableHead></TableRow></TableHeader><TableBody>{session.files!.map((file) => <TableRow key={file.fileIndex} className="border-b border-line"><TableCell className="px-2 py-2">{file.name}</TableCell><TableCell className="px-2 py-2">{file.source}</TableCell><TableCell className="px-2 py-2">{file.totalSeen}</TableCell><TableCell className="px-2 py-2">{file.imported}</TableCell><TableCell className="px-2 py-2">{file.invalid}</TableCell><TableCell className="px-2 py-2">{file.duplicates}</TableCell><TableCell className="px-2 py-2">{file.warnings}</TableCell><TableCell className="px-2 py-2">{fileProgress.get(file.fileIndex)?.classified ?? 0}</TableCell><TableCell className="px-2 py-2">{fileProgress.get(file.fileIndex)?.failed ?? 0}</TableCell><TableCell className="px-2 py-2">{fileProgress.get(file.fileIndex)?.pending ?? 0}</TableCell></TableRow>)}</TableBody></Table></div>}
          <ImportFeedbackList title="Falhas da classificação" entries={session.items.filter((item) => item.status === 'failed').map((item) => ({ key: item.sourceIndex, message: `${importOriginLabel(item.sourceIndex, item.provenance)}: ${item.offer.title}. ${classificationFeedbackMessage(item.message)}` }))} />
          <ImportFeedbackList title="Avisos de importação" entries={session.warnings.map((warning, index) => ({ key: index, message: `${warning.fileName ? `${warning.fileName} · item ${(warning.itemIndex ?? warning.index) + 1}` : `Item ${warning.index + 1}`}: ${warning.message}` }))} />
          <ImportFeedbackList title="Produtos duplicados, avaliados somente na primeira ocorrência" entries={(session.duplicates ?? []).map((duplicate) => ({ key: duplicate.index, message: `${importOriginLabel(duplicate.index, duplicate)}: repetido do item global ${duplicate.duplicateOf + 1}.` }))} />
        </>}

        {groupRetry && <div role="alert" className="mt-3 rounded-lg bg-warning-soft p-3 text-sm text-warning">{groupRetry.productIds.length} produto(s) salvo(s) aguardam atribuição aos grupos.<div className="mt-2 flex flex-wrap gap-3"><button className="underline" disabled={retryGroups.isPending || save.isPending} onClick={() => retryGroups.mutate()}>Tentar atribuição novamente</button><button className="underline" disabled={retryGroups.isPending || save.isPending} onClick={() => { setGroupRetry(null); setError(null); setFeedback('Os produtos continuam salvos. A atribuição pendente aos grupos foi dispensada.') }}>Manter salvos sem estes grupos</button></div></div>}
        {fileError && <p role="alert" className="mt-3 text-sm text-danger">{fileError}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {feedback && <div className="mt-3"><p role="status" className="flex items-start gap-2 text-sm text-success"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{feedback}</p><button type="button" className="mt-2 text-sm text-accent underline" onClick={() => setActiveView('catalog')}>Ver catálogo salvo</button></div>}
      </Card>

      {result && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Revisar classificação</h2>
              <p className="text-sm text-muted">{result.offers.length} produto(s) reconhecido(s) de {result.totalSeen} nos dados enviados.</p>
              <p role="status" className="mt-1 text-xs text-muted">{selected.size} selecionado(s) para salvar{[...selected].some((index) => !visibleOffers.some((item) => item.index === index)) ? ', incluindo produtos de outras páginas' : ''}.</p>
              {result.categorization?.profile && <p className="mt-1 text-xs text-accent">Perfil usado: <strong>{result.categorization.profile.name}</strong></p>}
            </div>
            <Button onClick={() => save.mutate()} disabled={selected.size === 0 || save.isPending || classify.isPending || !!groupRetry}>
              {save.isPending ? 'Salvando…' : `Salvar ${selected.size} selecionado(s)`}
            </Button>
          </div>
          {saveProgress && <p role="status" className="mt-2 text-sm text-muted">Salvamento: {saveProgress.saved} concluído(s), {saveProgress.failed} falha(s), {saveProgress.total - saveProgress.saved - saveProgress.failed} pendente(s).</p>}
            {save.isPending && <Button variant="secondary" className="mt-2" onClick={() => { cancelRequested.current = true }}>Parar salvamento após o lote atual</Button>}

          {(productGroups.data?.length ?? 0) > 0 && (
            <fieldset className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
              <legend className="px-1 text-sm font-medium text-ink">Adicionar os produtos salvos a grupos</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {(productGroups.data ?? []).map((group) => (
                  <label key={group.id} className="inline-flex items-center gap-2 text-sm text-ink">
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
              <p className="mt-2 text-xs text-muted">A seleção vale para este salvamento e pode ser alterada depois no catálogo.</p>
            </fieldset>
          )}
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Filtrar por categoria">
              <button type="button" aria-pressed={categoryFilter === 'all'} onClick={() => { setCategoryFilter('all'); setReviewPage(1); setSelected(new Set()) }} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === 'all' ? 'ring-2 ring-accent' : ''}`}><Badge>Todos: {result.offers.length}</Badge></button>
              {CATEGORIES.map((category) => <button type="button" key={category} aria-pressed={categoryFilter === category} onClick={() => { setCategoryFilter(category); setReviewPage(1); setSelected(new Set()) }} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === category ? 'ring-2 ring-accent' : ''}`}><Badge tone={TONES[category]}>{category}: {counts[category]}</Badge></button>)}
              {counts.uncategorized > 0 && <Badge>Sem categoria: {counts.uncategorized}</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted">A combina alta afinidade com o nicho, desconto e comissão; D indica baixa prioridade. A afinidade aparece junto à categoria. Mudar a categoria limpa a seleção; mudar de página a mantém.</p>
            {result.offers.some((offer) => !!offer.category) && <div className="mt-3 flex flex-wrap gap-4 text-sm"><button type="button" className="text-accent underline" disabled={save.isPending || classify.isPending} onClick={selectVisible}>Selecionar página</button><button type="button" className="text-accent underline" disabled={save.isPending || classify.isPending} onClick={() => setSelected(new Set(filteredOffers.filter(({ offer }) => !!offer.category).map(({ index }) => index)))}>Selecionar filtrados ({filteredOffers.length})</button><button type="button" className="text-muted underline" disabled={save.isPending || classify.isPending} onClick={() => setSelected(new Set())}>Limpar seleção</button></div>}
          {counts.uncategorized > 0 && <p className="mt-2 text-sm text-warning">Produtos sem categoria não podem ser salvos. Confira os avisos da importação.</p>}
          {result.errors.length > 0 && <p className="mt-3 text-sm text-warning">{result.errors.length} aviso(s) de importação. {result.errors.slice(0, 3).map((item) => item.message).join(' ')}</p>}
            {visibleOffers.length === 0 ? (
              <p className="mt-5 text-sm text-muted">Nenhum produto nesta categoria.</p>
          ) : (
            <div className="mt-4">
              <Table scrollLabel="Produtos importados para revisão" role="table" className="catalog-review-table w-full text-left text-sm">
                <TableCaption className="sr-only">Produtos importados para revisão e seleção</TableCaption>
                  <TableHeader><TableRow className="border-b border-line text-xs text-muted"><TableHead className="px-2 py-2">Salvar</TableHead><TableHead className="px-2 py-2">Produto</TableHead><TableHead className="px-2 py-2">Categoria</TableHead><TableHead className="px-2 py-2">Desconto</TableHead><TableHead className="px-2 py-2">Comissão</TableHead><TableHead className="px-2 py-2">Preço</TableHead><TableHead className="px-2 py-2">Link</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {visibleOffers.map(({ offer, index }) => (
                    <TableRow key={`${offer.productId || offer.affiliateUrl}-${index}`} data-state={selected.has(index) ? 'selected' : undefined} aria-selected={selected.has(index)} className="border-b border-line">
                      <TableCell data-label="Salvar" className="px-2 py-3"><input type="checkbox" aria-label={`Salvar ${offer.title}`} checked={selected.has(index)} disabled={!offer.category || save.isPending || classify.isPending} onChange={() => toggle(index)} /></TableCell>
                        <TableCell data-label="Produto" className="catalog-review-product px-2 py-3"><div className="flex min-w-0 items-center gap-2">{offer.imageUrl && <img src={offer.imageUrl} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg border border-line bg-white object-contain" />}<div><span>{offer.title}</span><ProductExtensionEvidence evidence={offer.extensionEvidence} /><p className="mt-1 text-xs text-muted">{provenanceByIndex.get(index) ? importOriginLabel(index, provenanceByIndex.get(index)) : `JSON colado • item ${index + 1}`}</p></div>{savedKeys.has(offer.source && offer.productId ? `${offer.source}:${offer.productId}` : offer.affiliateUrl) && <Badge tone="green">Salvo</Badge>}</div></TableCell>
                        <TableCell data-label="Categoria" className="px-2 py-3">{offer.category ? <span title={`Afinidade com o nicho: ${offer.relevanceScore ?? '—'}/100`}><Badge tone={TONES[offer.category]}>Categoria {offer.category}</Badge><span className="mt-1 block text-xs text-muted">Afinidade {offer.relevanceScore ?? '—'}/100</span></span> : <Badge>Sem categoria</Badge>}</TableCell>
                        <TableCell data-label="Desconto" className="whitespace-nowrap px-2 py-3">{offer.discountPercent != null ? `${offer.discountPercent}%` : '—'}</TableCell>
                        <TableCell data-label="Comissão" className="whitespace-nowrap px-2 py-3">{offer.commissioned === false ? 'Sem comissão' : offer.commissionRate != null ? `${offer.commissionRate}%` : '—'}</TableCell>
                      <TableCell data-label="Preço" className="whitespace-nowrap px-2 py-3 font-semibold tabular-nums"><span className="catalog-price catalog-price-small">{money(offer.discountedPrice)}</span></TableCell>
                      <TableCell data-label="Oferta" className="px-2 py-3"><a aria-label={`Abrir oferta de ${offer.title}`} href={offer.affiliateUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Abrir</a></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="catalog-pagination mt-3 flex items-center justify-between gap-3 text-sm"><Button variant="secondary" disabled={safeReviewPage === 1} onClick={() => setReviewPage(safeReviewPage - 1)}>Anterior</Button><span>Página {safeReviewPage} de {reviewPageCount} · {filteredOffers.length} resultado(s)</span><Button variant="secondary" disabled={safeReviewPage === reviewPageCount} onClick={() => setReviewPage(safeReviewPage + 1)}>Próxima</Button></div>
        </Card>
      )}

      </div>
      <section hidden={activeView !== 'catalog'} className="catalog-saved-surface" aria-labelledby="saved-catalog-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="saved-catalog-heading" className="section-heading">Ofertas do seu catálogo</h2><p className="mt-1 text-sm text-muted">Confira o produto e os envios antes de escolher a próxima divulgação.</p></div>
          <Button type="button" variant="secondary" onClick={() => setActiveView('import')}><Upload size={15} /> Importar produtos</Button>
        </div>
        {groups.isError && (
          <p role="alert" className="mt-3 text-sm text-warning">
            Não foi possível carregar os grupos conectados. O histórico enviado continua disponível,
            mas os grupos que ainda faltam só aparecem depois de reconectar o WhatsApp.
            {' '}<button type="button" className="underline" onClick={() => void groups.refetch()}>Tentar novamente</button>
          </p>
        )}
        {delivery.isError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            Não foi possível carregar o histórico de envios.
            {' '}<button type="button" className="underline" onClick={() => void delivery.refetch()}>Tentar novamente</button>
          </p>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
        {catalogFeedback && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 size={16} />{catalogFeedback}</p>}
        <details className="mt-4 rounded-xl border border-line bg-surface-muted p-4 catalog-group-manager">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Tags size={17} className="text-accent" />Organizar grupos de produtos <span className="ml-auto text-xs font-normal text-muted">{productGroups.data?.length ?? 0} grupos</span></summary>
          <p className="mt-1 text-xs text-muted">Um produto pode ficar em vários grupos. Use os grupos para organizar seleções por tema, campanha ou público.</p>
          {productGroups.isPending ? <div className="mt-3"><Spinner /></div> : productGroups.isError ? (
            <p role="alert" className="mt-3 text-sm text-danger">Não foi possível carregar os grupos de produtos. <button type="button" className="underline" onClick={() => void productGroups.refetch()}>Tentar novamente</button></p>
          ) : (
            <>
              <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const name = newGroupName.trim(); if (name) createGroup.mutate(name) }}>
                <Input value={newGroupName} maxLength={120} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Nome do novo grupo" aria-label="Nome do novo grupo de produtos" />
                <Button type="submit" variant="secondary" disabled={!newGroupName.trim() || createGroup.isPending}><FolderPlus size={15} />{createGroup.isPending ? 'Criando…' : 'Criar grupo'}</Button>
              </form>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {(productGroups.data ?? []).map((group) => (
                  <div key={group.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                    {renamingGroupId === group.id ? (
                      <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); const name = renamingGroupName.trim(); if (name) renameGroup.mutate({ id: group.id, name }) }}>
                        <Input autoFocus value={renamingGroupName} maxLength={120} onChange={(event) => setRenamingGroupName(event.target.value)} aria-label={`Novo nome para ${group.name}`} />
                        <Button type="submit" className="px-3" disabled={!renamingGroupName.trim() || renameGroup.isPending}>Salvar</Button>
                        <Button type="button" className="px-3" variant="ghost" onClick={() => setRenamingGroupId(null)}>Cancelar</Button>
                      </form>
                    ) : (
                      <>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => changeCatalogFilter(setCatalogGroupId, String(group.id))} disabled={assignGroups.isPending} title={`Filtrar por ${group.name}`}>
                          <span className="truncate font-medium">{group.name}</span>
                          <span className="ml-2 text-xs text-muted">{group.productCount} produto(s)</span>
                          {group.isDefault && <span className="ml-2"><Badge>Padrão</Badge></span>}
                        </button>
                        {!group.isDefault && (
                          <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                            <button type="button" className="text-accent underline" aria-label={`Renomear grupo ${group.name}`} onClick={() => { setRenamingGroupId(group.id); setRenamingGroupName(group.name); setGroupError(null) }}>Renomear</button>
                            {deleteGroupConfirmId === group.id ? <>
                              <span className="text-danger">Remover o grupo? Os produtos continuam salvos.</span>
                              <button type="button" className="font-semibold text-danger underline" disabled={deleteGroup.isPending} onClick={() => deleteGroup.mutate(group.id)}>Confirmar</button>
                              <button type="button" className="text-muted underline" onClick={() => setDeleteGroupConfirmId(null)}>Cancelar</button>
                            </> : <button type="button" className="text-danger underline" aria-label={`Remover grupo ${group.name}`} onClick={() => setDeleteGroupConfirmId(group.id)}>Remover</button>}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {groupError && <p role="alert" className="mt-3 text-sm text-danger">{groupError}</p>}
          {groupFeedback && <p role="status" className="mt-3 text-sm text-success">{groupFeedback}</p>}
        </details>
        {savedItems.length > 0 && (
          <div className="catalog-results-toolbar mt-4 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-subtle" />
                <Input className="pl-9" disabled={assignGroups.isPending} value={catalogSearch} onChange={(event) => { changeCatalogFilter(setCatalogSearch, event.target.value) }} placeholder="Buscar nos produtos carregados" aria-label="Buscar no catálogo carregado" />
              </div>
              <select disabled={assignGroups.isPending} value={catalogGroupId} onChange={(event) => { changeCatalogFilter(setCatalogGroupId, event.target.value) }} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" aria-label="Filtrar catálogo por grupo de produtos">
                <option value="all">Todos os grupos</option>
                {(productGroups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <select disabled={assignGroups.isPending} value={catalogProfileId} onChange={(event) => { changeCatalogFilter(setCatalogProfileId, event.target.value) }} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" aria-label="Filtrar catálogo por perfil de classificação">
                <option value="all">Todos os nichos</option>
                {catalogProfileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <select disabled={assignGroups.isPending} value={catalogCategory} onChange={(event) => { changeCatalogFilter(setCatalogCategory, event.target.value as typeof catalogCategory) }} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" aria-label="Filtrar catálogo salvo por categoria">
                <option value="all">Todas as categorias</option>
                {CATEGORIES.map((category) => <option key={category} value={category}>Categoria {category}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted">
              {visibleSavedItems.length} resultado(s) entre {savedItems.length} produto(s) carregado(s).
              {(catalog.data?.pages[0]?.total ?? savedItems.length) > savedItems.length
                ? ' Carregue mais para pesquisar o restante do catálogo.'
                : ' Todo o catálogo está carregado.'}
            </p>
            <p className="text-xs text-muted">Ao mudar a busca, o grupo, o nicho ou a categoria, a seleção é limpa.</p>
            <div data-active={selectedSavedIds.size > 0} className="catalog-bulk-actions flex flex-wrap items-center gap-3">
              <button type="button" className="text-sm text-accent underline" disabled={assignGroups.isPending || pagedSavedItems.length === 0} onClick={() => setSelectedSavedIds(new Set(pagedSavedItems.map((item) => item.id)))}>Selecionar página</button><button type="button" className="text-sm text-accent underline" disabled={assignGroups.isPending || visibleSavedItems.length === 0} onClick={() => setSelectedSavedIds(new Set(visibleSavedItems.map((item) => item.id)))}>Selecionar filtrados ({visibleSavedItems.length})</button>
              {selectedSavedIds.size > 0 && <button type="button" className="text-sm text-muted underline" disabled={assignGroups.isPending} onClick={() => setSelectedSavedIds(new Set())}>Limpar seleção</button>}
              <span role="status" className="catalog-selection-count text-xs text-muted"><strong>{selectedSavedIds.size}</strong> selecionado(s){selectedOnOtherPages > 0 ? `, incluindo ${selectedOnOtherPages} em outras páginas deste filtro` : ''}</span>
              {selectedSavedIds.size > 0 && <>
              <select value={assignmentGroupId} onChange={(event) => setAssignmentGroupId(event.target.value)} className="h-9 min-w-48 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" aria-label="Grupo para atribuição em massa">
                <option value="">Escolha um grupo</option>
                {(productGroups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <Button type="button" className="px-3 py-1.5" disabled={selectedSavedIds.size === 0 || !assignmentGroupId || assignGroups.isPending} onClick={() => assignGroups.mutate('add')}>Adicionar ao grupo</Button>
              <Button type="button" variant="secondary" className="px-3 py-1.5" disabled={selectedSavedIds.size === 0 || !assignmentGroupId || assignGroups.isPending} onClick={() => assignGroups.mutate('remove')}>Remover do grupo</Button>
              </>}
            </div>
          </div>
        )}
        {catalog.isPending ? <div className="mt-4"><Spinner /></div> : catalog.isError ? (
          <p role="alert" className="mt-4 text-sm text-danger">Não foi possível carregar o catálogo. <button type="button" className="underline" onClick={() => void catalog.refetch()}>Tentar novamente</button></p>
        ) : savedItems.length ? (
          <div className="catalog-products-list mt-4 space-y-2">
            {visibleSavedItems.length > 0 && <div className="catalog-list-heading" aria-hidden="true"><span /> <span>Oferta</span><span>Classificação e grupos</span><span>Envios no WhatsApp</span></div>}
            {pagedSavedItems.map((item) => {
              const flag = delivery.data?.[offerIdentity({
                ...item.offer,
                savedProductId: item.offer.savedProductId ?? item.id,
              })]
              const itemGroups = (productGroups.data ?? []).filter((group) => item.groupIds?.includes(group.id))
              const itemClassifications = Object.entries(item.classifications ?? {})
              return (
                <article key={item.id} data-selected={selectedSavedIds.has(item.id)} className="catalog-product-row text-sm" aria-label={item.offer.title}>
                  <label className="catalog-product-select"><input type="checkbox" checked={selectedSavedIds.has(item.id)} disabled={assignGroups.isPending} onChange={() => toggleSaved(item.id)} aria-label={`Selecionar ${item.offer.title} para organizar em grupos`} /></label>
                  <div className="catalog-product-main min-w-0">
                    <div className="catalog-product-image">{item.offer.imageUrl ? <img src={item.offer.imageUrl} alt="" loading="lazy" /> : <ImageOff size={22} aria-hidden="true" />}</div>
                    <div className="min-w-0"><a href={item.offer.affiliateUrl} target="_blank" rel="noopener noreferrer" className="catalog-product-title">{item.offer.title}</a>
                      <div className="catalog-product-pricing"><span className="catalog-price">{money(item.offer.discountedPrice)}</span>{item.offer.originalPrice != null && item.offer.originalPrice > item.offer.discountedPrice && <del className="text-xs text-muted">{money(item.offer.originalPrice)}</del>}{item.offer.discountPercent != null && <span className="text-xs font-medium text-success">{item.offer.discountPercent}% de desconto</span>}</div>
                      <p className="mt-1 break-words text-xs text-muted">{item.offer.source ?? 'Importação genérica'}{item.offer.productId ? ` • ${item.offer.productId}` : ''}</p>
                      <ProductExtensionEvidence evidence={item.offer.extensionEvidence} />
                    </div>
                  </div>
                  <div className="catalog-product-classification space-y-1">
                    <div className="flex flex-wrap gap-1">
                      {itemClassifications.length > 0 ? itemClassifications.map(([profileId, classification]) => (
                        <span key={profileId} title={`Afinidade: ${classification.relevanceScore ?? '—'}/100 · classificado em ${new Date(classification.classifiedAt).toLocaleString('pt-BR')}`}>
                          <span className="catalog-grade" data-category={classification.category}><strong>{classification.category}</strong><span>{classification.profileName}</span></span>
                        </span>
                      )) : <span className="catalog-grade" data-category={item.offer.category}><strong>{item.offer.category || '—'}</strong><span>{item.offer.category ? item.offer.classificationProfileName ?? 'Categoria' : 'Sem categoria'}</span></span>}
                    </div>
                    {itemGroups.length > 0 && <p className="text-xs text-muted">Grupos: {itemGroups.map((group) => group.name).join(', ')}</p>}
                    {(item.manualOverrides?.length ?? 0) > 0 && <details className="text-xs text-muted"><summary className="cursor-pointer text-accent">Editado manualmente</summary><p className="mt-1">Campos ajustados: {item.manualOverrides?.map((field) => FIELD_LABELS[field] ?? field).join(', ')}.</p></details>}
                  </div>
                  {delivery.isPending ? (
                    <span className="catalog-product-delivery text-xs text-muted">Carregando histórico…</span>
                  ) : delivery.isError ? (
                    <span className="catalog-product-delivery text-xs text-danger">Histórico indisponível</span>
                  ) : (
                    <div className="catalog-product-delivery"><p className="catalog-delivery-label mb-1 text-xs text-muted">Envios no WhatsApp</p><ProductDeliveryStatus
                      groups={flag?.groups ?? []}
                      savedProductId={item.offer.savedProductId ?? item.id}
                      groupNames={groupNames}
                      compact
                      emptyLabel={groupIds.length > 0 ? 'Pronto para todos os grupos desta conexão' : 'Nunca enviado nesta conexão'}
                    /></div>
                  )}
                  <div className="catalog-product-actions flex flex-wrap gap-3">
                    <button type="button" disabled={update.isPending} onClick={() => startEditing(item)} className="catalog-edit-action inline-flex items-center gap-1 text-accent disabled:opacity-50" aria-label={`Editar ${item.offer.title}`}><Pencil size={13} />Editar</button>
                    {deleteConfirmId === item.id ? (
                      <span className="inline-flex flex-wrap items-center gap-2 text-xs text-danger">
                        Remover do catálogo? O histórico de envios é preservado.
                        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id, { onSuccess: () => setDeleteConfirmId(null) })} className="font-semibold underline disabled:opacity-50">Confirmar</button>
                        <button type="button" disabled={remove.isPending} onClick={() => setDeleteConfirmId(null)} className="text-muted underline">Cancelar</button>
                      </span>
                    ) : <button type="button" disabled={remove.isPending || update.isPending} onClick={() => setDeleteConfirmId(item.id)} className="catalog-remove-action text-muted disabled:opacity-50" aria-label={`Remover ${item.offer.title}`}>Remover</button>}
                  </div>
                  {editingId === item.id && editOffer && (
                    <form
                      className="col-span-full mt-2 rounded-lg border border-line bg-surface-muted p-4"
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
                          <h3 className="font-semibold text-ink">Editar produto</h3>
                          <p className="text-xs text-muted">A origem e o ID do produto identificam o histórico e não podem ser alterados.</p>
                        </div>
                        <button type="button" aria-label="Fechar edição" onClick={() => { setEditingId(null); setEditOffer(null); setOriginalEditOffer(null); setEditError(null) }} className="rounded p-1 text-muted hover:bg-surface"><X size={17} /></button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2"><Label htmlFor={`edit-title-${item.id}`}>Título</Label><Input id={`edit-title-${item.id}`} required value={editOffer.title} onChange={(event) => updateEdit('title', event.target.value)} /></div>
                        <div className="md:col-span-2"><Label htmlFor={`edit-description-${item.id}`}>Descrição</Label><textarea id={`edit-description-${item.id}`} value={editOffer.description ?? ''} onChange={(event) => updateEdit('description', event.target.value || undefined)} className="min-h-20 w-full rounded-lg border border-line-strong bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" /></div>
                        <div className="md:col-span-2"><Label htmlFor={`edit-affiliateUrl-${item.id}`}>Link afiliado</Label><Input id={`edit-affiliateUrl-${item.id}`} required type="url" value={editOffer.affiliateUrl} onChange={(event) => updateEdit('affiliateUrl', event.target.value)} /></div>
                        <div className="md:col-span-2"><Label htmlFor={`edit-imageUrl-${item.id}`}>URL da imagem</Label><Input id={`edit-imageUrl-${item.id}`} type="url" value={editOffer.imageUrl ?? ''} onChange={(event) => updateEdit('imageUrl', event.target.value || undefined)} /></div>
                        <div><Label htmlFor={`edit-discountedPrice-${item.id}`}>Preço atual</Label><Input id={`edit-discountedPrice-${item.id}`} required type="number" min="0.01" step="0.01" value={editOffer.discountedPrice} onChange={(event) => updateEdit('discountedPrice', Number(event.target.value))} /></div>
                        <div><Label htmlFor={`edit-originalPrice-${item.id}`}>Preço original</Label><Input id={`edit-originalPrice-${item.id}`} type="number" min="0.01" step="0.01" value={editOffer.originalPrice ?? ''} onChange={(event) => updateEdit('originalPrice', numberOrUndefined(event.target.value))} /></div>
                        <div><Label htmlFor={`edit-discountPercent-${item.id}`}>Desconto (%)</Label><Input id={`edit-discountPercent-${item.id}`} type="number" min="0" max="100" step="0.01" value={editOffer.discountPercent ?? ''} onChange={(event) => updateEdit('discountPercent', numberOrUndefined(event.target.value))} /></div>
                        <div><Label htmlFor={`edit-commissionRate-${item.id}`}>Comissão (%)</Label><Input id={`edit-commissionRate-${item.id}`} type="number" min="0" max="100" step="0.01" value={editOffer.commissionRate ?? ''} disabled={editOffer.commissioned === false} onChange={(event) => {
                          const rate = numberOrUndefined(event.target.value)
                          setEditOffer((current) => current ? {
                            ...current,
                            commissionRate: rate,
                            commissionPercent: rate === undefined ? undefined : `${rate}%`,
                          } : current)
                        }} /></div>
                        <div><Label htmlFor={`edit-coupon-${item.id}`}>Cupom</Label><Input id={`edit-coupon-${item.id}`} value={editOffer.coupon ?? ''} onChange={(event) => updateEdit('coupon', event.target.value || undefined)} /></div>
                        <div>
                          <label htmlFor={`edit-profile-${item.id}`} className="mb-1 block text-sm font-medium text-ink">Nicho da categoria</label>
                          <select
                            id={`edit-profile-${item.id}`}
                            value={editClassificationProfileId}
                            onChange={(event) => changeEditClassification(item, event.target.value)}
                            className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                          >
                            {(classificationProfiles.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{item.classifications?.[profile.id] ? '' : ' (sem avaliação)'}</option>)}
                            {(classificationProfiles.data?.length ?? 0) === 0 && <option value="default">Doméstico</option>}
                          </select>
                          <p className="mt-1 text-xs text-muted">Cada nicho mantém sua própria categoria.</p>
                        </div>
                        <div>
                          <Label htmlFor={`edit-category-${item.id}`}>Categoria (ajuste manual)</Label>
                          <select
                            id={`edit-category-${item.id}`}
                            value={editOffer.category ?? ''}
                            onChange={(event) => setEditOffer((current) => current ? {
                              ...current,
                              category: (event.target.value || undefined) as Offer['category'],
                            } : current)}
                            className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                          >
                            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                          <p className="mt-1 text-xs text-muted">A alteração afeta somente o nicho selecionado e passa a ser identificada como ajuste manual.</p>
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
                          <div className="rounded-md bg-surface p-3 text-xs text-muted md:col-span-2">
                            Origem: <strong>{editOffer.source ?? 'genérica'}</strong>
                            {editOffer.productId ? <> · ID: <strong>{editOffer.productId}</strong></> : null}
                          </div>
                        )}
                      </div>
                      {editError && <p role="alert" className="mt-3 text-sm text-danger">{editError}</p>}
                      <div className="mt-4 flex gap-2">
                        <Button type="submit" disabled={update.isPending || !editOffer.title.trim() || !editOffer.affiliateUrl.trim() || !originalEditOffer || Object.keys(changedOfferFields(originalEditOffer, editOffer)).length === 0}>{update.isPending ? 'Salvando…' : 'Salvar alterações'}</Button>
                        <Button type="button" variant="secondary" disabled={update.isPending} onClick={() => { setEditingId(null); setEditOffer(null); setOriginalEditOffer(null); setEditError(null) }}>Cancelar</Button>
                      </div>
                    </form>
                  )}
                </article>
              )
            })}
            {visibleSavedItems.length === 0 && <div className="catalog-empty-state"><BrandPattern variant="empty" className="catalog-empty-art" /><h3 className="font-semibold">Nenhum produto com estes filtros</h3><p className="text-sm text-muted">A busca considera somente os produtos carregados.</p><Button variant="secondary" onClick={() => { setCatalogSearch(''); setCatalogCategory('all'); setCatalogGroupId('all'); setCatalogProfileId('all'); setCatalogPage(1); setSelectedSavedIds(new Set()) }}>Limpar filtros</Button></div>}
            {visibleSavedItems.length > 0 && <div className="catalog-pagination flex items-center justify-between gap-3 text-sm"><Button variant="secondary" disabled={safeCatalogPage === 1} onClick={() => setCatalogPage(safeCatalogPage - 1)}>Anterior</Button><span>Página {safeCatalogPage} de {catalogPageCount}</span><Button variant="secondary" disabled={safeCatalogPage === catalogPageCount} onClick={() => setCatalogPage(safeCatalogPage + 1)}>Próxima</Button></div>}
            <p className="text-xs text-muted">Mostrando {savedItems.length} de {catalog.data?.pages[0]?.total ?? savedItems.length} produtos.</p>
            {catalog.hasNextPage && <Button variant="secondary" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>{catalog.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</Button>}
          </div>
        ) : <div className="catalog-empty-state"><BrandPattern variant="empty" className="catalog-empty-art" /><h3 className="font-semibold text-ink">Seu catálogo começa com uma oferta</h3><p className="text-sm text-muted">Importe um JSON, revise as categorias e salve os produtos que deseja divulgar.</p><Button onClick={() => setActiveView('import')}>Importar produtos</Button></div>}
      </section>
    </div>
  )
}
