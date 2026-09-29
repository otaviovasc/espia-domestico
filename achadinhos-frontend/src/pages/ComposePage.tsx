import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Upload,
  Send,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Package,
  RotateCcw,
  ImageOff,
  Image as ImageIcon,
  History,
  CalendarClock,
} from 'lucide-react'
import {
  groupApi,
  campaignApi,
  apiErrorMessage,
  type Offer,
  type Group,
  type Safety,
  type OfferFlag,
} from '@/lib/api'
import { Button, Card, Input, Label, Badge, Spinner } from '@/components/ui'
import { WhatsAppBubble } from '@/components/WhatsAppBubble'

const DEFAULT_SAFETY: Safety = {
  minDelaySeconds: 8,
  maxDelaySeconds: 25,
  shuffleGroups: true,
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

/** Stable identity for an offer — productId first, then affiliate URL. */
function offerIdentity(o: Offer): string {
  return o.productId?.trim() || o.affiliateUrl.trim()
}

/** Human "há X dias/horas" from an ISO date. */
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days >= 1) return `há ${days} dia${days > 1 ? 's' : ''}`
  const hours = Math.floor(diff / 3600000)
  if (hours >= 1) return `há ${hours}h`
  const mins = Math.floor(diff / 60000)
  return `há ${Math.max(1, mins)} min`
}

export default function ComposePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [source, setSource] = useState('mercadolivre')
  const [jsonText, setJsonText] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [importInfo, setImportInfo] = useState<{ source: string; totalSeen: number } | null>(null)
  const [importErrors, setImportErrors] = useState<{ index: number; message: string }[]>([])
  const [template, setTemplate] = useState<string | null>(null)
  const [sendImages, setSendImages] = useState(true)
  const [offerFlags, setOfferFlags] = useState<Record<string, OfferFlag>>({})
  const [previews, setPreviews] = useState<{ title: string; message: string }[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [safety, setSafety] = useState<Safety>(DEFAULT_SAFETY)
  const [scheduledAt, setScheduledAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const templateRef = useRef<HTMLTextAreaElement>(null)

  const metaQuery = useQuery({ queryKey: ['campaign-meta'], queryFn: campaignApi.meta })
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => groupApi.list() })

  // The editor shows the user's edits, or the server default until they type.
  const effectiveTemplate = template ?? metaQuery.data?.defaultTemplate ?? ''

  const includedOffers = useMemo(
    () => offers.filter((_, i) => !excluded.has(i)),
    [offers, excluded],
  )
  const categoryCounts = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, D: 0, uncategorized: 0 }
    offers.forEach((offer) => {
      if (offer.category && offer.category in counts) counts[offer.category]++
      else counts.uncategorized++
    })
    return counts
  }, [offers])
  const visibleOffers = useMemo(
    () => offers
      .map((offer, index) => ({ offer, index }))
      .filter(({ offer }) => categoryFilter === 'all'
        || (categoryFilter === 'uncategorized' ? !offer.category : offer.category === categoryFilter)),
    [offers, categoryFilter],
  )

  const importMutation = useMutation({
    mutationFn: () => campaignApi.importOffers(jsonText, { source, template: effectiveTemplate }),
    onSuccess: async (res) => {
      setOffers(res.offers)
      setCategoryFilter('all')
      setExcluded(new Set())
      setImportInfo({ source: res.source, totalSeen: res.totalSeen })
      setImportErrors(res.errors)
      setPreviews(res.previews)
      setError(null)
      // Flag products already sent or present in active campaigns.
      try {
        const flags = await campaignApi.checkOffers(
          res.offers.map((o) => ({ productId: o.productId, affiliateUrl: o.affiliateUrl })),
        )
        setOfferFlags(flags)
        // Auto-exclude anything already sent, so the safe default is "don't resend".
        const autoEx = new Set<number>()
        res.offers.forEach((o, i) => {
          const f = flags[offerIdentity(o)]
          if (f?.alreadySent) autoEx.add(i)
        })
        if (autoEx.size > 0) setExcluded(autoEx)
      } catch {
        setOfferFlags({})
      }
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  // Re-render previews when the template or included offers change (debounced).
  const previewMutation = useMutation({
    mutationFn: () => campaignApi.preview(includedOffers, effectiveTemplate),
    onSuccess: (res) => setPreviews(res),
  })
  useEffect(() => {
    if (includedOffers.length === 0) return
    const t = setTimeout(() => previewMutation.mutate(), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTemplate, offers, excluded])

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

  const toggleOffer = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

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
  const alreadySentIncluded = includedOffers.filter(
    (o) => offerFlags[offerIdentity(o)]?.alreadySent,
  ).length
  const totalMessages = includedOffers.length * selectedGroupIds.size
  const canSubmit = includedOffers.length > 0 && selectedGroupIds.size > 0 && !createMutation.isPending

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nova campanha</h1>
        <p className="text-sm text-zinc-500">
          Importe produtos do marketplace, personalize a mensagem, escolha grupos e dispare com
          segurança.
        </p>
      </div>

      <Card>
        <Label>Nome da campanha</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Achados da manhã" />
      </Card>

      {/* ── 1. Import from marketplace ───────────────── */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Package size={18} className="text-violet-600" />
          <h2 className="font-semibold">1 · Importar produtos</h2>
        </div>

        <div className="mb-3">
          <Label>Origem</Label>
          <div className="flex flex-wrap gap-2">
            {metaQuery.data?.ingestors.map((ing) => (
              <button
                key={ing.id}
                onClick={() => setSource(ing.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  source === ing.id
                    ? 'border-violet-500 bg-violet-50 text-violet-700'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                {ing.label}
              </button>
            ))}
            <span
              className="cursor-not-allowed rounded-lg border border-dashed border-zinc-200 px-3 py-1.5 text-sm text-zinc-400"
              title="Em breve"
            >
              Amazon · em breve
            </span>
          </div>
        </div>

        <Label>Cole o JSON exportado ({source === 'mercadolivre' ? 'Mercado Livre' : source})</Label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder='Cole aqui o conteúdo do arquivo .json exportado do hub de afiliados…'
          className="h-36 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => importMutation.mutate()}
            disabled={!jsonText.trim() || importMutation.isPending}
          >
            <Upload size={16} />
            {importMutation.isPending ? 'Processando…' : 'Importar'}
          </Button>
          {importInfo && (
            <Badge tone="green">
              <CheckCircle2 size={12} className="mr-1 inline" />
              {includedOffers.length}/{offers.length} incluídos · {importInfo.totalSeen} no arquivo
            </Badge>
          )}
        </div>

        {importErrors.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle size={14} className="mr-1 inline" />
            {importErrors.length} aviso(s):
            <ul className="ml-4 mt-1 list-disc">
              {importErrors.slice(0, 6).map((e) => (
                <li key={e.index}>{e.message}</li>
              ))}
              {importErrors.length > 6 && <li>… e mais {importErrors.length - 6}</li>}
            </ul>
          </div>
        )}

        {/* Offers table */}
        {offers.length > 0 && (
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Filtrar produtos por categoria">
              {(['all', ...CATEGORIES, ...(categoryCounts.uncategorized > 0 ? ['uncategorized'] as const : [])] as CategoryFilter[]).map((category) => {
                const count = category === 'all' ? offers.length : categoryCounts[category]
                const label = category === 'all' ? 'Todas' : category === 'uncategorized' ? 'Sem categoria' : `Categoria ${category}`
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={categoryFilter === category}
                    onClick={() => setCategoryFilter(category)}
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
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                {visibleOffers.map(({ offer: o, index: i }) => {
                  const pct = discountPct(o)
                  const isIn = !excluded.has(i)
                  return (
                    <tr
                      key={i}
                      className={`border-b border-zinc-100 ${isIn ? '' : 'opacity-40'}`}
                    >
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={isIn} onChange={() => toggleOffer(i)} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          {o.imageUrl && (
                            <img
                              src={o.imageUrl}
                              alt=""
                              className="h-8 w-8 rounded object-cover"
                              loading="lazy"
                            />
                          )}
                          <span className="line-clamp-2 max-w-xs">{o.title}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {o.category ? (
                          <div className="space-y-1">
                            <Badge tone={CATEGORY_TONES[o.category]}>Categoria {o.category}</Badge>
                            {typeof o.relevanceScore === 'number' && (
                              <div className="text-xs text-zinc-500">Relevância {o.relevanceScore}/100</div>
                            )}
                          </div>
                        ) : <span className="text-xs text-zinc-400">Sem categoria</span>}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <div className="font-medium">{formatBRL(o.discountedPrice)}</div>
                        {o.originalPrice && (
                          <div className="text-xs text-zinc-400 line-through">
                            {formatBRL(o.originalPrice)}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {pct !== null ? <Badge tone="green">{pct}%</Badge> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        {o.commissionPercent || typeof o.commissionRate === 'number' ? (
                          <Badge tone="violet">{o.commissionPercent || `${o.commissionRate}%`}</Badge>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {o.commissioned === false ? (
                          <Badge tone="amber">sem comissão</Badge>
                        ) : (
                          <Badge tone="blue">afiliado</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {(() => {
                          const f = offerFlags[offerIdentity(o)]
                          if (!f) return <span className="text-zinc-300">—</span>
                          return (
                            <div className="flex flex-col gap-1">
                              {f.alreadySent && (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-amber-700"
                                  title={`Enviado ${f.sentCount}× · ${f.sampleGroup ?? ''} ${timeAgo(f.lastSentAt)}`}
                                >
                                  <History size={12} /> já enviado {f.sentCount}× · {timeAgo(f.lastSentAt)}
                                </span>
                              )}
                              {f.inActiveCampaign && (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-blue-700"
                                  title={f.activeCampaignNames.join(', ')}
                                >
                                  <CalendarClock size={12} /> em campanha
                                </span>
                              )}
                              {!f.alreadySent && !f.inActiveCampaign && (
                                <span className="text-xs text-green-600">novo</span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* ── 2. Message template ──────────────────────── */}
      {offers.length > 0 && (
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
          <h2 className="font-semibold">3 · Grupos ({selectedGroupIds.size} selecionados)</h2>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Intervalo mínimo (segundos)</Label>
            <Input
              type="number"
              min={1}
              value={safety.minDelaySeconds}
              onChange={(e) => setSafety({ ...safety, minDelaySeconds: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Intervalo máximo (segundos)</Label>
            <Input
              type="number"
              min={1}
              value={safety.maxDelaySeconds}
              onChange={(e) => setSafety({ ...safety, maxDelaySeconds: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Máximo por hora (0 = ilimitado)</Label>
            <Input
              type="number"
              min={0}
              value={safety.maxPerHour}
              onChange={(e) => setSafety({ ...safety, maxPerHour: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Aquecimento: lote (0 = desligado)</Label>
            <Input
              type="number"
              min={0}
              value={safety.warmupBatchSize}
              onChange={(e) => setSafety({ ...safety, warmupBatchSize: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={safety.shuffleGroups}
              onChange={(e) => setSafety({ ...safety, shuffleGroups: e.target.checked })}
            />
            Embaralhar ordem dos grupos
          </label>
        </div>
      </Card>

      {/* ── 5. Send / Schedule ───────────────────────── */}
      <Card>
        <h2 className="mb-3 font-semibold">5 · Enviar</h2>
        <div className="mb-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-800">
          Total de mensagens: <strong>{totalMessages}</strong> ({includedOffers.length} produto(s) ×{' '}
          {selectedGroupIds.size} grupo(s))
        </div>

        {alreadySentIncluded > 0 && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <History size={14} className="mr-1 inline" />
            {alreadySentIncluded} produto(s) já enviados antes continuam incluídos. Revise a coluna
            "Status" e desmarque os que não quer reenviar.
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
            <Button onClick={() => createMutation.mutate(false)} disabled={!canSubmit}>
              <Clock size={16} /> Agendar campanha
            </Button>
          ) : (
            <Button onClick={() => createMutation.mutate(true)} disabled={!canSubmit}>
              <Send size={16} /> Enviar agora
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => createMutation.mutate(false)}
            disabled={!canSubmit}
          >
            Salvar rascunho
          </Button>
        </div>
      </Card>
    </div>
  )
}
