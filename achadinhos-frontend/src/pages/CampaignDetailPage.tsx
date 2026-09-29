import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Play,
  Ban,
  Pause,
  RotateCw,
  Save,
  CheckCircle2,
  XCircle,
  Trash2,
  Image as ImageIcon,
  ImageOff,
  Search,
  RotateCcw,
} from 'lucide-react'
import {
  campaignApi,
  groupApi,
  apiErrorMessage,
  offerIdentity,
  type Campaign,
  type Offer,
  type Safety,
} from '@/lib/api'
import { Button, Card, Badge, Spinner, Input, Label } from '@/components/ui'
import { WhatsAppBubble } from '@/components/WhatsAppBubble'
import { ProductDeliveryStatus } from '@/components/ProductDeliveryStatus'

const ACTIVE: Campaign['status'][] = ['RUNNING', 'SCHEDULED']

function statusBadge(status: Campaign['status']) {
  const map: Record<
    Campaign['status'],
    { tone: 'zinc' | 'green' | 'red' | 'amber' | 'violet' | 'blue'; label: string }
  > = {
    DRAFT: { tone: 'zinc', label: 'Rascunho' },
    SCHEDULED: { tone: 'blue', label: 'Agendada' },
    RUNNING: { tone: 'amber', label: 'Enviando' },
    PAUSED: { tone: 'amber', label: 'Pausada' },
    COMPLETED: { tone: 'green', label: 'Concluída' },
    FAILED: { tone: 'red', label: 'Falhou' },
    CANCELLED: { tone: 'zinc', label: 'Cancelada' },
  }
  const { tone, label } = map[status]
  return <Badge tone={tone}>{label}</Badge>
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatBRL(v?: number) {
  return v === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const CATEGORY_TONES = { A: 'green', B: 'blue', C: 'amber', D: 'red' } as const

function OfferCategoryBadge({ offer }: { offer: Offer }) {
  if (!offer.category) return null
  return (
    <span
      className="shrink-0"
      title={typeof offer.relevanceScore === 'number' ? `Relevância ${offer.relevanceScore}/100` : undefined}
    >
      <Badge tone={CATEGORY_TONES[offer.category]}>Categoria {offer.category}</Badge>
    </span>
  )
}

export default function CampaignDetailPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const qc = useQueryClient()

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => campaignApi.get(campaignId),
    refetchInterval: (q) => (ACTIVE.includes(q.state.data?.status as Campaign['status']) ? 2500 : false),
  })
  const logsQuery = useQuery({
    queryKey: ['campaign-logs', campaignId],
    queryFn: () => campaignApi.logs(campaignId),
    refetchInterval: () =>
      ACTIVE.includes(campaignQuery.data?.status as Campaign['status']) ? 2500 : false,
  })
  const metaQuery = useQuery({ queryKey: ['campaign-meta'], queryFn: campaignApi.meta })

  const c = campaignQuery.data

  // ── Editable local state (seeded from the campaign) ──
  const [name, setName] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [safety, setSafety] = useState<Safety | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [sendImages, setSendImages] = useState(true)
  const [scheduledAt, setScheduledAt] = useState('')
  const [seededId, setSeededId] = useState<number | null>(null)
  const [previews, setPreviews] = useState<{ title: string; message: string }[]>([])
  const [groupSearch, setGroupSearch] = useState('')
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const templateRef = useRef<HTMLTextAreaElement>(null)

  // Seed local editable state once per loaded campaign id (render-time guard,
  // avoids setState-in-effect). Safe: setters are called only when the id changes.
  if (c && seededId !== c.id) {
    setName(c.name)
    setOffers(c.offers)
    setGroups(c.groups)
    setSafety(c.safety)
    setTemplate(c.messageTemplate)
    setSendImages(c.sendImages)
    setScheduledAt(toLocalInput(c.scheduledAt))
    setSeededId(c.id)
  }

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupApi.list(),
    enabled: showGroupPicker,
  })

  const effectiveTemplate = template ?? metaQuery.data?.defaultTemplate ?? ''

  // Live preview (debounced).
  const previewMutation = useMutation({
    mutationFn: () => campaignApi.preview(offers, effectiveTemplate),
    onSuccess: (res) => setPreviews(res),
  })
  useEffect(() => {
    if (offers.length === 0) return
    const t = setTimeout(() => previewMutation.mutate(), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTemplate, offers])

  const saveMutation = useMutation({
    mutationFn: () =>
      campaignApi.update(campaignId, {
        name,
        offers,
        groups,
        safety: safety ?? undefined,
        messageTemplate: effectiveTemplate,
        sendImages,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['campaign', campaignId], updated)
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const runM = useMutationAction(() => campaignApi.run(campaignId), qc, campaignId, setError)
  const pauseM = useMutationAction(() => campaignApi.pause(campaignId), qc, campaignId, setError)
  const resumeM = useMutationAction(() => campaignApi.resume(campaignId), qc, campaignId, setError)
  const cancelM = useMutationAction(() => campaignApi.cancel(campaignId), qc, campaignId, setError)

  const filteredGroups = useMemo(() => {
    const list = groupsQuery.data ?? []
    if (!groupSearch.trim()) return list
    const q = groupSearch.toLowerCase()
    return list.filter((g) => g.name.toLowerCase().includes(q))
  }, [groupsQuery.data, groupSearch])

  const campaignOfferKeys = useMemo(() => offers.map(offerIdentity), [offers])
  const campaignGroupIds = useMemo(() => groups.map((group) => group.id).sort(), [groups])
  const campaignGroupNames = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  )
  const deliveryQuery = useQuery({
    queryKey: ['offer-group-delivery', campaignOfferKeys, campaignGroupIds],
    queryFn: () => campaignApi.checkOffersBatched(
      offers.map((offer) => ({
        savedProductId: offer.savedProductId,
        source: offer.source,
        productId: offer.productId,
        affiliateUrl: offer.affiliateUrl,
      })),
      campaignGroupIds,
    ),
    enabled: offers.length > 0 && campaignGroupIds.length > 0,
  })
  const deliverySummary = useMemo(() => {
    const counts = { eligible: 0, sent: 0, sending: 0, ambiguous: 0 }
    for (const offer of offers) {
      for (const group of deliveryQuery.data?.[offerIdentity(offer)]?.groups ?? []) {
        if (group.status === 'unsent') counts.eligible++
        else if (group.status === 'sent') counts.sent++
        else if (group.claimStatus === 'unconfirmed' && group.recoverable) counts.ambiguous++
        else counts.sending++
      }
    }
    return counts
  }, [deliveryQuery.data, offers])

  if (campaignQuery.isLoading || !c || !safety) {
    return (
      <div className="flex justify-center pt-10">
        <Spinner />
      </div>
    )
  }

  const editable = c.editable
  const totalPlanned = offers.length * groups.length
  const done = Math.min(totalPlanned, c.totalSent + c.totalFailed + (c.totalSkipped ?? 0))
  const pct = totalPlanned > 0 ? Math.round((done / totalPlanned) * 100) : 0
  const canRun = !runM.isPending
    && !deliveryQuery.isPending
    && !deliveryQuery.isError
    && deliverySummary.eligible > 0

  const toggleGroupSel = (g: { id: string; name: string }) =>
    setGroups((prev) =>
      prev.some((x) => x.id === g.id) ? prev.filter((x) => x.id !== g.id) : [...prev, g],
    )

  const insertPlaceholder = (key: string) => {
    const ta = templateRef.current
    const token = `{${key}}`
    const cur = effectiveTemplate
    if (!ta) return setTemplate(cur + token)
    const s = ta.selectionStart ?? cur.length
    const e = ta.selectionEnd ?? cur.length
    setTemplate(cur.slice(0, s) + token + cur.slice(e))
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = s + token.length
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={16} /> Campanhas
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{c.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
            {statusBadge(c.status)}
            {offers.length} produto(s) · {groups.length} grupo(s)
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save size={16} /> {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          )}
          {(c.status === 'DRAFT' || c.status === 'FAILED') && (
            <Button variant="secondary" onClick={() => runM.mutate()} disabled={!canRun}>
              <Play size={16} /> Enviar agora
            </Button>
          )}
          {c.status === 'SCHEDULED' && (
            <Button variant="secondary" onClick={() => pauseM.mutate()} disabled={pauseM.isPending}>
              <Pause size={16} /> Pausar
            </Button>
          )}
          {c.status === 'RUNNING' && (
            <Button variant="secondary" onClick={() => pauseM.mutate()} disabled={pauseM.isPending}>
              <Pause size={16} /> Pausar
            </Button>
          )}
          {c.status === 'PAUSED' && (
            <Button variant="secondary" onClick={() => resumeM.mutate()} disabled={resumeM.isPending}>
              <RotateCw size={16} /> Retomar
            </Button>
          )}
          {c.status !== 'COMPLETED' && c.status !== 'CANCELLED' && (
            <Button variant="danger" onClick={() => cancelM.mutate()} disabled={cancelM.isPending}>
              <Ban size={16} /> Cancelar
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saveMutation.isSuccess && !error && (
        <p className="text-sm text-green-600">Alterações salvas.</p>
      )}

      {offers.length > 0 && groups.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Envio por produto e grupo</h2>
              <p className="text-sm text-zinc-500">O mesmo produto pode ir a vários grupos da conexão atual; cada combinação é controlada separadamente.</p>
            </div>
            {deliveryQuery.isPending ? <Spinner /> : (
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="font-medium text-green-700">{deliverySummary.eligible} a enviar</span>
                <span className="font-medium text-amber-700">{deliverySummary.sent} já enviada(s)</span>
                <span className="font-medium text-blue-700">{deliverySummary.sending} em campanha</span>
                <span className="font-medium text-red-700">{deliverySummary.ambiguous} sem confirmação</span>
              </div>
            )}
          </div>
          {deliveryQuery.isError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Não foi possível verificar o histórico. O início da campanha fica bloqueado até a
              verificação funcionar. <button type="button" className="underline" onClick={() => void deliveryQuery.refetch()}>Tentar novamente</button>
            </p>
          )}
          {!deliveryQuery.isPending && !deliveryQuery.isError && deliverySummary.eligible === 0 && c.status === 'DRAFT' && (
            <p role="status" className="mt-3 text-sm text-amber-800">
              {deliverySummary.ambiguous > 0
                ? `Há ${deliverySummary.ambiguous} envio(s) sem confirmação. Confira o WhatsApp e resolva cada item abaixo antes de iniciar.`
                : 'Todos os pares desta campanha já foram enviados ou estão em outra campanha. Adicione outro produto ou grupo antes de iniciar.'}
            </p>
          )}
        </Card>
      )}

      {!editable && (
        <Card>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Progresso</span>
            <span className="text-zinc-500">
              {done} / {totalPlanned} ({pct}%)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100">
            <div className="brand-gradient h-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 flex gap-4 text-sm">
            <span className="text-green-600">{c.totalSent} enviadas</span>
            <span className="text-red-600">{c.totalFailed} falhas</span>
            <span className="text-zinc-500">{c.totalSkipped ?? 0} ignoradas por histórico</span>
          </div>
        </Card>
      )}

      {editable ? (
        <>
          <Card>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Card>

          {/* Schedule */}
          <Card>
            <Label>Agendamento (vazio = rascunho, sem envio automático)</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Card>

          {/* Template + preview */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Mensagem</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSendImages((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    sendImages
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                  }`}
                >
                  {sendImages ? <ImageIcon size={14} /> : <ImageOff size={14} />}
                  {sendImages ? 'Enviando imagem' : 'Só texto (link)'}
                </button>
                <Button
                  variant="ghost"
                  onClick={() => metaQuery.data && setTemplate(metaQuery.data.defaultTemplate)}
                >
                  <RotateCcw size={14} /> Padrão
                </Button>
              </div>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {metaQuery.data?.placeholders.map((p) => (
                <button
                  key={p.key}
                  onClick={() => insertPlaceholder(p.key)}
                  className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-violet-100 hover:text-violet-700"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <textarea
                ref={templateRef}
                value={effectiveTemplate}
                onChange={(e) => setTemplate(e.target.value)}
                className="h-64 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
              />
              <div className="h-64 space-y-2 overflow-y-auto rounded-lg bg-[#e5ddd5] p-3">
                {previews.slice(0, 4).map((p, i) => {
                  const offer = offers.find((o) => o.title === p.title)
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
                {previews.length === 0 && <p className="text-xs text-zinc-500">Prévia…</p>}
              </div>
            </div>
          </Card>

          {/* Offers */}
          <Card>
            <h2 className="mb-3 font-semibold">Produtos ({offers.length})</h2>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {offers.map((o, i) => (
                <div key={i} className="grid gap-2 rounded-lg px-2 py-2 hover:bg-zinc-50 md:grid-cols-[auto_minmax(0,1fr)_auto_auto_minmax(12rem,auto)_auto] md:items-start">
                  {o.imageUrl && <img src={o.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                  <span className="min-w-0 truncate text-sm">{o.title}</span>
                  <OfferCategoryBadge offer={o} />
                  <span className="text-sm font-medium">{formatBRL(o.discountedPrice)}</span>
                  <ProductDeliveryStatus groups={deliveryQuery.data?.[offerIdentity(o)]?.groups ?? []} savedProductId={o.savedProductId} offer={{ source: o.source, productId: o.productId, affiliateUrl: o.affiliateUrl }} groupNames={campaignGroupNames} compact={groups.length > 4} />
                  {o.commissioned === false && <Badge tone="amber">sem comissão</Badge>}
                  <button
                    onClick={() => setOffers((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-zinc-400 hover:text-red-600"
                    title="Remover"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {offers.length === 0 && (
                <p className="py-3 text-center text-sm text-red-500">
                  Sem produtos — adicione ao menos um antes de salvar.
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Para adicionar novos produtos em massa, crie uma nova campanha via importação de JSON.
            </p>
          </Card>

          {/* Groups */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Grupos ({groups.length})</h2>
              <Button variant="ghost" onClick={() => setShowGroupPicker((v) => !v)}>
                {showGroupPicker ? 'Fechar' : 'Editar grupos'}
              </Button>
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              {groups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-3 py-1 text-xs text-violet-700"
                >
                  {g.name}
                  <button onClick={() => toggleGroupSel(g)} className="hover:text-red-600">
                    ×
                  </button>
                </span>
              ))}
              {groups.length === 0 && <span className="text-sm text-red-500">Nenhum grupo.</span>}
            </div>

            {showGroupPicker && (
              <>
                {groupsQuery.isLoading && <Spinner />}
                {groupsQuery.isError && (
                  <p className="text-sm text-red-600">{apiErrorMessage(groupsQuery.error)}</p>
                )}
                {groupsQuery.data && (
                  <>
                    <div className="relative mb-2">
                      <Search size={16} className="absolute left-3 top-2.5 text-zinc-400" />
                      <Input
                        className="pl-9"
                        placeholder="Buscar grupo…"
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {filteredGroups.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50"
                        >
                          <input
                            type="checkbox"
                            checked={groups.some((x) => x.id === g.id)}
                            onChange={() => toggleGroupSel({ id: g.id, name: g.name })}
                          />
                          <span className="flex-1 text-sm">{g.name}</span>
                          <span className="text-xs text-zinc-400">{g.size} membros</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Card>

          {/* Safety */}
          <Card>
            <h2 className="mb-3 font-semibold">Segurança de envio</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Intervalo mínimo (s)</Label>
                <Input
                  type="number"
                  min={1}
                  value={safety.minDelaySeconds}
                  onChange={(e) => setSafety({ ...safety, minDelaySeconds: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Intervalo máximo (s)</Label>
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
                <Label>Aquecimento: lote (0 = off)</Label>
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
        </>
      ) : null}

        {!editable && (
          <Card>
            <h2 className="mb-3 font-semibold">Produtos ({offers.length})</h2>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {offers.map((o, i) => (
                <div key={i} className="grid gap-2 rounded-lg px-2 py-2 md:grid-cols-[auto_minmax(0,1fr)_auto_auto_minmax(12rem,auto)] md:items-start">
                  {o.imageUrl && <img src={o.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                  <span className="min-w-0 truncate text-sm">{o.title}</span>
                  <OfferCategoryBadge offer={o} />
                  <span className="text-sm font-medium">{formatBRL(o.discountedPrice)}</span>
                  <ProductDeliveryStatus groups={deliveryQuery.data?.[offerIdentity(o)]?.groups ?? []} savedProductId={o.savedProductId} offer={{ source: o.source, productId: o.productId, affiliateUrl: o.affiliateUrl }} groupNames={campaignGroupNames} compact={groups.length > 4} />
                </div>
              ))}
            </div>
          </Card>
        )}

      {/* Logs (always) */}
      <Card>
        <h2 className="mb-3 font-semibold">Registro de envios</h2>
        {logsQuery.isLoading && <Spinner />}
        {logsQuery.data && logsQuery.data.length === 0 && (
          <p className="text-sm text-zinc-400">Nenhum envio ainda.</p>
        )}
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {logsQuery.data?.map((log) => (
            <div key={log.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50">
              {log.success ? (
                <CheckCircle2 size={16} className="text-green-500" />
              ) : (
                <XCircle size={16} className="text-red-500" />
              )}
              <span className="flex-1 truncate">
                <span className="font-medium">{log.offerTitle}</span>
                <span className="text-zinc-400"> → {log.groupName}</span>
              </span>
              {!log.success && <span className="truncate text-xs text-red-500">{log.error}</span>}
              <span className="text-xs text-zinc-400">
                {new Date(log.sentAt).toLocaleTimeString('pt-BR')}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/**
 * Small helper to build a status-action mutation that refreshes the campaign
 * on success and surfaces errors. Declared at module scope so it is a stable
 * hook, called consistently in render order above.
 */
function useMutationAction(
  fn: () => Promise<Campaign>,
  qc: ReturnType<typeof useQueryClient>,
  campaignId: number,
  setError: (m: string | null) => void,
) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (updated) => {
      qc.setQueryData(['campaign', campaignId], updated)
      qc.invalidateQueries({ queryKey: ['campaign-logs', campaignId] })
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
}
