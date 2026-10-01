import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
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
const PRODUCT_PAGE_SIZE = 50

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
  const [previews, setPreviews] = useState<{ title: string; message: string }[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [safety, setSafety] = useState<Safety>(DEFAULT_SAFETY)
  const [scheduledAt, setScheduledAt] = useState('')
  const [error, setError] = useState<string | null>(null)
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
  const catalogQuery = useQuery({
    queryKey: ['saved-products', 'all'],
    queryFn: async () => {
      const first = await savedProductApi.list(100, 0)
      const remainingPages = Math.ceil(Math.max(0, first.total - first.items.length) / 100)
      const offsets = Array.from({ length: remainingPages }, (_, index) => (index + 1) * 100)
      const pages: Awaited<ReturnType<typeof savedProductApi.list>>[] = []
      for (let index = 0; index < offsets.length; index += 6) {
        pages.push(...await Promise.all(
          offsets.slice(index, index + 6).map((offset) => savedProductApi.list(100, offset)),
        ))
      }
      return [first, ...pages]
        .flatMap((page) => page.items)
        .map((item) => ({
          ...item,
          groupIds: 'groupIds' in item && Array.isArray(item.groupIds) ? item.groupIds : [],
          classifications: 'classifications' in item && item.classifications ? item.classifications : {},
        })) as GroupedSavedProduct[]
    },
  })

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
    for (const item of catalogQuery.data ?? []) {
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
  }, [catalogQuery.data, profilesQuery.data])
  const activeProfile = classificationOptions.find((profile) => profile.id === selectedProfileId)
    ?? classificationOptions.find((profile) => profile.builtIn)
    ?? classificationOptions[0]
  const activeProfileId = activeProfile?.id ?? ''

  const catalogItems = useMemo(
    () => (catalogQuery.data ?? []).map((item) => ({
      item,
      offer: offerForProfile(item, activeProfileId, activeProfile?.name),
    })),
    [activeProfile?.name, activeProfileId, catalogQuery.data],
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
    () => new Map((groupsQuery.data ?? []).map((group) => [group.id, group.name])),
    [groupsQuery.data],
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
    () => productGroupFilteredItems.filter(({ offer }) => categoryFilter === 'all'
      || (categoryFilter === 'uncategorized' ? !offer.category : offer.category === categoryFilter)),
    [categoryFilter, productGroupFilteredItems],
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

  // Re-render previews when the template or included offers change (debounced).
  const previewMutation = useMutation({
    mutationFn: () => campaignApi.preview(includedOffers.slice(0, 4), effectiveTemplate),
    onSuccess: (res) => setPreviews(res),
  })
  useEffect(() => {
    if (includedOffers.length === 0) return
    const t = setTimeout(() => previewMutation.mutate(), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTemplate, includedOffers])

  const shownPreviews = includedOffers.length === 0 ? [] : previews

  const createMutation = useMutation({
    mutationFn: async (run: boolean) => {
      const groups = (groupsQuery.data ?? [])
        .filter((g) => selectedGroupIds.has(g.id))
        .map((g) => ({ id: g.id, name: g.name }))
      const campaign = await campaignApi.create({
        name: name || 'Campanha sem nome',
        offers: includedOffers,
        groups,
        safety,
        messageTemplate: effectiveTemplate,
        sendImages,
        allowResend,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      })
      if (run && !scheduledAt) await campaignApi.run(campaign.id)
      return campaign
    },
    onSuccess: (campaign) => navigate(`/campaigns/${campaign.id}`),
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const filteredGroups = useMemo(() => {
    const list = groupsQuery.data ?? []
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter((g) => g.name.toLowerCase().includes(q))
  }, [groupsQuery.data, search])

  const toggleGroup = (id: string) =>
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
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
  const canSaveDraft = hasSelection && !createMutation.isPending
  const canDispatch = canSaveDraft
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nova campanha</h1>
        <p className="text-sm text-zinc-500">
          Escolha produtos salvos por nicho e coleção, personalize a mensagem, escolha grupos de WhatsApp e dispare com
          segurança.
        </p>
      </div>

      <Card>
        <Label>Nome da campanha</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Achados da manhã" />
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-violet-600" />
            <h2 className="font-semibold">1 · Produtos salvos</h2>
          </div>
          <Link to="/products" className="text-sm font-medium text-violet-700 underline">Gerenciar produtos e grupos</Link>
        </div>
        {catalogQuery.isPending ? <Spinner /> : catalogQuery.isError ? (
          <p role="alert" className="text-sm text-red-700">Não foi possível carregar o catálogo. <button type="button" className="underline" onClick={() => void catalogQuery.refetch()}>Tentar novamente</button></p>
        ) : catalogItems.length === 0 ? (
          <p className="text-sm text-zinc-600">Nenhum produto salvo. Classifique um JSON e salve os produtos antes de criar a campanha.</p>
        ) : (
          <>
            <div className="mb-4 grid gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-2">
              <div>
                <Label>Nicho da classificação</Label>
                {profilesQuery.isPending && classificationOptions.length === 0 ? <Spinner /> : profilesQuery.isError && classificationOptions.length === 0 ? (
                  <p role="alert" className="text-sm text-red-700">
                    Não foi possível carregar os nichos.{' '}
                    <button type="button" className="underline" onClick={() => void profilesQuery.refetch()}>
                      Tentar novamente
                    </button>
                  </p>
                ) : classificationOptions.length > 0 ? (
                  <select
                    value={activeProfileId}
                    onChange={(event) => {
                      setSelectedProfileId(event.target.value)
                      setSelectedProductIds(new Set())
                      setCategoryFilter('all')
                      setProductPage(1)
                    }}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                  >
                    {classificationOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}{profile.archived ? ' (arquivado)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-zinc-500">Nenhum nicho configurado.</p>
                )}
                {activeProfile && (
                  <p className="mt-1 text-xs text-zinc-500">
                    A campanha usa a nota de {activeProfile.name}; o catálogo permanece intacto.
                    {activeProfile.archived && ' Este nicho foi arquivado, mas suas avaliações salvas continuam disponíveis.'}
                  </p>
                )}
                {profilesQuery.isError && classificationOptions.length > 0 && (
                  <p role="status" className="mt-1 text-xs text-amber-700">
                    Os nichos ativos não puderam ser atualizados. As avaliações já salvas continuam disponíveis.
                  </p>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label>Grupos de produtos</Label>
                  {selectedProductGroupIds.size > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-violet-700 underline"
                      onClick={() => {
                        setSelectedProductGroupIds(new Set())
                        setProductPage(1)
                      }}
                    >
                      Mostrar todos
                    </button>
                  )}
                </div>
                {productGroupsQuery.isPending ? <Spinner /> : productGroupsQuery.isError ? (
                  <p role="alert" className="text-sm text-red-700">
                    Não foi possível carregar os grupos de produtos.{' '}
                    <button type="button" className="underline" onClick={() => void productGroupsQuery.refetch()}>
                      Tentar novamente
                    </button>
                  </p>
                ) : (
                  <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto" aria-label="Filtrar por grupos de produtos">
                    {(productGroupsQuery.data ?? []).map((productGroup) => {
                      const selected = selectedProductGroupIds.has(productGroup.id)
                      return (
                        <button
                          key={productGroup.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleProductGroup(productGroup.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                            selected
                              ? 'border-violet-500 bg-violet-100 text-violet-800'
                              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                          }`}
                        >
                          <FolderOpen size={13} />
                          {productGroup.name} · {productGroup.productCount}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="mt-1 text-xs text-zinc-500">
                  Selecione vários grupos para combinar os produtos sem duplicá-los.
                </p>
              </div>
            </div>

            {offers.length === 0 && (
              <p role="status" className="mb-3 rounded-lg bg-zinc-100 p-3 text-sm text-zinc-700">
                Nenhum produto pertence aos grupos de produtos selecionados. Remova um filtro ou escolha outro grupo.
              </p>
            )}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-zinc-500">
                {includedOffers.length} selecionado(s) · {offers.length} produto(s) nos filtros atuais.
              </p>
              <div className="flex gap-3">
                <button type="button" className="font-medium text-violet-700 underline" onClick={toggleVisibleProducts}>
                  {allVisibleSelected ? 'Remover página' : 'Selecionar página'}
                </button>
                {filteredProductIds.length > visibleProductIds.length && (
                  <button type="button" className="font-medium text-violet-700 underline" onClick={toggleFilteredProducts}>
                    {allFilteredSelected ? 'Remover filtrados' : `Selecionar filtrados (${filteredProductIds.length})`}
                  </button>
                )}
                {selectedProductIds.size > 0 && (
                  <button type="button" className="text-zinc-600 underline" onClick={() => setSelectedProductIds(new Set())}>
                    Limpar seleção
                  </button>
                )}
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Filtrar produtos por categoria">
              {(['all', ...CATEGORIES, ...(categoryCounts.uncategorized > 0 ? ['uncategorized'] as const : [])] as CategoryFilter[]).map((category) => {
                const count = category === 'all' ? offers.length : categoryCounts[category]
                const label = category === 'all' ? 'Todas' : category === 'uncategorized' ? 'Sem classificação neste nicho' : `Categoria ${category}`
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={categoryFilter === category}
                    onClick={() => {
                      setCategoryFilter(category)
                      setProductPage(1)
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      categoryFilter === category
                        ? 'border-violet-500 bg-violet-50 text-violet-700'
                        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    {label} · {count}
                  </button>
                )
              })}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="px-2 py-2">Incluir</th>
                    <th className="px-2 py-2">Produto</th>
                    <th className="px-2 py-2">Categoria</th>
                    <th className="px-2 py-2">Preço</th>
                    <th className="px-2 py-2">Desc.</th>
                    <th className="px-2 py-2">Comissão</th>
                    <th className="px-2 py-2">Link</th>
                    <th className="px-2 py-2">Envio por grupo nesta conexão</th>
                  </tr>
                </thead>
                <tbody>
                {visibleOffers.map(({ offer: o, item }) => {
                  const pct = discountPct(o)
                  const isClassified = Boolean(item.classifications?.[activeProfileId])
                  const isIn = isClassified && selectedProductIds.has(item.id)
                  return (
                    <tr key={item.id} className={`border-b border-zinc-100 ${isIn ? '' : 'opacity-40'}`}>
                      <td className="px-2 py-2"><input type="checkbox" aria-label={`Incluir ${o.title}`} checked={isIn} disabled={!isClassified} onChange={() => toggleOffer(item.id)} /></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          {o.imageUrl && <img src={o.imageUrl} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />}
                          <span className="line-clamp-2 max-w-xs">{o.title}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {o.category ? <div className="space-y-1"><Badge tone={CATEGORY_TONES[o.category]}>Categoria {o.category}</Badge>{typeof o.relevanceScore === 'number' && <div className="text-xs text-zinc-500">Relevância {o.relevanceScore}/100</div>}</div> : <span className="text-xs text-zinc-400">Não classificado neste nicho</span>}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap"><div className="font-medium">{formatBRL(o.discountedPrice)}</div>{o.originalPrice && <div className="text-xs text-zinc-400 line-through">{formatBRL(o.originalPrice)}</div>}</td>
                      <td className="px-2 py-2">{pct !== null ? <Badge tone="green">{pct}%</Badge> : <span className="text-zinc-300">—</span>}</td>
                      <td className="px-2 py-2">{typeof o.commissionRate === 'number' || o.commissionPercent ? <Badge tone="violet">{typeof o.commissionRate === 'number' ? `${o.commissionRate}%` : o.commissionPercent}</Badge> : <span className="text-zinc-300">—</span>}</td>
                      <td className="px-2 py-2">{o.commissioned === false ? <Badge tone="amber">sem comissão</Badge> : <Badge tone="blue">afiliado</Badge>}</td>
                      <td className="px-2 py-2 align-top">{(() => {
                        if (selectedGroupIds.size === 0) return <span className="text-xs text-zinc-400">Selecione os grupos de WhatsApp</span>
                        const f = offerFlags[offerIdentity(o)]
                        if (offerFlagsQuery.isPending) return <span className="text-xs text-zinc-400">Verificando…</span>
                        if (offerFlagsQuery.isError) return <span className="text-xs text-red-600">Indisponível</span>
                        return <ProductDeliveryStatus
                          groups={f?.groups ?? []}
                          savedProductId={o.savedProductId}
                          groupNames={groupNames}
                          compact={selectedGroupIds.size > 4}
                          emptyLabel={selectedGroupIds.size > 0 ? 'Sem status para estes grupos' : 'Nunca enviado'}
                        />
                      })()}</td>
                    </tr>
                  )
                })}
                </tbody>
              </table>
            </div>
            {productPageCount > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <Button
                  variant="secondary"
                  disabled={safeProductPage === 1}
                  onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                >
                  Anterior
                </Button>
                <span className="text-zinc-500">
                  Página {safeProductPage} de {productPageCount} · até {PRODUCT_PAGE_SIZE} produtos por página
                </span>
                <Button
                  variant="secondary"
                  disabled={safeProductPage === productPageCount}
                  onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}
                >
                  Próxima
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── 2. Message template ──────────────────────── */}
      {catalogItems.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">2 · Personalizar mensagem</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSendImages((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  sendImages
                    ? 'border-violet-500 bg-violet-50 text-violet-700'
                    : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                }`}
                title="Enviar a imagem do produto como foto; desligado envia só texto com prévia do link"
              >
                {sendImages ? <ImageIcon size={14} /> : <ImageOff size={14} />}
                {sendImages ? 'Enviando imagem' : 'Só texto (link)'}
              </button>
              <Button
                variant="ghost"
                onClick={() => metaQuery.data && setTemplate(metaQuery.data.defaultTemplate)}
              >
                <RotateCcw size={14} /> Restaurar padrão
              </Button>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {metaQuery.data?.placeholders.map((p) => (
              <button
                key={p.key}
                onClick={() => insertPlaceholder(p.key)}
                className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-violet-100 hover:text-violet-700"
                title={`Inserir {${p.key}}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label>Modelo (use os campos acima; blocos {'{?campo}…{/campo}'} somem se vazios)</Label>
              <textarea
                ref={templateRef}
                value={effectiveTemplate}
                onChange={(e) => setTemplate(e.target.value)}
                className="h-64 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <div>
              <Label>Prévia ao vivo (como aparece no WhatsApp)</Label>
              <div className="h-72 space-y-2 overflow-y-auto rounded-lg bg-[#e5ddd5] bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%228%22><circle cx=%221%22 cy=%221%22 r=%220.5%22 fill=%22%23000%22 opacity=%220.03%22/></svg>')] p-3">
                {shownPreviews.slice(0, 4).map((p, i) => {
                  const offer = includedOffers.find((o) => o.title === p.title)
                  return (
                    <WhatsAppBubble
                      key={i}
                      message={p.message}
                      imageUrl={offer?.imageUrl}
                      showImage={sendImages && !!offer?.imageUrl}
                      linkPreviewImageUrl={offer?.imageUrl}
                      linkPreviewTitle={offer?.title}
                    />
                  )
                })}
                {shownPreviews.length === 0 && (
                  <p className="text-xs text-zinc-500">A prévia aparece aqui…</p>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── 3. Groups ────────────────────────────────── */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">3 · Grupos de WhatsApp ({selectedGroupIds.size} selecionados)</h2>
          <Button variant="ghost" onClick={() => groupsQuery.refetch()}>
            Recarregar
          </Button>
        </div>

        {groupsQuery.isError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {apiErrorMessage(groupsQuery.error)} — conecte um número na aba Conexão primeiro.
          </div>
        )}
        {groupsQuery.isLoading && <Spinner />}

        {groupsQuery.data && (
          <>
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-2.5 text-zinc-400" />
              <Input
                className="pl-9"
                placeholder="Buscar grupo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filteredGroups.map((g: Group) => (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.has(g.id)}
                    onChange={() => toggleGroup(g.id)}
                  />
                  <span className="flex-1 text-sm">{g.name}</span>
                  {selectedGroupIds.has(g.id) && !offerFlagsQuery.isPending && (() => {
                    let ready = 0
                    let skipped = 0
                    let ambiguous = 0
                    for (const offer of includedOffers) {
                      const delivery = offerFlags[offerIdentity(offer)]?.groups.find((item) => item.groupId === g.id)
                      if (delivery?.status === 'unsent') ready++
                      else if (delivery?.claimStatus === 'unconfirmed' && delivery.recoverable) ambiguous++
                      else if (delivery?.status === 'sent' || delivery?.status === 'sending') skipped++
                    }
                    return <span className="text-xs text-zinc-500">{ready} a enviar · {skipped} ignorado(s){ambiguous > 0 ? ` · ${ambiguous} sem confirmação` : ''}</span>
                  })()}
                  {g.announceOnly && <Badge tone="amber">só admin</Badge>}
                  <span className="text-xs text-zinc-400">{g.size} membros</span>
                </label>
              ))}
              {filteredGroups.length === 0 && (
                <p className="py-4 text-center text-sm text-zinc-400">Nenhum grupo encontrado.</p>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ── 4. Safety ────────────────────────────────── */}
      <Card>
        <h2 className="mb-3 font-semibold">4 · Segurança de envio</h2>
        <SafetyControls safety={safety} onChange={setSafety} />
      </Card>

      {/* ── 5. Send / Schedule ───────────────────────── */}
      <Card>
        <h2 className="mb-3 font-semibold">5 · Enviar</h2>
        <div className="mb-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-800">
          Envios novos: <strong>{offerFlagsQuery.isPending && hasSelection ? 'verificando…' : effectiveEligible}</strong>
          {' '}de {totalPairs} combinação(ões) de produto e grupo.
          {allowResend && deliverySummary.sent > 0 && (
            <> (inclui {deliverySummary.sent} já enviada(s) que serão reenviadas)</>
          )}
        </div>

        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={allowResend}
            onChange={(e) => setAllowResend(e.target.checked)}
          />
          <span>
            <span className="font-medium">Reenviar pares já enviados nesta conexão</span>
            <span className="block text-xs text-zinc-500">
              A seleção passa a valer para o que já foi entregue: cada par já enviado será enviado de novo.
              Pares em outra campanha ou sem confirmação continuam bloqueados por segurança.
            </span>
          </span>
        </label>

        {offerFlagsQuery.isError && hasSelection && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            Não foi possível verificar o histórico por grupo. O envio fica bloqueado até a
            verificação funcionar. <button type="button" className="underline" onClick={() => void offerFlagsQuery.refetch()}>Tentar novamente</button>
          </div>
        )}

        {(deliverySummary.sent > 0 || deliverySummary.sending > 0 || deliverySummary.ambiguous > 0) && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <History size={14} className="mr-1 inline" />
            {allowResend
              ? `${deliverySummary.sent} combinação(ões) já enviada(s) serão reenviadas. ${deliverySummary.sending} em outra campanha e ${deliverySummary.ambiguous} com envio sem confirmação nesta conexão continuam bloqueadas. Abra o status do grupo para resolver envios sem confirmação.`
              : `${deliverySummary.sent} combinação(ões) já enviada(s), ${deliverySummary.sending} em outra campanha e ${deliverySummary.ambiguous} com envio sem confirmação nesta conexão serão ignoradas automaticamente. Abra o status do grupo para resolver envios sem confirmação. Ative o reenvio acima se quiser mandar de novo o que já foi entregue.`}
            {!allowResend && (
              <button type="button" className="ml-2 underline" onClick={keepOnlyEligibleProducts}>
                Manter só produtos com envios novos
              </button>
            )}
          </div>
        )}

        {hasSelection && !offerFlagsQuery.isPending && !offerFlagsQuery.isError && effectiveEligible === 0 && (
          <div role="status" className="mb-4 rounded-lg bg-zinc-100 p-3 text-sm text-zinc-700">
            {deliverySummary.ambiguous > 0
              ? `Nenhum envio novo. Há ${deliverySummary.ambiguous} envio(s) sem confirmação: confira o WhatsApp e use as ações no status de cada grupo para confirmar ou liberar uma nova tentativa.`
              : 'Nenhum envio novo: todos os produtos selecionados já foram enviados ou estão em campanha para os grupos escolhidos. Selecione outro produto ou grupo.'}
          </div>
        )}

        {nonCommissioned > 0 && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={14} className="mr-1 inline" />
            {nonCommissioned} produto(s) sem link de comissão — gere o link afiliado no Mercado
            Livre para ganhar comissão.
          </div>
        )}

        <div className="mb-4">
          <Label>Agendar para (opcional)</Label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          {scheduledAt ? (
            <Button onClick={() => createMutation.mutate(false)} disabled={!canDispatch}>
              <Clock size={16} /> Agendar campanha
            </Button>
          ) : (
            <Button onClick={() => createMutation.mutate(true)} disabled={!canDispatch}>
              <Send size={16} /> Enviar agora
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => createMutation.mutate(false)}
            disabled={!canSaveDraft}
          >
            Salvar rascunho
          </Button>
        </div>
      </Card>
    </div>
  )
}
