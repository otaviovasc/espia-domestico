import { isAxiosError } from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Play,
  Ban,
  Pause,
  RotateCw,
  Shuffle,
  Save,
  CheckCircle2,
  XCircle,
  Trash2,
  Image as ImageIcon,
  ImageOff,
  Search,
  RotateCcw,
  ExternalLink,
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
import { Button, Card, Spinner, Input, Label } from '@/components/ui'
import { WhatsAppBubble } from '@/components/WhatsAppBubble'
import { SafetyControls } from '@/components/SafetyControls'
import { CampaignStatus, CampaignStatusDescription } from '@/components/CampaignStatus'
import { CampaignConfirmDialog } from '@/components/CampaignConfirmDialog'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { CampaignOfferRow } from '@/components/CampaignOfferRow'
import { CampaignProgressCard } from '@/components/CampaignProgressCard'
import { ProductDeliveryStatus } from '@/components/ProductDeliveryStatus'

const ACTIVE: Campaign['status'][] = ['RUNNING', 'SCHEDULED']

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type CampaignForm = Pick<Campaign, 'name' | 'offers' | 'groups' | 'messageTemplate' | 'sendImages' | 'allowResend'> & { safety: Safety; scheduledAt: string }

function campaignForm(campaign: Campaign): CampaignForm {
  return { name: campaign.name, offers: campaign.offers, groups: campaign.groups, safety: { ...campaign.safety, shuffleOffers: campaign.safety.shuffleOffers ?? true }, messageTemplate: campaign.messageTemplate, sendImages: campaign.sendImages, allowResend: campaign.allowResend ?? false, scheduledAt: toLocalInput(campaign.scheduledAt) }
}

// Compare nested offer metadata by value, without depending on JSONB object key order.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}

function formSignature(form: CampaignForm, defaultTemplate: string) {
  return canonical({ ...form, name: form.name.trim(), messageTemplate: form.messageTemplate ?? defaultTemplate })
}

export default function CampaignDetailPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const validId = Number.isSafeInteger(campaignId) && campaignId > 0
  const qc = useQueryClient()

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => campaignApi.get(campaignId),
    enabled: validId,
    retry: (count, error) => !(isAxiosError(error) && error.response?.status === 404) && count < 2,
    refetchInterval: (q) => (ACTIVE.includes(q.state.data?.status as Campaign['status']) ? 2500 : false),
  })
  const logsQuery = useQuery({
    queryKey: ['campaign-logs', campaignId],
    queryFn: () => campaignApi.logs(campaignId),
    enabled: validId && !!campaignQuery.data,
    refetchInterval: () =>
      ACTIVE.includes(campaignQuery.data?.status as Campaign['status']) ? 2500 : false,
  })
  const progressQuery = useQuery({
    queryKey: ['campaign-progress', campaignId],
    queryFn: () => campaignApi.progress(campaignId),
    enabled: validId && !!campaignQuery.data,
    refetchInterval: () =>
      ACTIVE.includes(campaignQuery.data?.status as Campaign['status']) ? 3000 : false,
  })
  const metaQuery = useQuery({ queryKey: ['campaign-meta'], queryFn: campaignApi.meta })

  const c = campaignQuery.data

  // ── Editable local state (seeded from the campaign) ──
  const [name, setName] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [offerPage, setOfferPage] = useState(1)
  const offerPageCount = Math.max(1, Math.ceil(offers.length / 40))
  const safeOfferPage = Math.min(offerPage, offerPageCount)
  const pagedOffers = offers.map((offer, index) => ({ offer, index })).slice((safeOfferPage - 1) * 40, safeOfferPage * 40)
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [safety, setSafety] = useState<Safety | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [sendImages, setSendImages] = useState(true)
  const [allowResend, setAllowResend] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [savedForm, setSavedForm] = useState<CampaignForm | null>(null)
  const [confirmation, setConfirmation] = useState<'run' | 'resume' | 'cancel' | { removeOffer: Offer } | null>(null)
  const [seededId, setSeededId] = useState<number | null>(null)
  const [previews, setPreviews] = useState<{ title: string; message: string }[]>([])
  const [groupSearch, setGroupSearch] = useState('')
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const templateRef = useRef<HTMLTextAreaElement>(null)

  // Seed local editable state once per loaded campaign id (render-time guard,
  // avoids setState-in-effect). Safe: setters are called only when the id changes.
  if (c && seededId !== c.id) {
    setSavedForm(campaignForm(c))
    setName(c.name)
    setOffers(c.offers)
    setGroups(c.groups)
    // Campaigns saved before shuffleOffers existed mix products by default.
    setSafety({ ...c.safety, shuffleOffers: c.safety.shuffleOffers ?? true })
    setTemplate(c.messageTemplate)
    setSendImages(c.sendImages)
    setAllowResend(c.allowResend ?? false)
    setScheduledAt(toLocalInput(c.scheduledAt))
    setSeededId(c.id)
  }

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupApi.list(),
    enabled: showGroupPicker,
  })

  const defaultTemplate = metaQuery.data?.defaultTemplate ?? ''
  const effectiveTemplate = template ?? defaultTemplate
  const dirty = !!c?.editable && seededId === c.id && !!safety && !!savedForm && formSignature({ name, offers, groups, safety, messageTemplate: template, sendImages, allowResend, scheduledAt }, defaultTemplate) !== formSignature(savedForm, defaultTemplate)
  const { prompt } = useUnsavedChanges(dirty, 'As alterações desta campanha ainda não foram salvas.')

  // Live preview (debounced).
  const previewMutation = useMutation({
    mutationFn: () => campaignApi.preview(offers.slice(0, 4), effectiveTemplate),
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
        allowResend,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    onSuccess: (updated) => {
      setSavedForm(campaignForm(updated))
      qc.setQueryData(['campaign', campaignId], updated)
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const runM = useMutationAction(() => campaignApi.run(campaignId), qc, campaignId, setError)
  const pauseM = useMutationAction(() => campaignApi.pause(campaignId), qc, campaignId, setError)
  const resumeM = useMutationAction(() => campaignApi.resume(campaignId), qc, campaignId, setError)
  const cancelM = useMutationAction(() => campaignApi.cancel(campaignId), qc, campaignId, setError)

  const removeOfferM = useMutation({
    mutationFn: (affiliateUrl: string) => campaignApi.removeOffer(campaignId, affiliateUrl),
    onSuccess: (updated) => {
      qc.setQueryData(['campaign', campaignId], updated)
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      setOffers(updated.offers)
      qc.invalidateQueries({ queryKey: ['campaign-progress', campaignId] })
      qc.invalidateQueries({ queryKey: ['offer-group-delivery'] })
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

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

  if (!validId || (campaignQuery.isError && !c)) {
    const missing = !validId || (isAxiosError(campaignQuery.error) && campaignQuery.error.response?.status === 404)
    return <div className="workspace-page max-w-5xl"><Link to="/campaigns" className="inline-flex min-h-11 items-center gap-2 text-sm text-accent"><ArrowLeft size={16} />Campanhas</Link><div role="alert" className="surface-panel mt-4 p-6"><h1 className="page-title">{missing ? 'Campanha não encontrada' : 'Não foi possível carregar a campanha'}</h1><p className="mt-2 text-sm text-muted">{missing ? 'O endereço pode estar incorreto ou esta campanha não está disponível.' : apiErrorMessage(campaignQuery.error)}</p>{!missing && <Button variant="secondary" className="mt-4" disabled={campaignQuery.isFetching} onClick={() => void campaignQuery.refetch()}><RotateCw size={16} />Tentar novamente</Button>}</div></div>
  }

  if (campaignQuery.isLoading || !c || !safety) {
    return (
      <div role="status" className="flex items-center justify-center gap-3 pt-10 text-sm text-muted">
        <Spinner /> Carregando campanha…
      </div>
    )
  }

  const editable = c.editable
  const effectiveEligible = deliverySummary.eligible + (allowResend ? deliverySummary.sent : 0)
  const canRun = !dirty
    && !saveMutation.isPending
    && !runM.isPending
    && !deliveryQuery.isPending
    && !deliveryQuery.isError
    && effectiveEligible > 0

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
    <div className="workspace-page max-w-5xl space-y-5">
      <Link to="/campaigns" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Campanhas
      </Link>

      <div className="page-header">
        <div>
          <h1 className="page-title break-words">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <CampaignStatus status={c.status} stalled={c.status === 'RUNNING' && c.stalled} />
            {offers.length} produto(s) · {groups.length} grupo(s)
          </div>
          <p className="mt-2 max-w-xl text-sm text-muted"><CampaignStatusDescription status={c.status} /></p>
          {c.scheduledAt && <p className="mt-1 text-sm text-muted tabular-nums">Agendada para {new Date(c.scheduledAt).toLocaleString('pt-BR')}</p>}
        </div>
        <div className="page-actions flex flex-wrap gap-2">
          {editable && (
            <Button id="campaign-save" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save size={16} /> {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          )}
          {(c.status === 'DRAFT' || c.status === 'FAILED') && (
            <Button variant="secondary" onClick={() => { if (dirty) { document.getElementById('campaign-save')?.focus(); return }; if (canRun) setConfirmation('run') }} disabled={!canRun} aria-describedby={dirty ? 'campaign-unsaved' : undefined}>
              <Play size={16} /> {runM.isPending ? 'Iniciando…' : 'Enviar agora'}
            </Button>
          )}
          {(c.status === 'SCHEDULED' || c.status === 'RUNNING') && (
            <Button variant="secondary" onClick={() => pauseM.mutate()} disabled={pauseM.isPending}>
              <Pause size={16} /> {pauseM.isPending ? 'Pausando…' : 'Pausar'}
            </Button>
          )}
          {c.status === 'RUNNING' && (
            <Button
              variant="secondary"
              onClick={() => { if (!dirty && !saveMutation.isPending) setConfirmation('resume') }}
              disabled={dirty || saveMutation.isPending || resumeM.isPending}
              title={
                allowResend
                  ? 'Reinicia o envio de onde parou (pares já enviados SERÃO enviados de novo — reenvio ativado)'
                  : 'Reinicia o envio de onde parou (não reenvia o que já foi enviado)'
              }
            >
              <RotateCw size={16} /> {resumeM.isPending ? 'Retomando…' : c.stalled ? 'Retomar envio' : 'Reiniciar envio'}
            </Button>
          )}
          {c.status === 'PAUSED' && (
            <Button variant="secondary" onClick={() => { if (!dirty && !saveMutation.isPending) setConfirmation('resume') }} disabled={dirty || saveMutation.isPending || resumeM.isPending}>
              <RotateCw size={16} /> {resumeM.isPending ? 'Retomando…' : 'Retomar'}
            </Button>
          )}

        </div>
      </div>

      {dirty && <div id="campaign-unsaved" role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"><p>Há alterações não salvas. Salve a campanha antes de enviar.</p><button type="button" className="min-h-11 font-semibold underline underline-offset-4" onClick={() => document.getElementById('campaign-save')?.focus()}>Ir para Salvar</button></div>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {saveMutation.isSuccess && !error && !dirty && (
        <p role="status" className="text-sm text-success">Alterações salvas.</p>
      )}
      {c.status === 'RUNNING' && c.stalled && (
        <div className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          Este envio foi interrompido (o servidor reiniciou durante a campanha). Clique em
          <strong> Retomar envio</strong> para continuar de onde parou
          {allowResend ? (
            <> — atenção: com o reenvio ativado, os pares já enviados SERÃO enviados de novo.</>
          ) : (
            <> — os produtos já enviados não serão repetidos.</>
          )}
        </div>
      )}

      {offers.length > 0 && groups.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Envio por produto e grupo</h2>
              <p className="text-sm text-muted">O mesmo produto pode ir a vários grupos da conexão atual; cada combinação é controlada separadamente.</p>
            </div>
            {deliveryQuery.isPending ? <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner />Verificando envios…</div> : !deliveryQuery.isError && (
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="font-medium text-success">{effectiveEligible} a enviar</span>
                <span className="font-medium text-success">{deliverySummary.sent} já enviada(s){allowResend && deliverySummary.sent > 0 ? ' (reenviam)' : ''}</span>
                <span className="font-medium text-info">{deliverySummary.sending} em campanha</span>
                <span className="font-medium text-danger">{deliverySummary.ambiguous} sem confirmação</span>
              </div>
            )}
          </div>
          {editable && (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allowResend}
                onChange={(e) => setAllowResend(e.target.checked)}
              />
              <span>
                <span className="font-medium">Reenviar pares já enviados nesta conexão</span>
                <span className="block text-xs text-muted">
                  Clique em Salvar para gravar. Pares em campanha ou sem confirmação continuam bloqueados.
                </span>
              </span>
            </label>
          )}
          {!editable && allowResend && (
            <p className="mt-3 text-sm text-warning">
              Reenvio ativado: pares já enviados serão enviados de novo ao iniciar.
            </p>
          )}
          {deliveryQuery.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              Não foi possível verificar o histórico. O início da campanha fica bloqueado até a
              verificação funcionar. <button type="button" className="underline" onClick={() => void deliveryQuery.refetch()}>Tentar novamente</button>
            </p>
          )}
          {!deliveryQuery.isPending && !deliveryQuery.isError && effectiveEligible === 0 && c.status === 'DRAFT' && (
            <p role="status" className="mt-3 text-sm text-warning">
              {deliverySummary.ambiguous > 0
                ? `Há ${deliverySummary.ambiguous} envio(s) sem confirmação. Confira o WhatsApp e resolva cada item abaixo antes de iniciar.`
                : 'Todos os pares desta campanha já foram enviados ou estão em outra campanha. Adicione outro produto ou grupo antes de iniciar.'}
            </p>
          )}
        </Card>
      )}

      {campaignQuery.isError && <p role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">Não foi possível atualizar a situação da campanha. <button className="underline" onClick={() => void campaignQuery.refetch()}>Tentar novamente</button></p>}
      {!editable && progressQuery.isLoading && <div role="status" className="surface-panel flex items-center gap-3 p-4 text-sm text-muted"><Spinner />Carregando progresso…</div>}
      {!editable && progressQuery.isError && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">Não foi possível atualizar o progresso. <button className="underline" onClick={() => void progressQuery.refetch()}>Tentar novamente</button></p>}
      {!editable && progressQuery.data && (
        <CampaignProgressCard progress={progressQuery.data} />
      )}

      {editable ? (
        <>
          <Card>
            <h2 className="mb-4 font-semibold">Configuração da campanha</h2>
            <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="campaign-name">Nome da campanha</Label>
            <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label htmlFor="campaign-schedule">Agendamento</Label>
            <Input
              id="campaign-schedule"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted">Horário local. Deixe vazio para manter como rascunho, sem envio automático.</p></div>
            </div>
          </Card>

          {/* Template + preview */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Mensagem</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  aria-pressed={sendImages}
                  onClick={() => setSendImages((v) => !v)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    sendImages
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-muted hover:bg-surface-muted'
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
            {metaQuery.isError && <p role="alert" className="mb-3 text-sm text-danger">Não foi possível carregar os campos da mensagem. <button className="underline" onClick={() => void metaQuery.refetch()}>Tentar novamente</button></p>}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {metaQuery.data?.placeholders.map((p) => (
                <button
                  key={p.key}
                  onClick={() => insertPlaceholder(p.key)}
                  className="min-h-9 rounded-md bg-surface-muted px-2 py-1 text-xs text-muted hover:bg-accent-soft hover:text-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <textarea
                aria-label="Modelo da mensagem"
                ref={templateRef}
                value={effectiveTemplate}
                onChange={(e) => setTemplate(e.target.value)}
                className="h-64 w-full rounded-lg border border-line-strong bg-surface p-3 text-sm leading-relaxed text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <div aria-label="Prévia da mensagem no WhatsApp" className="h-64 space-y-2 overflow-y-auto rounded-lg bg-[#e5ddd5] p-3">
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
                {previewMutation.isPending && <p role="status" className="text-xs text-[#526256]">Atualizando prévia…</p>}
                {previewMutation.isError && <p role="alert" className="rounded bg-danger-soft p-2 text-sm text-danger">Não foi possível gerar a prévia. <button className="underline" onClick={() => previewMutation.mutate()}>Tentar novamente</button></p>}
                {previews.length === 0 && !previewMutation.isPending && !previewMutation.isError && <p className="text-xs text-[#526256]">A prévia aparece quando há produtos e uma mensagem.</p>}
              </div>
            </div>
          </Card>

          {/* Offers */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Produtos ({offers.length})</h2>
              <Button
                variant="ghost"
                onClick={() =>
                  setOffers((prev) => {
                    const next = [...prev]
                    for (let i = next.length - 1; i > 0; i--) {
                      const j = Math.floor(Math.random() * (i + 1))
                      ;[next[i], next[j]] = [next[j], next[i]]
                    }
                    return next
                  })
                }
                disabled={offers.length < 2}
                title="Mistura a ordem dos produtos agora (clique em Salvar para gravar)"
              >
                <Shuffle size={14} /> Embaralhar
              </Button>
            </div>
            <div className="my-3 flex items-center justify-between gap-3 text-sm"><Button variant="secondary" disabled={safeOfferPage === 1} onClick={() => setOfferPage(safeOfferPage - 1)}>Anterior</Button><span>Página {safeOfferPage} de {offerPageCount}</span><Button variant="secondary" disabled={safeOfferPage === offerPageCount} onClick={() => setOfferPage(safeOfferPage + 1)}>Próxima</Button></div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {pagedOffers.map(({ offer: o, index: i }) => (
                <CampaignOfferRow key={offerIdentity(o)} offer={o} delivery={<ProductDeliveryStatus groups={deliveryQuery.data?.[offerIdentity(o)]?.groups ?? []} savedProductId={o.savedProductId} offer={{ source: o.source, productId: o.productId, affiliateUrl: o.affiliateUrl }} groupNames={campaignGroupNames} emptyLabel={deliveryQuery.isPending ? 'Verificando histórico…' : deliveryQuery.isError ? 'Histórico indisponível' : 'Sem histórico nos grupos selecionados'} compact={groups.length > 4} />} actions={<>
                  <button type="button" onClick={() => setOffers((prev) => prev.filter((_, idx) => idx !== i))} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-danger hover:bg-danger-soft" aria-label={`Remover ${o.title} da campanha`}><Trash2 size={16} />Remover</button>
                  <a href={o.affiliateUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-accent hover:bg-accent-soft" aria-label={`Abrir ${o.title} em nova aba`}><ExternalLink size={16} />Ver produto</a>
                </>} />
              ))}
              {offers.length === 0 && (
                <p className="py-3 text-center text-sm text-danger">
                  Sem produtos — adicione ao menos um antes de salvar.
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-subtle">
              Para adicionar novos produtos em massa, crie uma nova campanha via importação de JSON.
            </p>
          </Card>

          {/* Groups */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Grupos ({groups.length})</h2>
              <Button variant="ghost" onClick={() => setShowGroupPicker((v) => !v)}>
                {showGroupPicker ? 'Fechar' : 'Editar grupos'}
              </Button>
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              {groups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-3 py-1 text-sm text-accent"
                >
                  <span className="min-w-0 break-words">{g.name}</span>
                  <button aria-label={`Remover grupo ${g.name}`} onClick={() => toggleGroupSel(g)} className="flex h-8 w-8 items-center justify-center rounded hover:text-danger">
                    ×
                  </button>
                </span>
              ))}
              {groups.length === 0 && <span className="text-sm text-danger">Nenhum grupo.</span>}
            </div>

            {showGroupPicker && (
              <>
                {groupsQuery.isLoading && <Spinner />}
                {groupsQuery.isError && (
                  <p role="alert" className="text-sm text-danger">{apiErrorMessage(groupsQuery.error)} <button className="underline" onClick={() => void groupsQuery.refetch()}>Tentar novamente</button></p>
                )}
                {groupsQuery.data && (
                  <>
                    <div className="relative mb-2">
                      <Search size={16} className="absolute left-3 top-2.5 text-subtle" />
                      <Input
                        className="pl-9"
                        aria-label="Buscar grupo"
                        placeholder="Buscar grupo…"
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {filteredGroups.length === 0 && <p className="py-3 text-sm text-muted">Nenhum grupo encontrado. Altere a busca ou confira sua conexão.</p>}
                      {filteredGroups.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-muted"
                        >
                          <input
                            type="checkbox"
                            checked={groups.some((x) => x.id === g.id)}
                            onChange={() => toggleGroupSel({ id: g.id, name: g.name })}
                          />
                          <span className="min-w-0 flex-1 break-words text-sm">{g.name}</span>
                          <span className="text-xs text-subtle">{g.size} membros</span>
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
            <SafetyControls safety={safety} onChange={setSafety} />
          </Card>
        </>
      ) : null}

        {!editable && <Card><h2 className="mb-3 font-semibold">Grupos de destino</h2><ul className="grid gap-2 text-sm sm:grid-cols-2">{groups.map((g) => <li key={g.id} className="min-w-0 break-words rounded-md bg-surface-muted px-3 py-2 text-ink">{g.name}</li>)}</ul>{groups.length === 0 && <p className="text-sm text-muted">Nenhum grupo nesta campanha.</p>}<p className="mt-3 text-xs text-muted">{sendImages ? 'Mensagem com imagem do produto.' : 'Mensagem de texto com link do produto.'}</p></Card>}

        {!editable && (
          <Card>
            <h2 className="mb-3 font-semibold">Produtos ({offers.length})</h2>

            <div className="my-3 flex items-center justify-between gap-3 text-sm"><Button variant="secondary" disabled={safeOfferPage === 1} onClick={() => setOfferPage(safeOfferPage - 1)}>Anterior</Button><span>Página {safeOfferPage} de {offerPageCount}</span><Button variant="secondary" disabled={safeOfferPage === offerPageCount} onClick={() => setOfferPage(safeOfferPage + 1)}>Próxima</Button></div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {pagedOffers.map(({ offer: o }) => {
                const offerGroups = deliveryQuery.data?.[offerIdentity(o)]?.groups ?? []
                const hasUnsent =
                  offerGroups.length === 0 || offerGroups.some((g) => g.status !== 'sent')
                const canRemove =
                  hasUnsent && c.status !== 'COMPLETED' && c.status !== 'CANCELLED'
                return (
                  <CampaignOfferRow key={offerIdentity(o)} offer={o} delivery={<ProductDeliveryStatus groups={offerGroups} savedProductId={o.savedProductId} offer={{ source: o.source, productId: o.productId, affiliateUrl: o.affiliateUrl }} groupNames={campaignGroupNames} emptyLabel={deliveryQuery.isPending ? 'Verificando histórico…' : deliveryQuery.isError ? 'Histórico indisponível' : 'Sem histórico nos grupos selecionados'} compact={groups.length > 4} />} actions={<>
                    <a href={o.affiliateUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-accent hover:bg-accent-soft" aria-label={`Abrir ${o.title} em nova aba`}><ExternalLink size={16} />Ver produto</a>
                    {canRemove && <button type="button" onClick={() => setConfirmation({ removeOffer: o })} disabled={removeOfferM.isPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-danger hover:bg-danger-soft disabled:opacity-40" aria-label={`Remover ${o.title} da campanha`}><Trash2 size={16} />{removeOfferM.isPending ? 'Removendo…' : 'Remover pendentes'}</button>}
                  </>} />
                )
              })}
            </div>
          </Card>
        )}

      {/* Logs (always) */}
      <Card>
        <h2 className="mb-3 font-semibold">Registro de envios</h2>
        {logsQuery.isLoading && <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner />Carregando registro…</div>}
        {logsQuery.isError && <p role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">Não foi possível carregar o registro. <button className="underline" onClick={() => void logsQuery.refetch()}>Tentar novamente</button></p>}
        {logsQuery.data?.length === 0 && <p className="text-sm text-muted">Nenhum envio registrado. As entregas e as falhas aparecerão aqui.</p>}
        <div className="max-h-[32rem] overflow-y-auto divide-y divide-line">
          {logsQuery.data?.map((log) => <div key={log.id} className="flex min-w-0 items-start gap-3 py-3 text-sm">
            {log.success ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />}
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className={`text-xs font-semibold ${log.success ? 'text-success' : 'text-danger'}`}>{log.success ? 'Enviado' : 'Falha no envio'}</span><time dateTime={log.sentAt} className="text-xs text-subtle tabular-nums">{new Date(log.sentAt).toLocaleString('pt-BR')}</time></div><p className="mt-1 break-words font-medium text-ink">{log.offerTitle}</p><p className="mt-1 break-words text-muted">Grupo: {log.groupName}</p>{!log.success && <p className="mt-2 break-words rounded-lg bg-danger-soft p-2 text-sm text-danger">{log.error || 'O envio não foi confirmado. Confira o WhatsApp antes de tentar novamente.'}</p>}</div>
          </div>)}
        </div>
      </Card>
      {c.status !== 'COMPLETED' && c.status !== 'CANCELLED' && <section className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5"><div><h2 className="text-sm font-semibold text-ink">Cancelar campanha</h2><p className="mt-1 text-sm text-muted">Interrompe os envios pendentes. As mensagens já enviadas permanecem nos grupos.</p></div><Button variant="danger" disabled={cancelM.isPending} onClick={() => setConfirmation('cancel')}><Ban size={16} />{cancelM.isPending ? 'Cancelando…' : 'Cancelar campanha'}</Button></section>}
      {confirmation && <CampaignConfirmDialog
        title={confirmation === 'run' ? 'Enviar campanha agora?' : confirmation === 'resume' ? (c.status === 'RUNNING' && !c.stalled ? 'Reiniciar envio?' : 'Retomar envio?') : confirmation === 'cancel' ? 'Cancelar campanha?' : 'Remover produto da campanha?'}
        description={confirmation === 'run'
          ? `Campanha: ${c.name}\n${c.offers.length} ${c.offers.length === 1 ? 'produto' : 'produtos'} para ${c.groups.length} ${c.groups.length === 1 ? 'grupo' : 'grupos'}. ${effectiveEligible} ${effectiveEligible === 1 ? 'combinação disponível' : 'combinações disponíveis'} para envio.\nAs mensagens serão enviadas agora para os grupos desta campanha.${c.allowResend ? '\nReenvio ativado: combinações já enviadas poderão receber a mensagem novamente.' : ''}`
          : confirmation === 'resume'
            ? `Campanha: ${c.name}\n${c.offers.length} ${c.offers.length === 1 ? 'produto' : 'produtos'} para ${c.groups.length} ${c.groups.length === 1 ? 'grupo' : 'grupos'}. O envio continuará com a configuração salva.${c.allowResend ? '\nReenvio ativado: as combinações já enviadas poderão receber a mensagem novamente.' : '\nAs combinações já enviadas não serão repetidas.'}`
          : confirmation === 'cancel'
            ? `Campanha: ${c.name}\nOs envios pendentes serão interrompidos. As mensagens já enviadas não serão apagadas dos grupos.${dirty ? '\nAs alterações não salvas não serão aplicadas.' : ''}`
            : `Remover “${confirmation.removeOffer.title}” de “${c.name}”? Os envios pendentes deste produto não serão realizados. As mensagens já enviadas permanecem nos grupos.`}
        confirmLabel={confirmation === 'run' ? 'Enviar para os grupos agora' : confirmation === 'resume' ? 'Confirmar retomada' : confirmation === 'cancel' ? 'Cancelar campanha' : 'Remover produto'}
        cancelLabel={confirmation === 'run' || confirmation === 'resume' ? 'Voltar à revisão' : confirmation === 'cancel' ? 'Manter campanha' : 'Manter produto'}
        danger={confirmation !== 'run' && confirmation !== 'resume'}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation === 'run') {
            if (canRun && (c.status === 'DRAFT' || c.status === 'FAILED')) runM.mutate()
          } else if (confirmation === 'resume') {
            if (!dirty && !saveMutation.isPending && !resumeM.isPending && (c.status === 'PAUSED' || c.status === 'RUNNING')) resumeM.mutate()
          } else if (confirmation === 'cancel') cancelM.mutate()
          else removeOfferM.mutate(confirmation.removeOffer.affiliateUrl)
          setConfirmation(null)
        }}
      />}
      {prompt}
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
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['campaign-logs', campaignId] })
      qc.invalidateQueries({ queryKey: ['campaign-progress', campaignId] })
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
}
