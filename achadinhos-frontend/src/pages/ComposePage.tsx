import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search,
  Send,
  Clock,
  AlertTriangle,
  Package,
  RotateCcw,
  ImageOff,
  Image as ImageIcon,
  History,
  FolderOpen,
} from 'lucide-react'
import {
  groupApi,
  campaignApi,
  savedProductApi,
  classificationProfileApi,
  apiErrorMessage,
  offerIdentity,
  type Offer,
  type Group,
  type Safety,
  type OfferFlag,
} from '@/lib/api'
import {
  productGroupApi,
  type GroupedSavedProduct,
} from '@/lib/productGroups'
import { Button, Card, Input, Label, Badge, Spinner } from '@/components/ui'
import { WhatsAppBubble } from '@/components/WhatsAppBubble'
import { SafetyControls } from '@/components/SafetyControls'
import { ProductDeliveryStatus } from '@/components/ProductDeliveryStatus'
import { GroupCombobox } from '@/components/GroupCombobox'
import { CampaignConfirmDialog } from '@/components/CampaignConfirmDialog'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'

const DEFAULT_SAFETY: Safety = {
  minDelaySeconds: 8,
  maxDelaySeconds: 25,
  shuffleGroups: true,
  shuffleOffers: true,
  maxPerHour: 120,
  warmupBatchSize: 0,
  warmupPauseFactor: 3,
}

function formatBRL(v?: number) {
  if (v === undefined) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function discountPct(o: Offer): number | null {
  if (typeof o.discountPercent === 'number') return o.discountPercent
  if (!o.originalPrice || o.originalPrice <= o.discountedPrice) return null
  return Math.round(((o.originalPrice - o.discountedPrice) / o.originalPrice) * 100)
}

const CATEGORIES = ['A', 'B', 'C', 'D'] as const
type CategoryFilter = 'all' | (typeof CATEGORIES)[number] | 'uncategorized'
const CATEGORY_TONES = { A: 'green', B: 'blue', C: 'amber', D: 'red' } as const
const EMPTY_OFFER_FLAGS: Record<string, OfferFlag> = {}
const PRODUCT_PAGE_SIZE = 12
const CATALOG_BATCH_SIZE = 50

interface ClassificationOption {
  id: string
  name: string
  builtIn: boolean
  archived: boolean
}

function offerForProfile(item: GroupedSavedProduct, profileId: string, profileName?: string): Offer {
  const savedProductId = item.offer.savedProductId ?? item.id
  if (!profileId) return { ...item.offer, savedProductId }

  const classification = item.classifications?.[profileId]
  if (classification) {
    return {
      ...item.offer,
      savedProductId,
      category: classification.category,
      relevanceScore: classification.relevanceScore,
      discountPercent: classification.discountPercent,
      commissionRate: classification.commissionRate,
      classificationProfileId: profileId,
      classificationProfileName: classification.profileName,
    }
  }

  // Do not leak a rating from another niche into this campaign snapshot.
  return {
    ...item.offer,
    savedProductId,
    category: undefined,
    relevanceScore: undefined,
    classificationProfileId: profileId,
    classificationProfileName: profileName,
  }
}

export default function ComposePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedProductGroupIds, setSelectedProductGroupIds] = useState<Set<number>>(new Set())
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set())
  const [productPage, setProductPage] = useState(1)
  const [template, setTemplate] = useState<string | null>(null)
  const [sendImages, setSendImages] = useState(true)
  const [allowResend, setAllowResend] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Group[]>([])
  const selectedGroupIds = useMemo(() => new Set(selectedGroups.map((group) => group.id)), [selectedGroups])
  const [productSearch, setProductSearch] = useState('')
  const [debouncedTemplate, setDebouncedTemplate] = useState('')
  const [safety, setSafety] = useState<Safety>(DEFAULT_SAFETY)
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduleNow, setScheduleNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const templateRef = useRef<HTMLTextAreaElement>(null)

  const metaQuery = useQuery({ queryKey: ['campaign-meta'], queryFn: campaignApi.meta })
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => groupApi.list() })
  const profilesQuery = useQuery({
    queryKey: ['classification-profiles'],
    queryFn: classificationProfileApi.list,
  })
  const productGroupsQuery = useQuery({
    queryKey: ['product-groups'],
    queryFn: productGroupApi.list,
  })
  // Load only the first API page on entry. More catalog pages are an explicit
  // action; retaining them also retains every selection while filters change.
  const catalogQuery = useInfiniteQuery({
    queryKey: ['saved-products', 'compose-pages'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => savedProductApi.list(CATALOG_BATCH_SIZE, pageParam),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return lastPage.items.length > 0 && loaded < lastPage.total ? loaded : undefined
    },
  })
  const loadedProducts = useMemo(() => {
    const unique = new Map<number, GroupedSavedProduct>()
    for (const page of catalogQuery.data?.pages ?? []) {
      for (const item of page.items) unique.set(item.id, item)
    }
    return [...unique.values()]
  }, [catalogQuery.data])
  const catalogTotal = catalogQuery.data?.pages[0]?.total ?? 0

  const classificationOptions = useMemo(() => {
    const options = new Map<string, ClassificationOption>()
    for (const profile of profilesQuery.data ?? []) {
      options.set(profile.id, {
        id: profile.id,
        name: profile.name,
        builtIn: profile.builtIn,
        archived: false,
      })
    }
    for (const item of loadedProducts) {
      for (const [id, classification] of Object.entries(item.classifications ?? {})) {
        if (!options.has(id)) {
          options.set(id, {
            id,
            name: classification.profileName,
            builtIn: id === 'default',
            archived: true,
          })
        }
      }
    }
    return [...options.values()]
  }, [loadedProducts, profilesQuery.data])
  const activeProfile = classificationOptions.find((profile) => profile.id === selectedProfileId)
    ?? classificationOptions.find((profile) => profile.builtIn)
    ?? classificationOptions[0]
  const activeProfileId = activeProfile?.id ?? ''

  const catalogItems = useMemo(
    () => loadedProducts.map((item) => ({
      item,
      offer: offerForProfile(item, activeProfileId, activeProfile?.name),
    })),
    [activeProfile?.name, activeProfileId, loadedProducts],
  )
  const productGroupFilteredItems = useMemo(
    () => selectedProductGroupIds.size === 0
      ? catalogItems
      : catalogItems.filter(({ item }) => item.groupIds.some((id) => selectedProductGroupIds.has(id))),
    [catalogItems, selectedProductGroupIds],
  )
  const offers = useMemo(
    () => productGroupFilteredItems.map(({ offer }) => offer),
    [productGroupFilteredItems],
  )
  const selectedGroupIdList = useMemo(() => [...selectedGroupIds].sort(), [selectedGroupIds])
  const groupNames = useMemo(
    () => new Map([...selectedGroups, ...(groupsQuery.data ?? [])].map((group) => [group.id, group.name])),
    [groupsQuery.data, selectedGroups],
  )
  // The editor shows the user's edits, or the server default until they type.
  const effectiveTemplate = template ?? metaQuery.data?.defaultTemplate ?? ''

  const includedOffers = useMemo(
    () => catalogItems
      .filter(({ item }) => selectedProductIds.has(item.id) && Boolean(item.classifications?.[activeProfileId]))
      .map(({ offer }) => offer),
    [activeProfileId, catalogItems, selectedProductIds],
  )
  const categoryCounts = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, D: 0, uncategorized: 0 }
    offers.forEach((offer) => {
      if (offer.category && offer.category in counts) counts[offer.category]++
      else counts.uncategorized++
    })
    return counts
  }, [offers])
  const filteredOffers = useMemo(
    () => productGroupFilteredItems.filter(({ offer }) =>
      (categoryFilter === 'all' || (categoryFilter === 'uncategorized' ? !offer.category : offer.category === categoryFilter))
      && (!productSearch.trim() || offer.title.toLocaleLowerCase('pt-BR').includes(productSearch.trim().toLocaleLowerCase('pt-BR')))),
    [categoryFilter, productGroupFilteredItems, productSearch],
  )
  const productPageCount = Math.max(1, Math.ceil(filteredOffers.length / PRODUCT_PAGE_SIZE))
  const safeProductPage = Math.min(productPage, productPageCount)
  const visibleOffers = useMemo(
    () => filteredOffers.slice(
      (safeProductPage - 1) * PRODUCT_PAGE_SIZE,
      safeProductPage * PRODUCT_PAGE_SIZE,
    ),
    [filteredOffers, safeProductPage],
  )
  const statusOffers = useMemo(() => {
    const unique = new Map<number, Offer>()
    for (const { item, offer } of visibleOffers) unique.set(item.id, offer)
    for (const offer of includedOffers) {
      if (offer.savedProductId) unique.set(offer.savedProductId, offer)
    }
    return [...unique.values()]
  }, [includedOffers, visibleOffers])
  const statusOfferIds = useMemo(
    () => statusOffers.map((offer) => offer.savedProductId ?? offerIdentity(offer)),
    [statusOffers],
  )

  const offerFlagsQuery = useQuery({
    queryKey: ['offer-group-delivery', statusOfferIds, selectedGroupIdList],
    queryFn: () => campaignApi.checkOffersBatched(
      statusOffers.map((offer) => ({
        savedProductId: offer.savedProductId,
        source: offer.source,
        productId: offer.productId,
        affiliateUrl: offer.affiliateUrl,
      })),
      selectedGroupIdList,
    ),
    enabled: statusOffers.length > 0 && selectedGroupIdList.length > 0,
  })
  const offerFlags = offerFlagsQuery.data ?? EMPTY_OFFER_FLAGS

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTemplate(effectiveTemplate), 400)
    return () => clearTimeout(timer)
  }, [effectiveTemplate])
  const previewOffers = useMemo(() => includedOffers.slice(0, 4), [includedOffers])
  const previewQuery = useQuery({
    queryKey: ['compose-preview', previewOffers, debouncedTemplate],
    queryFn: () => campaignApi.preview(previewOffers, debouncedTemplate),
    enabled: previewOffers.length > 0 && Boolean(debouncedTemplate.trim()),
  })
  const shownPreviews = previewQuery.data ?? []

  useEffect(() => {
    if (!scheduledAt) return
    const timer = setInterval(() => setScheduleNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [scheduledAt])

  const hasUnsavedChanges = !createdCampaignId && (
    Boolean(name.trim()) || selectedProductIds.size > 0 || selectedGroups.length > 0
    || (template !== null && template !== (metaQuery.data?.defaultTemplate ?? ''))
    || !sendImages || allowResend || Boolean(scheduledAt)
    || Object.entries(DEFAULT_SAFETY).some(([key, value]) => safety[key as keyof Safety] !== value)
  )
  const { prompt, allowNextNavigation } = useUnsavedChanges(hasUnsavedChanges, 'Esta campanha ainda não foi salva.')

  const createMutation = useMutation({
    mutationFn: async (action: 'send' | 'schedule' | 'draft') => {
      if (action === 'schedule' && (!Number.isFinite(new Date(scheduledAt).getTime()) || new Date(scheduledAt).getTime() <= Date.now())) {
        throw new Error('Escolha uma data e hora no futuro antes de salvar a campanha.')
      }
      const groups = selectedGroups.map((group) => ({ id: group.id, name: groupNames.get(group.id) ?? group.name }))
      setError(null)
      const campaign = await campaignApi.create({
        name: name || 'Campanha sem nome',
        offers: includedOffers,
        groups,
        safety,
        messageTemplate: effectiveTemplate,
        sendImages,
        allowResend,
        scheduledAt: action === 'schedule' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      })
      if (action === 'send') {
        try {
          await campaignApi.run(campaign.id)
        } catch (cause) {
          // Creation succeeded. Keep the receipt visible so retrying cannot
          // accidentally create a second campaign with the same delivery pairs.
          setCreatedCampaignId(campaign.id)
          throw cause
        }
      }
      return campaign
    },
    onSuccess: (campaign) => {
      allowNextNavigation()
      navigate(`/campaigns/${campaign.id}`)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const toggleOffer = (id: number) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleProductGroup = (id: number) => {
    setSelectedProductGroupIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setProductPage(1)
  }

  const visibleProductIds = useMemo(
    () => visibleOffers
      .filter(({ item }) => Boolean(item.classifications?.[activeProfileId]))
      .map(({ item }) => item.id),
    [activeProfileId, visibleOffers],
  )
  const filteredProductIds = useMemo(
    () => filteredOffers
      .filter(({ item }) => Boolean(item.classifications?.[activeProfileId]))
      .map(({ item }) => item.id),
    [activeProfileId, filteredOffers],
  )
  const allVisibleSelected = visibleProductIds.length > 0
    && visibleProductIds.every((id) => selectedProductIds.has(id))
  const allFilteredSelected = filteredProductIds.length > 0
    && filteredProductIds.every((id) => selectedProductIds.has(id))

  const toggleVisibleProducts = () => {
    setSelectedProductIds((previous) => {
      const next = new Set(previous)
      if (allVisibleSelected) visibleProductIds.forEach((id) => next.delete(id))
      else visibleProductIds.forEach((id) => next.add(id))
      return next
    })
  }

  const toggleFilteredProducts = () => {
    setSelectedProductIds((previous) => {
      const next = new Set(previous)
      if (allFilteredSelected) filteredProductIds.forEach((id) => next.delete(id))
      else filteredProductIds.forEach((id) => next.add(id))
      return next
    })
  }

  const insertPlaceholder = (key: string) => {
    const ta = templateRef.current
    const token = `{${key}}`
    const current = effectiveTemplate
    if (!ta) {
      setTemplate(current + token)
      return
    }
    const start = ta.selectionStart ?? current.length
    const end = ta.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    setTemplate(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + token.length
    })
  }

  const nonCommissioned = includedOffers.filter((o) => o.source && o.commissioned === false).length
  const deliverySummary = useMemo(() => {
    const counts = { eligible: 0, sent: 0, sending: 0, ambiguous: 0 }
    for (const offer of includedOffers) {
      const groups = offerFlags[offerIdentity(offer)]?.groups ?? []
      for (const group of groups) {
        if (group.status === 'unsent') counts.eligible++
        else if (group.status === 'sent') counts.sent++
        else if (group.claimStatus === 'unconfirmed' && group.recoverable) counts.ambiguous++
        else counts.sending++
      }
    }
    return counts
  }, [includedOffers, offerFlags])
  const totalPairs = includedOffers.length * selectedGroupIds.size
  const hasSelection = includedOffers.length > 0
    && selectedGroupIds.size > 0
    && Boolean(activeProfileId)
  // Selection is the source of truth for SENT pairs when resend is on;
  // SENDING / unconfirmed pairs stay blocked regardless (race protection).
  const effectiveEligible = deliverySummary.eligible + (allowResend ? deliverySummary.sent : 0)
  const invalidSchedule = Boolean(scheduledAt) && (!Number.isFinite(new Date(scheduledAt).getTime()) || new Date(scheduledAt).getTime() <= scheduleNow)
  const invalidSafety = safety.maxDelaySeconds < safety.minDelaySeconds
  const canSaveDraft = hasSelection && !createMutation.isPending && !createdCampaignId && !invalidSafety && Boolean(effectiveTemplate.trim())
  const canDispatch = canSaveDraft
    && !invalidSchedule
    && !offerFlagsQuery.isPending
    && !offerFlagsQuery.isError
    && effectiveEligible > 0

  const keepOnlyEligibleProducts = () => {
    setSelectedProductIds(new Set(catalogItems
      .filter(({ item, offer }) => selectedProductIds.has(item.id)
        && (offerFlags[offerIdentity(offer)]?.eligibleGroupIds.length ?? 0) > 0)
      .map(({ item }) => item.id)))
  }

  return (
    <div className="workspace-page mx-auto max-w-6xl space-y-5 text-ink">
      <header className="page-header">
        <div>
          <h1 className="page-title">Nova campanha</h1>
          <p className="page-description">Escolha as ofertas, revise a mensagem e confirme os destinos.</p>
        </div>
        <Link to="/products" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-accent underline underline-offset-4"><Package size={16} /> Catálogo de produtos</Link>
      </header>

      <div className="surface-panel flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 text-sm" aria-label="Resumo da campanha">
        <a href="#compose-products" className="min-h-8 content-center text-muted"><strong className="tabular-nums text-ink">{includedOffers.length}</strong> produtos selecionados</a>
        <a href="#compose-groups" className="min-h-8 content-center text-muted"><strong className="tabular-nums text-ink">{selectedGroupIds.size}</strong> grupos de WhatsApp</a>
        <a href="#compose-send" className="min-h-8 content-center font-medium text-accent">Revisar envio</a>
      </div>

      <Card>
        <Label htmlFor="campaign-name">Nome da campanha</Label>
        <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Achados da manhã" maxLength={200} />
      </Card>

      <section id="compose-products" className="scroll-mt-5" aria-labelledby="products-heading">
        <Card>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="products-heading" className="section-heading">1. Escolher produtos</h2>
            <span className="text-xs tabular-nums text-muted">{loadedProducts.length} de {catalogTotal} produtos carregados</span>
          </div>
          {catalogQuery.isPending ? <div className="flex items-center gap-3 py-8 text-sm text-muted" role="status"><Spinner /> Carregando produtos…</div> : catalogQuery.isError && loadedProducts.length === 0 ? (
            <div role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger">Não foi possível carregar o catálogo. <button type="button" className="min-h-10 underline" onClick={() => void catalogQuery.refetch()}>Tentar novamente</button></div>
          ) : loadedProducts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-6 text-sm text-muted"><Package size={24} className="mb-3" /><p className="font-medium text-ink">Seu catálogo ainda está vazio</p><p className="mt-1">Salve e classifique produtos para usá-los em uma campanha.</p><Link className="mt-3 inline-flex min-h-10 items-center font-medium text-accent underline" to="/products">Abrir catálogo</Link></div>
          ) : (
            <>
              <div className="mb-4 grid gap-4 border-b border-line pb-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="compose-profile">Nicho da classificação</Label>
                  {profilesQuery.isPending && classificationOptions.length === 0 ? <Spinner /> : classificationOptions.length ? (
                    <select id="compose-profile" value={activeProfileId} className="field-control w-full" onChange={(event) => { setSelectedProfileId(event.target.value); setSelectedProductIds(new Set()); setCategoryFilter('all'); setProductPage(1) }}>
                      {classificationOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.archived ? ' (arquivado)' : ''}</option>)}
                    </select>
                  ) : <p className="text-sm text-muted">Nenhum nicho disponível.</p>}
                  <p className="mt-2 text-xs leading-relaxed text-muted">Só produtos classificados neste nicho podem ser incluídos. Ao trocar o nicho, a seleção de produtos é limpa.</p>
                  {profilesQuery.isError && <p role="alert" className="mt-2 text-xs text-danger">Não foi possível atualizar os nichos. <button className="underline" onClick={() => void profilesQuery.refetch()}>Tentar novamente</button></p>}
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2"><Label>Filtrar por coleção</Label>{selectedProductGroupIds.size > 0 && <button type="button" className="min-h-8 text-xs text-accent underline" onClick={() => { setSelectedProductGroupIds(new Set()); setProductPage(1) }}>Todas as coleções</button>}</div>
                  {productGroupsQuery.isPending ? <Spinner /> : productGroupsQuery.isError ? <p role="alert" className="text-sm text-danger">Não foi possível carregar as coleções. <button className="underline" onClick={() => void productGroupsQuery.refetch()}>Tentar novamente</button></p> : (
                    <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto" aria-label="Filtrar por coleções de produtos">
                      {(productGroupsQuery.data ?? []).map((group) => <button key={group.id} type="button" aria-pressed={selectedProductGroupIds.has(group.id)} onClick={() => toggleProductGroup(group.id)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-medium ${selectedProductGroupIds.has(group.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:bg-surface-muted'}`}><FolderOpen size={14} />{group.name}<span className="tabular-nums">{group.productCount}</span></button>)}
                      {productGroupsQuery.data?.length === 0 && <p className="text-sm text-muted">Nenhuma coleção criada.</p>}
                    </div>
                  )}
                </div>
              </div>
              <div className="relative mb-3">
                <Search size={17} className="pointer-events-none absolute left-3 top-3 text-subtle" />
                <Input aria-label="Buscar nos produtos carregados" placeholder="Buscar nos produtos carregados" value={productSearch} className="pl-10" onChange={(e) => { setProductSearch(e.target.value); setProductPage(1) }} />
              </div>
              <div className="mb-3 flex flex-wrap gap-2" aria-label="Filtrar produtos por categoria">
                {(['all', ...CATEGORIES, 'uncategorized'] as CategoryFilter[]).map((category) => <button key={category} type="button" aria-pressed={categoryFilter === category} onClick={() => { setCategoryFilter(category); setProductPage(1) }} className={`min-h-10 rounded-lg border px-3 text-xs font-medium ${categoryFilter === category ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-surface-muted'}`}>{category === 'all' ? 'Todas' : category === 'uncategorized' ? 'Sem classificação' : `Categoria ${category}`} <span className="ml-1 tabular-nums">{category === 'all' ? offers.length : categoryCounts[category]}</span></button>)}
              </div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <p className="text-muted">{filteredOffers.length} resultado(s) nos produtos carregados. A seleção permanece ao filtrar.</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="min-h-10 font-medium text-accent underline" disabled={visibleProductIds.length === 0} onClick={toggleVisibleProducts}>{allVisibleSelected ? 'Remover página' : 'Selecionar página'}</button>
                  {filteredProductIds.length > visibleProductIds.length && <button type="button" className="min-h-10 font-medium text-accent underline" onClick={toggleFilteredProducts}>{allFilteredSelected ? 'Remover filtrados' : `Selecionar ${filteredProductIds.length} carregados`}</button>}
                  {selectedProductIds.size > 0 && <button type="button" className="min-h-10 text-muted underline" onClick={() => setSelectedProductIds(new Set())}>Limpar seleção</button>}
                </div>
              </div>
              <div className="divide-y divide-line border-y border-line">
                {visibleOffers.map(({ offer, item }) => {
                  const classified = Boolean(item.classifications?.[activeProfileId])
                  const selected = classified && selectedProductIds.has(item.id)
                  const pct = discountPct(offer)
                  return (
                    <article key={item.id} className={`grid min-w-0 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_210px] ${selected ? 'bg-accent-soft/40' : ''}`}>
                      <div className="flex min-w-0 gap-3">
                        <label className="flex min-h-11 w-8 shrink-0 items-start justify-center pt-3"><input type="checkbox" aria-label={`Incluir ${offer.title}`} checked={selected} disabled={!classified} onChange={() => toggleOffer(item.id)} className="h-4 w-4 accent-accent" /></label>
                        {offer.imageUrl ? <img src={offer.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-white object-contain" loading="lazy" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-subtle"><ImageOff size={22} /></div>}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-medium leading-snug">{offer.title}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-base font-semibold tabular-nums">{formatBRL(offer.discountedPrice)}</span>{offer.originalPrice && <span className="text-xs tabular-nums text-subtle line-through">{formatBRL(offer.originalPrice)}</span>}{pct !== null && <span className="text-xs font-medium text-success">{pct}% de desconto</span>}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">{offer.category ? <Badge tone={CATEGORY_TONES[offer.category]}>Categoria {offer.category}</Badge> : <span>Classifique neste nicho para selecionar</span>}{typeof offer.relevanceScore === 'number' && <span>Relevância {offer.relevanceScore}/100</span>}{offer.commissioned === false ? <span className="text-warning">Sem link de comissão</span> : (typeof offer.commissionRate === 'number' || offer.commissionPercent) ? <span>Comissão {typeof offer.commissionRate === 'number' ? `${offer.commissionRate}%` : offer.commissionPercent}</span> : null}</div>
                        </div>
                      </div>
                      <div className="pl-11 text-xs sm:pl-0"><p className="mb-1 text-subtle">Envio aos grupos escolhidos</p>{selectedGroupIds.size === 0 ? <span className="text-muted">Escolha os destinos abaixo</span> : offerFlagsQuery.isPending ? <span role="status" className="text-muted">Verificando histórico…</span> : offerFlagsQuery.isError ? <span className="text-danger">Histórico indisponível</span> : <ProductDeliveryStatus groups={offerFlags[offerIdentity(offer)]?.groups ?? []} savedProductId={offer.savedProductId} groupNames={groupNames} compact={selectedGroupIds.size > 4} emptyLabel="Sem status para estes grupos" />}</div>
                    </article>
                  )
                })}
                {visibleOffers.length === 0 && <div className="py-8 text-sm text-muted"><p className="font-medium text-ink">Nenhum produto carregado corresponde aos filtros</p><p className="mt-1">Limpe a busca, escolha outra categoria ou carregue mais produtos.</p></div>}
              </div>
              {productPageCount > 1 && <div className="mt-3 flex items-center justify-between gap-2 text-sm"><Button variant="secondary" disabled={safeProductPage === 1} onClick={() => setProductPage((page) => Math.max(1, page - 1))}>Anterior</Button><span className="tabular-nums text-muted">{safeProductPage} / {productPageCount}</span><Button variant="secondary" disabled={safeProductPage === productPageCount} onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}>Próxima</Button></div>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-3 text-xs text-muted">
                <p className="max-w-lg">{catalogQuery.hasNextPage ? `O catálogo tem ${catalogTotal} produtos. Busca, categorias, coleções e nichos arquivados consideram os ${loadedProducts.length} já carregados. Carregue mais para consultar os demais.` : `Todos os ${loadedProducts.length} produtos do catálogo estão disponíveis nos filtros.`}</p>
                {catalogQuery.hasNextPage && <Button variant="secondary" disabled={catalogQuery.isFetchingNextPage} onClick={() => void catalogQuery.fetchNextPage()}>{catalogQuery.isFetchingNextPage ? <><Spinner /> Carregando…</> : `Carregar mais ${Math.min(CATALOG_BATCH_SIZE, catalogTotal - loadedProducts.length)}`}</Button>}
                {catalogQuery.isFetchNextPageError && <p role="alert" className="w-full text-danger">Não foi possível carregar a próxima página. Sua seleção foi mantida. Tente carregar novamente.</p>}
              </div>
            </>
          )}
        </Card>
      </section>

      <section aria-labelledby="message-heading">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="message-heading" className="section-heading">2. Revisar a mensagem</h2><Button variant="ghost" disabled={!metaQuery.data} onClick={() => metaQuery.data && setTemplate(metaQuery.data.defaultTemplate)}><RotateCcw size={14} /> Restaurar padrão</Button></div>
          {metaQuery.isPending && <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted"><Spinner /> Carregando modelo de mensagem…</p>}
          {metaQuery.isError && <p role="alert" className="mb-3 text-sm text-danger">Não foi possível carregar o modelo. <button className="underline" onClick={() => void metaQuery.refetch()}>Tentar novamente</button></p>}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="compose-template">Modelo da mensagem</Label>
              <p id="template-help" className="mb-3 text-xs leading-relaxed text-muted">Insira campos do produto. Blocos {'{?campo}…{/campo}'} aparecem apenas quando o campo tem valor.</p>
              <div className="mb-2 flex flex-wrap gap-1.5">{metaQuery.data?.placeholders.map((placeholder) => <button key={placeholder.key} type="button" onClick={() => insertPlaceholder(placeholder.key)} className="min-h-9 rounded-md bg-surface-muted px-2.5 text-xs text-muted hover:bg-accent-soft hover:text-accent" title={`Inserir {${placeholder.key}}`}>{placeholder.label}</button>)}</div>
              <textarea id="compose-template" ref={templateRef} aria-describedby="template-help" value={effectiveTemplate} onChange={(e) => setTemplate(e.target.value)} className="field-control min-h-64 w-full resize-y font-mono text-xs leading-relaxed" />
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={sendImages} onChange={(e) => setSendImages(e.target.checked)} className="h-4 w-4 accent-accent" /><ImageIcon size={17} /><span>Enviar a foto do produto com a mensagem</span></label>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-sm font-medium">Prévia no WhatsApp</p><p className="mb-3 text-xs text-muted">Até 4 produtos da seleção. O WhatsApp pode ajustar a prévia do link.</p>
              <div className="max-h-[540px] min-h-72 space-y-3 overflow-y-auto rounded-xl bg-[#e5ddd5] p-3" aria-live="polite" aria-busy={previewQuery.isFetching || debouncedTemplate !== effectiveTemplate}>
                {includedOffers.length === 0 ? <p className="p-3 text-sm text-[#526156]">Selecione um produto para conferir a mensagem antes do envio.</p> : !effectiveTemplate.trim() ? <p className="p-3 text-sm text-[#526156]">Preencha o modelo para gerar a prévia da mensagem.</p> : previewQuery.isError ? <div role="alert" className="rounded-lg bg-white p-3 text-sm text-[#8f2929]">Não foi possível gerar a prévia. <button className="min-h-10 underline" onClick={() => void previewQuery.refetch()}>Tentar novamente</button></div> : previewQuery.isPending || debouncedTemplate !== effectiveTemplate ? <p role="status" className="p-3 text-sm text-[#526156]">Atualizando prévia…</p> : shownPreviews.map((preview, index) => <WhatsAppBubble key={`${index}-${preview.title}`} message={preview.message} imageUrl={previewOffers[index]?.imageUrl} showImage={sendImages && Boolean(previewOffers[index]?.imageUrl)} linkPreviewImageUrl={previewOffers[index]?.imageUrl} linkPreviewTitle={preview.title} />)}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section id="compose-groups" className="scroll-mt-5" aria-labelledby="groups-heading">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="groups-heading" className="section-heading">3. Escolher grupos de WhatsApp</h2><Button variant="ghost" disabled={groupsQuery.isFetching} onClick={() => void groupsQuery.refetch()}>{groupsQuery.isFetching ? 'Atualizando…' : 'Atualizar grupos'}</Button></div>
          {groupsQuery.isError && <div role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">{apiErrorMessage(groupsQuery.error)} <Link to="/connection" className="underline">Ver conexão do WhatsApp</Link></div>}
          {groupsQuery.isLoading && <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted"><Spinner /> Carregando grupos…</div>}
          {(groupsQuery.data || selectedGroups.length > 0) && <>
            <GroupCombobox items={groupsQuery.data ?? []} value={selectedGroups} onChange={setSelectedGroups} disabled={createMutation.isPending} />
            {selectedGroups.length > 0 ? (
              <div className="mt-3 divide-y divide-line border-t border-line" aria-label="Resumo dos destinos selecionados">
                {selectedGroups.map((snapshot) => {
                  const group = groupsQuery.data?.find((item) => item.id === snapshot.id) ?? snapshot
                  const ready = includedOffers.filter((offer) => offerFlags[offerIdentity(offer)]?.groups.some((delivery) => delivery.groupId === group.id && delivery.status === 'unsent')).length
                  return <div key={group.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-3 text-sm"><div className="min-w-0 flex-1"><p className="break-words font-medium">{group.name}</p><p className="mt-1 text-xs tabular-nums text-muted">{group.size} membros{group.announceOnly ? ' · Somente administradores podem enviar' : ''}</p></div><p className="text-xs text-muted">{includedOffers.length === 0 ? 'Selecione produtos para verificar o envio' : offerFlagsQuery.isPending ? 'Verificando histórico…' : offerFlagsQuery.isError ? 'Histórico indisponível' : `${ready} produto(s) com envio novo`}</p></div>
                })}
              </div>
            ) : <p className="mt-3 rounded-lg bg-surface-muted p-3 text-sm text-muted">Escolha os grupos que receberão as ofertas. Nenhuma mensagem é enviada nesta etapa.</p>}
            {groupsQuery.data?.length === 0 && <p className="mt-3 text-sm text-muted">Nenhum grupo disponível. <Link className="text-accent underline" to="/connection">Confira a conexão do WhatsApp</Link> e atualize os grupos.</p>}
          </>}

        </Card>
      </section>

      <section aria-labelledby="safety-heading"><Card><h2 id="safety-heading" className="section-heading mb-4">4. Definir o ritmo de envio</h2><SafetyControls safety={safety} onChange={setSafety} /></Card></section>

      <section id="compose-send" className="scroll-mt-5" aria-labelledby="send-heading">
        <Card>
          <h2 id="send-heading" className="section-heading mb-3">5. Confirmar campanha</h2>
          <div className="mb-4 rounded-lg bg-accent-soft p-4 text-sm text-accent" role="status"><strong className="tabular-nums">{offerFlagsQuery.isPending && hasSelection ? 'Verificando histórico…' : `${effectiveEligible} envio(s) disponível(is)`}</strong><p className="mt-1">{includedOffers.length} produtos em {selectedGroupIds.size} grupos: {totalPairs} combinações.{allowResend && deliverySummary.sent > 0 ? ` Inclui ${deliverySummary.sent} reenvio(s).` : ''}</p></div>
          <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-accent" checked={allowResend} onChange={(e) => setAllowResend(e.target.checked)} /><span><span className="font-medium">Reenviar produtos já entregues nesta conexão</span><span className="mt-1 block text-xs leading-relaxed text-muted">Os grupos receberão esses produtos novamente. Envios em outra campanha ou sem confirmação continuam bloqueados.</span></span></label>
          {offerFlagsQuery.isError && hasSelection && <div role="alert" className="mb-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">O histórico por grupo não pôde ser verificado. O envio está bloqueado. <button className="min-h-10 underline" onClick={() => void offerFlagsQuery.refetch()}>Tentar novamente</button></div>}
          {(deliverySummary.sent > 0 || deliverySummary.sending > 0 || deliverySummary.ambiguous > 0) && <div className="mb-4 rounded-lg bg-warning-soft p-3 text-sm leading-relaxed text-warning"><History size={15} className="mr-1 inline" />{deliverySummary.sent} combinações já entregues{allowResend ? ' serão reenviadas' : ' serão ignoradas'}. {deliverySummary.sending} em outra campanha e {deliverySummary.ambiguous} sem confirmação continuam bloqueadas. Abra o status do grupo para resolver envios sem confirmação.{!allowResend && <button type="button" className="mt-2 block min-h-10 underline" onClick={keepOnlyEligibleProducts}>Manter só produtos com envios novos</button>}</div>}
          {hasSelection && !offerFlagsQuery.isPending && !offerFlagsQuery.isError && effectiveEligible === 0 && <p role="status" className="mb-4 rounded-lg bg-surface-muted p-3 text-sm text-muted">Nenhum envio disponível. Escolha outro produto ou grupo; confira os status sem confirmação antes de tentar novamente.</p>}
          {nonCommissioned > 0 && <p className="mb-4 rounded-lg bg-warning-soft p-3 text-sm text-warning"><AlertTriangle size={16} className="mr-1 inline" />{nonCommissioned} produto(s) sem link de comissão. Gere o link afiliado na plataforma de origem para receber comissão.</p>}
          <div className="mb-4 max-w-md"><Label htmlFor="compose-schedule">Agendar para (opcional)</Label><Input id="compose-schedule" type="datetime-local" value={scheduledAt} aria-invalid={invalidSchedule} aria-describedby="schedule-help" onChange={(e) => { setScheduledAt(e.target.value); setScheduleNow(Date.now()) }} /><p id="schedule-help" className={`mt-1 text-xs ${invalidSchedule ? 'text-danger' : 'text-muted'}`}>{invalidSchedule ? 'Escolha uma data e hora no futuro.' : 'Horário local deste dispositivo. Deixe vazio para enviar agora.'}</p></div>
          {!hasSelection && <p className="mb-3 text-sm text-muted">Selecione pelo menos um produto classificado e um grupo para continuar.</p>}
          {invalidSafety && <p role="alert" className="mb-3 text-sm text-danger">Ajuste o ritmo de envio: o intervalo máximo deve ser maior ou igual ao mínimo.</p>}
          {!effectiveTemplate.trim() && !metaQuery.isPending && <p className="mb-3 text-sm text-danger">Preencha o modelo da mensagem antes de salvar.</p>}
          {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">{createdCampaignId ? 'A campanha foi salva, mas o envio não iniciou. ' : ''}{error}{createdCampaignId && <Link to={`/campaigns/${createdCampaignId}`} className="mt-2 block min-h-10 content-center font-medium underline">Abrir campanha salva e tentar iniciar novamente</Link>}</p>}
          <div className="flex flex-col gap-2 sm:flex-row" aria-busy={createMutation.isPending}><Button onClick={() => { if (scheduledAt) createMutation.mutate('schedule'); else setConfirmSend(true) }} disabled={!canDispatch}>{createMutation.isPending ? <><Spinner /> Salvando campanha…</> : scheduledAt ? <><Clock size={16} /> Agendar campanha</> : <><Send size={16} /> Enviar agora</>}</Button><Button variant="secondary" onClick={() => createMutation.mutate('draft')} disabled={!canSaveDraft}>Salvar rascunho</Button></div><p className="mt-2 text-xs text-muted">Salvar rascunho guarda a campanha sem agendar ou iniciar envios.</p>
        </Card>
      </section>
      {confirmSend && <CampaignConfirmDialog
        title="Enviar campanha agora?"
        description={`Campanha: ${name || 'Campanha sem nome'}\n${includedOffers.length} ${includedOffers.length === 1 ? 'produto' : 'produtos'} para ${selectedGroups.length} ${selectedGroups.length === 1 ? 'grupo' : 'grupos'}.\n\nDestinos:\n${selectedGroups.map((group) => `• ${groupNames.get(group.id) ?? group.name}`).join('\n')}\n\n${effectiveEligible} ${effectiveEligible === 1 ? 'combinação disponível' : 'combinações disponíveis'} para envio.\n${sendImages ? 'As fotos dos produtos serão enviadas com as mensagens.' : 'Envio somente de texto, com prévia do link quando disponível.'}\nAs mensagens serão enviadas agora para os grupos escolhidos.${allowResend ? '\nReenvio ativado: produtos já entregues poderão ser enviados novamente.' : ''}`}
        confirmLabel="Enviar para os grupos agora"
        cancelLabel="Voltar à revisão"
        onCancel={() => setConfirmSend(false)}
        onConfirm={() => {
          setConfirmSend(false)
          if (canDispatch && !scheduledAt) createMutation.mutate('send')
          else setError('A configuração ou o histórico de envio mudou. Revise a campanha antes de enviar.')
        }}
      />}
      {prompt}
    </div>
  )
}
