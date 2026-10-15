import { buildSmartSearchPreset } from '@/lib/smartSearchPreset'
import { useDeferredValue, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  BrainCircuit,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  FileJson,
  History,
  LoaderCircle,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Sparkles,
  Square,
  Upload,
  Users,
} from 'lucide-react'
import { apiErrorMessage, groupApi, type Group } from '@/lib/api'
import { Badge, Button, Card, Input, Label, Spinner } from '@/components/ui'
import {
  canPollPlan,
  planStatusLabel,
  smartCampaignApi,
  type SmartAudience,
  type SmartAudienceSlug,
  type SmartAIStatus,
  type SmartCreatePlanInput,
  type SmartKeywordPack,
  type SmartImportPayload,
  type SmartPlan,
  type SmartPlanItem,
  type SmartPlanItemState,
  type SmartPlanSend,
  type SmartPlanStatus,
  type SmartSendResolution,
} from '@/lib/smartCampaignApi'
import { createSmartAIRequestId } from '@/lib/smartAiSafety'

type Stage = 'audiences' | 'keywords' | 'import' | 'review' | 'monitor'

const STAGES: { id: Stage; label: string; icon: typeof Users }[] = [
  { id: 'audiences', label: 'Públicos', icon: Users },
  { id: 'keywords', label: 'Palavras-chave', icon: Sparkles },
  { id: 'import', label: 'Importar e analisar', icon: FileJson },
  { id: 'review', label: 'Revisar agenda', icon: PackageCheck },
  { id: 'monitor', label: 'Acompanhar', icon: History },
]

const NICHE_STYLES: Record<SmartAudienceSlug, { emoji: string; color: string; soft: string }> = {
  DOMESTICA: { emoji: '🏡', color: 'text-fuchsia-700', soft: 'border-fuchsia-200 bg-fuchsia-50' },
  MASCULINO: { emoji: '🧔', color: 'text-blue-700', soft: 'border-blue-200 bg-blue-50' },
  NATAL: { emoji: '🎄', color: 'text-red-700', soft: 'border-red-200 bg-red-50' },
  PESCA: { emoji: '🎣', color: 'text-cyan-700', soft: 'border-cyan-200 bg-cyan-50' },
  PET: { emoji: '🐾', color: 'text-amber-700', soft: 'border-amber-200 bg-amber-50' },
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(value)
}

function aiUnavailable(status?: SmartAIStatus): boolean {
  return Boolean(status && (!status.enabled || !status.configured))
}

function planPollInterval(status?: SmartPlanStatus): number | false {
  if (!status || !canPollPlan(status)) return false
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
  if (status === 'ANALYZING') return hidden ? 20_000 : 4_000
  if (status === 'RUNNING') return hidden ? 60_000 : 10_000
  return hidden ? 60_000 : 30_000
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function formatDate(value: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatMoney(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function score(value?: number): string {
  if (value === undefined) return '—'
  return `${Math.round(value)} / 100`
}

function statusTone(status: SmartPlanStatus): 'zinc' | 'green' | 'red' | 'amber' | 'violet' | 'blue' {
  if (status === 'COMPLETED') return 'green'
  if (status === 'FAILED') return 'red'
  if (status === 'CANCELLED') return 'zinc'
  if (status === 'RUNNING' || status === 'ANALYZING' || status === 'PAUSED') return 'amber'
  if (status === 'REVIEW' || status === 'READY' || status === 'DRAFT') return 'violet'
  return 'blue'
}

function isAnalysisFailure(plan: SmartPlan): boolean {
  const sendCount = Object.values(plan.sendSummary ?? {}).reduce((total, count) => total + count, 0)
  return plan.status === 'FAILED'
    && plan.progress?.phase === 'FAILED'
    && !plan.sends?.length
    && sendCount === 0
}

function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Card className="border-red-200 bg-red-50">
      <div className="flex flex-col gap-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{message}</span></div>
        {retry && <Button type="button" variant="secondary" onClick={retry}><RefreshCw size={15} /> Tentar novamente</Button>}
      </div>
    </Card>
  )
}

function EmptyState({ title, children }: { title: string; children: string }) {
  return (
    <Card className="border-dashed py-10 text-center">
      <BrainCircuit className="mx-auto mb-3 text-zinc-300" size={32} />
      <h3 className="font-semibold text-zinc-800">{title}</h3>
      <p className="mx-auto mt-1 max-w-lg text-sm text-zinc-500">{children}</p>
    </Card>
  )
}

function AIStatusBanner({ status, error }: { status?: SmartAIStatus; error?: unknown }) {
  if (error) {
    return <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Não foi possível conferir o orçamento da IA. Nenhuma análise foi iniciada. Os botões continuam disponíveis e o servidor ainda aplicará os limites configurados.</div>
  }
  if (!status) return <div className="mb-5 h-12 animate-pulse rounded-xl bg-zinc-100" aria-label="Carregando configuração da IA" />
  if (aiUnavailable(status)) {
    return <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><strong>IA indisponível.</strong> {status.enabled ? 'Configure a chave do provedor no servidor para liberar análises.' : 'As análises estão desativadas no servidor.'} Consultar e revisar planos não gera custo.</div>
  }
  return (
    <div className="mb-5 flex flex-col justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 sm:flex-row sm:items-center">
      <span><strong>IA sob demanda:</strong> nenhuma chamada ocorre ao abrir, navegar, atualizar ou revisar esta página.</span>
      <span className="text-xs">{status.model || 'Modelo configurado'} · máx. {formatUsd(status.limits.requestCostUsd)}/ação · {status.limits.dailyRequests}/dia · orçamento {formatUsd(status.limits.dailyCostUsd)}/dia</span>
    </div>
  )
}

function AudienceCard({ audience, groups }: { audience: SmartAudience; groups: Group[] }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(audience)
  const [expanded, setExpanded] = useState(false)

  const mutation = useMutation({
    mutationFn: () => smartCampaignApi.updateAudience(audience.slug, {
      enabled: draft.enabled,
      destinationGroupIds: draft.destinationGroupIds,
      profile: draft.profile,
      dailyCap: draft.dailyCap,
      startTime: draft.startTime,
      endTime: draft.endTime,
      minIntervalMinutes: draft.minIntervalMinutes,
      maxIntervalMinutes: draft.maxIntervalMinutes,
      minCommissionPercent: draft.minCommissionPercent,
      minEstimatedCommission: draft.minEstimatedCommission,
      maxStandoutMessages: draft.maxStandoutMessages,
    }),
    onSuccess: (updated) => {
      setDraft(updated)
      queryClient.invalidateQueries({ queryKey: ['smart-audiences'] })
    },
  })

  const style = NICHE_STYLES[audience.slug]
  const toggleGroup = (groupId: string) => setDraft((current) => ({
    ...current,
    destinationGroupIds: current.destinationGroupIds.includes(groupId)
      ? current.destinationGroupIds.filter((id) => id !== groupId)
      : [...current.destinationGroupIds, groupId],
  }))

  return (
    <Card className={`overflow-hidden p-0 ${draft.enabled ? style.soft : ''}`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="text-2xl" aria-hidden="true">{style.emoji}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={`font-bold ${style.color}`}>{audience.name || audience.slug}</h3>
                <Badge tone={draft.enabled ? 'green' : 'zinc'}>{draft.enabled ? 'Ativo' : 'Inativo'}</Badge>
              </div>
              <p className="mt-1 text-sm text-zinc-600">{audience.description}</p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-violet-600"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            Usar
          </label>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-zinc-600 sm:grid-cols-3">
          <div className="rounded-lg bg-white/80 px-3 py-2"><strong>{draft.dailyCap}</strong> produtos/dia</div>
          <div className="rounded-lg bg-white/80 px-3 py-2"><strong>{draft.startTime}–{draft.endTime}</strong></div>
          <div className="rounded-lg bg-white/80 px-3 py-2"><strong>{draft.minIntervalMinutes}–{draft.maxIntervalMinutes} min</strong> entre envios</div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-700">Grupos de WhatsApp</span>
            <span className="text-xs text-zinc-500">{draft.destinationGroupIds.length} selecionado(s)</span>
          </div>
          {groups.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Conecte o WhatsApp para carregar seus grupos.</p>
          ) : (
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2">
              {groups.map((group) => (
                <label key={group.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50">
                  <input type="checkbox" className="accent-violet-600" checked={draft.destinationGroupIds.includes(group.id)} onChange={() => toggleGroup(group.id)} />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="text-xs text-zinc-400">{group.size} membros</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="mt-4 flex items-center gap-1 text-sm font-medium text-violet-700 hover:text-violet-900" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          <Settings2 size={15} /> {expanded ? 'Ocultar inteligência e limites' : 'Ajustar inteligência e limites'}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t border-zinc-200 pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label>Máximo por dia</Label><Input type="number" min={1} max={50} value={draft.dailyCap} onChange={(e) => setDraft({ ...draft, dailyCap: Number(e.target.value) })} /></div>
              <div><Label>Início</Label><Input type="time" value="09:00" readOnly /></div>
              <div><Label>Fim</Label><Input type="time" min="09:01" max="21:00" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} /></div>
              <div><Label>Destaques por dia</Label><Input type="number" min={0} max={10} value={draft.maxStandoutMessages} onChange={(e) => setDraft({ ...draft, maxStandoutMessages: Number(e.target.value) })} /></div>
              <div><Label>Intervalo mínimo (min)</Label><Input type="number" min={12} max={16} value={draft.minIntervalMinutes} onChange={(e) => setDraft({ ...draft, minIntervalMinutes: Number(e.target.value) })} /></div>
              <div><Label>Intervalo máximo (min)</Label><Input type="number" min={12} max={16} value={draft.maxIntervalMinutes} onChange={(e) => setDraft({ ...draft, maxIntervalMinutes: Number(e.target.value) })} /></div>
              <div><Label>Comissão mínima (%)</Label><Input type="number" min={0} step="0.1" value={draft.minCommissionPercent ?? ''} placeholder="Sem mínimo" onChange={(e) => setDraft({ ...draft, minCommissionPercent: e.target.value ? Number(e.target.value) : undefined })} /></div>
              <div><Label>Comissão estimada mínima</Label><Input type="number" min={0} step="0.01" value={draft.minEstimatedCommission ?? ''} placeholder="R$ por venda" onChange={(e) => setDraft({ ...draft, minEstimatedCommission: e.target.value ? Number(e.target.value) : undefined })} /></div>
            </div>
            <div>
              <Label>O que combina com este público</Label>
              <textarea className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" value={draft.profile.instructions} onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, instructions: e.target.value } })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Termos-base (separados por vírgula)</Label><Input value={draft.profile.keywords.join(', ')} onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, keywords: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } })} /></div>
              <div><Label>Excluir (separados por vírgula)</Label><Input value={draft.profile.negativeKeywords.join(', ')} onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, negativeKeywords: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } })} /></div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 bg-white/70 px-5 py-3">
        <span className="text-xs text-zinc-500">Fuso: America/Sao_Paulo</span>
        <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner /> : <Save size={15} />} Salvar público
        </Button>
      </div>
      {mutation.isError && <p className="px-5 pb-3 text-xs text-red-700">{apiErrorMessage(mutation.error)}</p>}
    </Card>
  )
}

function AudienceSetup({ audiences, groups }: { audiences: SmartAudience[]; groups: Group[] }) {
  return (
    <section aria-labelledby="audience-title">
      <div className="mb-5">
        <h2 id="audience-title" className="text-xl font-bold">Públicos e regras</h2>
        <p className="mt-1 text-sm text-zinc-500">Vincule cada nicho aos grupos reais e defina os limites usados para selecionar e agendar ofertas.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {audiences.map((audience) => <AudienceCard key={audience.slug} audience={audience} groups={groups} />)}
      </div>
    </section>
  )
}

function KeywordPackCard({ pack, date }: { pack: SmartKeywordPack; date: string }) {
  const [copied, setCopied] = useState(false)
  const [presetCopied, setPresetCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const style = NICHE_STYLES[pack.audienceSlug]
  const phrases = pack.keywords.length > 0 ? pack.keywords : (pack.phrases ?? []).map((item) => item.keyword)
  const copy = async () => {
    try {
      setCopyError('')
      await navigator.clipboard.writeText(phrases.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { setCopyError('Não foi possível copiar. Permita acesso à área de transferência e tente novamente.') }
  }
  const copyPreset = async () => {
    try {
      setCopyError('')
      const preset = buildSmartSearchPreset({ ...pack, keywords: phrases }, date)
      await navigator.clipboard.writeText(JSON.stringify(preset, null, 2))
      setPresetCopied(true)
      window.setTimeout(() => setPresetCopied(false), 1600)
    } catch { setCopyError('Não foi possível copiar o preset. Confira a data e a permissão da área de transferência.') }
  }

  return (
    <Card className="p-0">
      <div className={`rounded-t-2xl border-b p-4 ${style.soft}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><span className="text-xl">{style.emoji}</span><h3 className={`font-bold ${style.color}`}>{pack.name || pack.audienceSlug}</h3></div>
          <Badge tone="violet">Modo {pack.mode || 'ANY'}</Badge>
        </div>
        {pack.reason && <p className="mt-2 text-xs text-zinc-600">{pack.reason}</p>}
        <p className="mt-2 text-xs text-zinc-500">Prefira o preset: palavras inteiras, sem diferenciar acentos. Atualize e recarregue a extensão antes de usar.</p>
      </div>
      <div className="p-4">
        {pack.calendarContext && pack.calendarContext.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">{pack.calendarContext.map((context) => <Badge key={context} tone="amber">{context}</Badge>)}</div>
        )}
        <div className="flex flex-wrap gap-2">
          {phrases.map((phrase) => {
            const details = pack.phrases?.find((item) => item.keyword === phrase)
            return <span key={phrase} title={details?.reason} className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-700">{phrase}</span>
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
          <span className="text-xs text-zinc-500">
            {pack.minCommissionPercent !== undefined ? `Comissão ≥ ${pack.minCommissionPercent}%` : 'Sem comissão mínima'}
            {pack.minEstimatedCommission !== undefined ? ` · estimada ≥ ${formatMoney(pack.minEstimatedCommission)}` : ''}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={copy}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? 'Copiado' : 'Copiar lista'}</Button>
            <Button type="button" onClick={copyPreset}>{presetCopied ? <Check size={15} /> : <FileJson size={15} />}{presetCopied ? 'Preset copiado' : 'Copiar preset da extensão'}</Button>
          </div>
        </div>
        {copyError && <p role="alert" className="mt-2 text-xs text-red-600">{copyError}</p>}
      </div>
    </Card>
  )
}

function KeywordPlanner({ audiences, selected, setSelected, planDate, setPlanDate, aiBlocked }: {
  audiences: SmartAudience[]
  selected: Set<SmartAudienceSlug>
  setSelected: (next: Set<SmartAudienceSlug>) => void
  planDate: string
  setPlanDate: (date: string) => void
  aiBlocked: boolean
}) {
  type KeywordRequest = Parameters<typeof smartCampaignApi.keywords>[0]
  const submitting = useRef(false)
  const mutation = useMutation({
    mutationFn: (input: KeywordRequest) => smartCampaignApi.keywords(input),
    retry: false,
    onSettled: () => { submitting.current = false },
  })
  const enabled = audiences.filter((audience) => audience.enabled)
  const fingerprint = `${planDate}:${[...selected].sort().join(',')}`
  const resultIsCurrent = mutation.variables
    ? `${mutation.variables.date}:${[...mutation.variables.audienceSlugs].sort().join(',')}` === fingerprint
    : false
  const submit = (input?: KeywordRequest) => {
    if (submitting.current || mutation.isPending || aiBlocked) return
    submitting.current = true
    mutation.mutate(input ?? { requestId: createSmartAIRequestId(), date: planDate, audienceSlugs: [...selected] })
  }

  return (
    <section aria-labelledby="keywords-title">
      <h2 id="keywords-title" className="text-xl font-bold">Busca inteligente para o dia</h2>
      <p className="mt-1 text-sm text-zinc-500">Gere termos compatíveis com o nicho, a data e seus filtros. As sugestões são planejamento, não tendências ao vivo.</p>
      <Card className="mt-5">
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
          A extensão aplica estes termos ao texto visível dos cards que o hub de afiliados já descobriu na página. Ela não executa novas pesquisas globais no Mercado Livre. Por isso, os pacotes priorizam palavras curtas em modo ANY; frases entram apenas quando ajudam a evitar resultados ambíguos.
        </div>
        <div className="grid gap-4 lg:grid-cols-[220px_1fr_auto] lg:items-end">
          <div><Label>Data da campanha</Label><Input type="date" min={today()} value={planDate} onChange={(e) => setPlanDate(e.target.value)} /></div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-zinc-700">Públicos incluídos</legend>
            <div className="flex flex-wrap gap-2">
              {enabled.map((audience) => (
                <label key={audience.slug} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${selected.has(audience.slug) ? NICHE_STYLES[audience.slug].soft : 'border-zinc-200 bg-white text-zinc-500'}`}>
                  <input type="checkbox" className="sr-only" checked={selected.has(audience.slug)} onChange={() => { const next = new Set(selected); if (next.has(audience.slug)) next.delete(audience.slug); else next.add(audience.slug); setSelected(next) }} />
                  {NICHE_STYLES[audience.slug].emoji} {audience.name}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="button" onClick={() => submit()} disabled={mutation.isPending || !planDate || selected.size === 0 || aiBlocked}>
            {mutation.isPending ? <Spinner /> : <Sparkles size={16} />} Usar IA: gerar palavras-chave
          </Button>
        </div>
      </Card>
      <div className="mt-4">
        {mutation.isError && resultIsCurrent && <ErrorState message={apiErrorMessage(mutation.error)} retry={mutation.variables ? () => submit(mutation.variables) : undefined} />}
        {(!mutation.data || !resultIsCurrent) && !mutation.isPending && <EmptyState title="Escolha os públicos e a data">Clique em “Usar IA” para montar listas curtas para a seleção atual.</EmptyState>}
        {mutation.isPending && <Card className="flex items-center gap-3 text-sm text-zinc-600"><Spinner /> Preparando as sugestões para a data escolhida…</Card>}
        {mutation.data && resultIsCurrent && (
          <div className="grid gap-4 xl:grid-cols-2">{mutation.data.packs.map((pack) => <KeywordPackCard key={pack.audienceSlug} pack={pack} date={mutation.data.date} />)}</div>
        )}
      </div>
    </section>
  )
}

function inferFileAudience(name: string, selected: Set<SmartAudienceSlug>, audiences: SmartAudience[]): SmartAudienceSlug | undefined {
  if (selected.size === 1) return [...selected][0]
  const normalizedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
  const matches = audiences.filter((audience) => {
    if (!selected.has(audience.slug)) return false
    const labels = [audience.slug, audience.name].map((value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'))
    return labels.some((label) => label.length > 3 && normalizedName.includes(label)) || new RegExp(`(^|[^a-z])${audience.slug.toLocaleLowerCase()}([^a-z]|$)`).test(normalizedName)
  })
  return matches.length === 1 ? matches[0].slug : undefined
}

function countFileOffers(value: unknown): number | null {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['offers', 'products', 'items', 'produtos', 'ofertas', 'data', 'cards']) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).length
  }
  return null
}

function ImportPlanner({ audiences, selected, planDate, onCreated, aiStatus, aiBlocked }: { audiences: SmartAudience[]; selected: Set<SmartAudienceSlug>; planDate: string; onCreated: (plan: SmartPlan) => void; aiStatus?: SmartAIStatus; aiBlocked: boolean }) {
  const queryClient = useQueryClient()
  const [rawJson, setRawJson] = useState('')
  const [days, setDays] = useState(1)
  const [filePayloads, setFilePayloads] = useState<SmartImportPayload[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const submitting = useRef(false)
  const mutation = useMutation({
    mutationFn: smartCampaignApi.createPlan,
    retry: false,
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['smart-plans'] })
      onCreated(plan)
    },
    onSettled: () => { submitting.current = false },
  })

  const submit = (retryInput?: SmartCreatePlanInput) => {
    if (submitting.current || mutation.isPending || aiBlocked) return
    submitting.current = true
    mutation.mutate(retryInput ?? (filePayloads.length
      ? { requestId: createSmartAIRequestId(), date: planDate, days, audienceSlugs: [...selected], payloads: filePayloads }
      : { requestId: createSmartAIRequestId(), date: planDate, days, audienceSlugs: [...selected], rawJson }))
  }

  const loadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    if (files.length === 0) return
    setFileError(null)
    setFilePayloads([])
    setRawJson('')
    try {
      if (files.length > 50) throw new Error('files')
      if (files.some((file) => file.name.length > 255)) throw new Error('name')
      if (files.reduce((total, file) => total + file.size, 0) > 30 * 1024 * 1024) throw new Error('size')
      const parsed = await Promise.all(files.map(async (file) => JSON.parse(await file.text()) as unknown))
      const payloads = parsed.map((json, index) => ({
        name: files[index].name,
        json,
        targetAudienceSlug: inferFileAudience(files[index].name, selected, audiences),
      }))
      setFilePayloads(payloads)
    } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      setFileError(reason === 'files'
        ? 'Selecione no máximo 50 arquivos por análise.'
        : reason === 'size'
          ? 'Os arquivos juntos devem ter no máximo 30 MB.'
          : reason === 'name'
            ? 'Um nome de arquivo é longo demais.'
            : 'Um dos arquivos não contém JSON válido. Revise o arquivo exportado pela extensão.')
    } finally {
      event.target.value = ''
    }
  }

  const deferredRawJson = useDeferredValue(rawJson)
  const parsedJson = useMemo(() => {
    if (!deferredRawJson) return { valid: false, count: null as number | null }
    try {
      const parsed = JSON.parse(deferredRawJson) as unknown
      const count = Array.isArray(parsed) ? parsed.length : parsed && typeof parsed === 'object' && 'offers' in parsed && Array.isArray((parsed as { offers: unknown[] }).offers) ? (parsed as { offers: unknown[] }).offers.length : null
      return { valid: true, count }
    } catch { return { valid: false, count: null as number | null } }
  }, [deferredRawJson])
  const jsonCheckPending = deferredRawJson !== rawJson
  const jsonValid = !jsonCheckPending && parsedJson.valid
  const parsedCount = parsedJson.count

  return (
    <section aria-labelledby="import-title">
      <h2 id="import-title" className="text-xl font-bold">Importar arquivos e montar proposta</h2>
      <p className="mt-1 text-sm text-zinc-500">A IA classifica os produtos e prepara uma agenda para revisão. Esta etapa não aprova o plano e não envia mensagens.</p>
      <Card className="mt-4 border-blue-200 bg-blue-50">
        <h3 className="font-semibold text-blue-950">Importação inteligente</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-blue-900">
          <li><strong>Recomendado para menor custo e melhor precisão:</strong> gere um preset por público, rode uma coleta separada na extensão e selecione o grupo daquela coleta.</li>
          <li>Você também pode carregar arquivos genéricos ou uma coleta mista. Deixe “Classificar entre todos”; regras locais pré-selecionam nichos prováveis e a IA decide os casos ambíguos.</li>
          <li>Não confie no nome do arquivo para definir o nicho: confirme o grupo abaixo. Produto com sinal claro de outro nicho pode ser redirecionado pela triagem, enquanto itens ambíguos são avaliados em todos os grupos selecionados.</li>
          <li>Defina a data inicial e quantos dias usar. A proposta começa às 09h, respeita o limite diário e usa intervalos de 12–16 minutos.</li>
        </ol>
        <p className="mt-2 text-xs text-blue-800">Revise, mova, reserve ou rejeite produtos na etapa seguinte. Os envios só são ativados quando você confirma “Agendar campanha”.</p>
      </Card>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><Label>JSON da extensão</Label><p className="text-xs text-zinc-500">Confira o público de cada arquivo antes de analisar.</p></div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-200">
              <Upload size={16} /> Carregar ou substituir arquivo(s)
              <input className="sr-only" type="file" accept="application/json,.json" multiple onChange={loadFiles} />
            </label>
          </div>
          {filePayloads.length > 0 && <div className="mt-4 space-y-3">
            {filePayloads.map((file, index) => {
              const target = file.targetAudienceSlug
              const targetName = audiences.find((audience) => audience.slug === target)?.name ?? target
              const count = countFileOffers(file.json)
              return <div key={`${file.name}-${index}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-800">{file.name}</p><p className="text-xs text-zinc-500">{count === null ? 'Formato detectado pelo servidor' : `${count} produto(s) no arquivo`}</p></div>
                  <label className="shrink-0 text-xs font-medium text-zinc-600">Analisar para
                    <select className="ml-2 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800" value={target ?? 'ALL'} onChange={(event) => {
                      const value = event.target.value as SmartAudienceSlug | 'ALL'
                      setFilePayloads((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, targetAudienceSlug: value === 'ALL' ? undefined : value } : item))
                    }}>
                      <option value="ALL">Classificar entre todos</option>
                      {audiences.filter((audience) => selected.has(audience.slug)).map((audience) => <option key={audience.slug} value={audience.slug}>{audience.name}</option>)}
                    </select>
                  </label>
                </div>
                {target ? <p className="mt-2 text-xs text-green-700">Grupo de origem: {targetName}. A pré-triagem ainda pode incluir outro nicho se houver evidência clara no produto.</p> : <p className="mt-2 text-xs text-amber-700">Coleta genérica: regras locais limitam nichos óbvios; casos ambíguos vão para todos os públicos selecionados.</p>}
              </div>
            })}
            <Button type="button" variant="secondary" onClick={() => { setFilePayloads([]); setRawJson(''); setFileError(null) }}>Remover arquivos e colar JSON manualmente</Button>
          </div>}
          {filePayloads.length === 0 && <textarea
            className="mt-3 min-h-80 w-full rounded-xl border border-zinc-300 bg-zinc-950 p-4 font-mono text-xs text-zinc-100 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
            value={rawJson}
            onChange={(e) => { setRawJson(e.target.value); setFilePayloads([]) }}
            placeholder='Cole aqui o JSON exportado pela extensão…'
            spellCheck={false}
            aria-label="JSON exportado pela extensão"
          />}
          {fileError && <p className="mt-2 text-sm text-red-700">{fileError}</p>}
          {rawJson && jsonCheckPending && <p className="mt-2 text-xs text-zinc-500">Validando JSON…</p>}
          {rawJson && jsonValid && <p className="mt-2 text-xs text-green-700">JSON válido{parsedCount ? ` · ${parsedCount} registro(s) no nível principal` : ''}</p>}
          {rawJson && !jsonCheckPending && !jsonValid && <p className="mt-2 text-xs text-red-700">O conteúdo ainda não é um JSON válido.</p>}
        </Card>
        <div className="space-y-4">
          <Card>
            <h3 className="font-semibold">Proposta de agenda</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Início</dt><dd className="font-medium">{formatDate(planDate)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Públicos</dt><dd className="font-medium">{selected.size}</dd></div>
            </dl>
            <div className="mt-4"><Label>Dias para distribuir</Label><select className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={1}>1 dia</option><option value={2}>2 dias</option><option value={3}>3 dias</option></select></div>
            <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50 p-3 text-xs leading-relaxed text-violet-800">A IA considera encaixe no público, comissão, desconto comprovado, sazonalidade, frescor e variedade. Ela avalia até {aiStatus?.limits.batchSize ?? 'o limite configurado de'} produtos por lote. Ao concluir, você verá a proposta em <strong>Revisar agenda</strong>; nada é enviado até a aprovação explícita.</div>
            <Button className="mt-4 w-full" type="button" disabled={mutation.isPending || !(filePayloads.length > 0 || (rawJson.trim() && jsonValid)) || selected.size === 0 || (filePayloads.length === 0 && !jsonValid) || aiBlocked} onClick={() => submit()}>
              {mutation.isPending ? <Spinner /> : <BrainCircuit size={17} />} Analisar e montar proposta
            </Button>
          </Card>
          {mutation.isError && <ErrorState message={apiErrorMessage(mutation.error)} retry={mutation.variables ? () => submit(mutation.variables) : undefined} />}
        </div>
      </div>
    </section>
  )
}

function ItemStateSelect({ item, onChange, disabled }: { item: SmartPlanItem; onChange: (state: SmartPlanItemState) => void; disabled: boolean }) {
  return (
    <select aria-label={`Situação de ${item.product.title}`} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium" value={item.state} onChange={(e) => onChange(e.target.value as SmartPlanItemState)} disabled={disabled}>
      <option value="SELECTED">Selecionado</option><option value="RESERVE">Reserva</option><option value="REJECTED">Rejeitado</option>
    </select>
  )
}

function PlanItemCard({ item, editable, saving, onPatch }: { item: SmartPlanItem; editable: boolean; saving: boolean; onPatch: (patch: Partial<SmartPlanItem>) => void }) {
  const [editingMessage, setEditingMessage] = useState(false)
  const [message, setMessage] = useState(item.customMessage ?? '')
  const discount = item.product.originalPrice && item.product.originalPrice > item.product.discountedPrice
    ? Math.round((1 - item.product.discountedPrice / item.product.originalPrice) * 100) : undefined

  return (
    <Card className={`${item.state === 'SELECTED' ? 'border-violet-200' : item.state === 'REJECTED' ? 'opacity-75' : ''}`}>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
          {item.product.imageUrl ? <img className="h-full w-full object-cover" src={item.product.imageUrl} alt="" loading="lazy" /> : <div className="flex h-full items-center justify-center text-2xl">🛍️</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-zinc-900">{item.product.title}</h4>
                {item.standout && <Badge tone="violet">Destaque</Badge>}
                {item.category && <Badge>{item.category}</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2 text-sm">
                <strong className="text-lg text-zinc-900">{formatMoney(item.product.discountedPrice)}</strong>
                {item.product.originalPrice && <span className="text-xs text-zinc-400 line-through">{formatMoney(item.product.originalPrice)}</span>}
                {discount !== undefined && <span className="text-xs font-semibold text-green-700">-{discount}%</span>}
                {item.estimatedCommission !== undefined && <span className="text-xs text-zinc-500">Comissão est. {formatMoney(item.estimatedCommission)}</span>}
              </div>
            </div>
            <ItemStateSelect item={item} disabled={!editable || saving} onChange={(state) => onPatch({ state })} />
          </div>
          <p className="mt-2 text-sm text-zinc-600">{item.reason || 'Sem justificativa informada.'}</p>
          {item.rejectionReasons && item.rejectionReasons.length > 0 && <p className="mt-1 text-xs text-red-700">{item.rejectionReasons.join(' · ')}</p>}
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <span className="rounded-lg bg-zinc-50 px-2.5 py-2"><strong>Nota</strong> {score(item.score)}</span>
            <span className="rounded-lg bg-zinc-50 px-2.5 py-2"><strong>Encaixe</strong> {score(item.fitScore)}</span>
            <span className="rounded-lg bg-zinc-50 px-2.5 py-2"><strong>Comissão</strong> {item.product.commissionRate !== undefined ? `${item.product.commissionRate}%` : 'desconhecida'}</span>
            <span className="rounded-lg bg-zinc-50 px-2.5 py-2"><strong>Frescor</strong> {item.freshnessHours !== undefined ? `${Math.round(item.freshnessHours)}h` : 'desconhecido'}</span>
          </div>
          {item.warnings && item.warnings.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{item.warnings.join(' · ')}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Clock3 size={14} /> {item.scheduledAt ? formatDateTime(item.scheduledAt) : item.state === 'SELECTED' ? 'Horário será calculado na aprovação' : 'Sem horário'}
            {editable && item.state === 'SELECTED' && <label className="ml-auto flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="accent-violet-600" checked={Boolean(item.standout)} onChange={(e) => onPatch({ standout: e.target.checked })} disabled={saving} /> Mensagem especial</label>}
          </div>
          {(item.standout || item.customMessage) && (
            <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-violet-800">Introdução especial</span>{editable && <button type="button" className="text-xs text-violet-700 underline" onClick={() => setEditingMessage((v) => !v)}>{editingMessage ? 'Fechar' : 'Editar'}</button>}</div>
              {editingMessage ? <div className="mt-2"><textarea className="min-h-20 w-full rounded-lg border border-violet-200 bg-white p-2 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} /><Button className="mt-2" type="button" disabled={saving} onClick={() => { onPatch({ customMessage: message }); setEditingMessage(false) }}><Save size={14} /> Salvar texto</Button></div> : <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{item.customMessage || 'A inteligência não sugeriu uma introdução especial.'}</p>}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

const RESOLUTION_COPY: Record<SmartSendResolution, { title: string; description: string; confirm: string }> = {
  sent: {
    title: 'Confirmar que foi enviado',
    description: 'Use somente se a oferta aparece no grupo. Ela será registrada como enviada e não será repetida automaticamente.',
    confirm: 'Sim, registrar como enviado',
  },
  retry: {
    title: 'Tentar enviar novamente',
    description: 'Use somente se a oferta não aparece no grupo. Uma nova tentativa será agendada com o intervalo de segurança; escolher errado pode duplicar a mensagem.',
    confirm: 'Não apareceu, reagendar',
  },
  skip: {
    title: 'Não tentar novamente',
    description: 'A oferta será encerrada sem nova tentativa e continuará bloqueada contra reenvio automático por segurança.',
    confirm: 'Encerrar sem reenviar',
  },
}

function UnknownSendResolution({ planId, sends }: { planId: string; sends: SmartPlanSend[] }) {
  const queryClient = useQueryClient()
  const [decision, setDecision] = useState<{ send: SmartPlanSend; resolution: SmartSendResolution } | null>(null)
  const [checked, setChecked] = useState(false)
  const mutation = useMutation({
    mutationFn: ({ send, resolution }: { send: SmartPlanSend; resolution: SmartSendResolution }) => smartCampaignApi.resolveSend(send.id, resolution),
    onSuccess: async () => {
      setDecision(null)
      setChecked(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['smart-plan', planId] }),
        queryClient.invalidateQueries({ queryKey: ['smart-plans'] }),
      ])
    },
  })
  const choose = (send: SmartPlanSend, resolution: SmartSendResolution) => {
    mutation.reset()
    setChecked(false)
    setDecision({ send, resolution })
  }
  return (
    <Card className="mt-4 border-red-300 bg-red-50" >
      <div role="alert" className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 shrink-0 text-red-700" size={22} />
        <div>
          <h3 className="font-bold text-red-900">Ação necessária: resultado do envio desconhecido</h3>
          <p className="mt-1 text-sm leading-relaxed text-red-800">O plano foi pausado automaticamente para evitar duplicatas. Aguarde pelo menos cinco minutos após a tentativa e confira diretamente no grupo do WhatsApp antes de decidir.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {sends.map((send) => (
          <div key={send.id} className="rounded-xl border border-red-200 bg-white p-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2"><strong>{send.offerTitle || 'Oferta sem título'}</strong><Badge tone="red">A confirmar</Badge><Badge>{send.audienceSlug}</Badge></div>
                <p className="mt-1 text-sm text-zinc-700">Grupo: {send.groupName}</p>
                <p className="mt-1 text-xs text-zinc-500">Tentativa prevista para {formatDateTime(send.scheduledAt)} · {send.attempts} tentativa(s)</p>
                {send.lastError && <p className="mt-1 text-xs text-red-700">{send.lastError}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => choose(send, 'sent')} disabled={mutation.isPending}><Check size={15} /> Apareceu no grupo</Button>
                <Button type="button" variant="secondary" onClick={() => choose(send, 'retry')} disabled={mutation.isPending}><RotateCcw size={15} /> Não apareceu: reenviar</Button>
                <Button type="button" variant="ghost" onClick={() => choose(send, 'skip')} disabled={mutation.isPending}>Não reenviar</Button>
              </div>
            </div>
            {decision?.send.id === send.id && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <h4 className="font-semibold text-amber-950">{RESOLUTION_COPY[decision.resolution].title}</h4>
                <p className="mt-1 text-sm text-amber-900">{RESOLUTION_COPY[decision.resolution].description}</p>
                {decision.send.resolutionAvailableAt && (
                  <p className="mt-2 text-xs font-medium text-amber-900">Decisão liberada pelo servidor em {formatDateTime(decision.send.resolutionAvailableAt)}.</p>
                )}
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-zinc-800">
                  <input className="mt-0.5 accent-violet-600" type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
                  Conferi este grupo diretamente no WhatsApp e entendo o efeito desta decisão.
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant={decision.resolution === 'retry' ? 'danger' : 'primary'} disabled={!checked || mutation.isPending} onClick={() => mutation.mutate(decision)}>
                    {mutation.isPending ? <Spinner /> : <Check size={15} />} {RESOLUTION_COPY[decision.resolution].confirm}
                  </Button>
                  <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => { setDecision(null); setChecked(false) }}>Voltar</Button>
                </div>
                {mutation.isError && <p role="alert" className="mt-2 text-xs text-red-700">{apiErrorMessage(mutation.error)}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function PlanReview({ plan, onPlanChange }: { plan: SmartPlan; onPlanChange: (plan: SmartPlan) => void }) {
  const queryClient = useQueryClient()
  const [audience, setAudience] = useState<SmartAudienceSlug | 'ALL'>('ALL')
  const [date, setDate] = useState('ALL')
  const [state, setState] = useState<SmartPlanItemState>('SELECTED')
  const mutation = useMutation({
    mutationFn: ({ item, patch }: { item: SmartPlanItem; patch: Partial<SmartPlanItem> }) => smartCampaignApi.updatePlan(plan.id, plan.revision, [{
      id: item.id, state: patch.state, standout: patch.standout, customMessage: patch.customMessage, audienceSlug: patch.audienceSlug, date: patch.date, scheduledAt: patch.scheduledAt,
    }]),
    onSuccess: (updated) => { onPlanChange(updated); queryClient.invalidateQueries({ queryKey: ['smart-plans'] }) },
  })
  const dates = [...new Set(plan.items.map((item) => item.date).filter(Boolean))].sort()
  const counts = useMemo(() => plan.items.reduce((acc, item) => { acc[item.state]++; return acc }, { SELECTED: 0, RESERVE: 0, REJECTED: 0 }), [plan.items])
  const visible = plan.items.filter((item) => (audience === 'ALL' || item.audienceSlug === audience) && (date === 'ALL' || item.date === date) && item.state === state)
  const editable = plan.status === 'REVIEW' || plan.status === 'READY' || plan.status === 'DRAFT'
  const analysisFailure = isAnalysisFailure(plan)

  if (plan.status === 'ANALYZING') {
    const percent = plan.progress?.total ? Math.round((plan.progress.completed / plan.progress.total) * 100) : null
    return <Card className="py-12 text-center"><LoaderCircle className="mx-auto animate-spin text-violet-600" size={36} /><h2 className="mt-4 text-lg font-bold">Análise em andamento</h2><p className="mt-1 text-sm text-zinc-500">{plan.progress?.message || 'O servidor está avaliando os produtos e montando as agendas.'}</p>{percent !== null && <div className="mx-auto mt-4 max-w-sm"><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-violet-600 transition-all" style={{ width: `${percent}%` }} /></div><p className="mt-1 text-xs text-zinc-500">{plan.progress?.completed} de {plan.progress?.total} · {percent}%</p></div>}</Card>
  }

  if (analysisFailure) return <ErrorState message={plan.error || 'A análise dos produtos falhou. Você pode tentar esta análise novamente.'} />

  return (
    <section aria-labelledby="review-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div><h2 id="review-title" className="text-xl font-bold">Agenda proposta</h2><p className="mt-1 text-sm text-zinc-500">Plano de {formatDate(plan.startDate)} · versão {plan.revision}</p></div>
        <Badge tone={statusTone(plan.status)}>{planStatusLabel(plan.status)}</Badge>
      </div>
      {plan.warnings && plan.warnings.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{plan.warnings.join(' · ')}</div>}
      {plan.sendSummary && (
        <Card className="mt-4">
          <div className="flex items-center gap-2"><Send size={17} className="text-violet-600" /><h3 className="font-semibold">Execução dos envios</h3></div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[['PENDING', 'Pendentes'], ['SENDING', 'Enviando'], ['SENT', 'Enviados'], ['SKIPPED', 'Ignorados'], ['FAILED', 'Falhas'], ['UNKNOWN', 'A confirmar']].map(([key, label]) => (
              <div key={key} className="rounded-lg bg-zinc-50 p-2 text-center"><strong className="block text-lg">{plan.sendSummary?.[key] ?? 0}</strong><span className="text-[11px] text-zinc-500">{label}</span></div>
            ))}
          </div>
          {plan.sends?.some((send) => send.lastError) && <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3">{plan.sends.filter((send) => send.lastError).slice(0, 5).map((send) => <p key={send.id} className="text-xs text-red-700"><strong>{send.groupName}</strong> · {formatDateTime(send.scheduledAt)} · {send.lastError}</p>)}</div>}
        </Card>
      )}
      {plan.sends?.some((send) => send.status === 'UNKNOWN') && (
        <UnknownSendResolution planId={plan.id} sends={plan.sends.filter((send) => send.status === 'UNKNOWN')} />
      )}
      <div className="mt-5 grid grid-cols-3 gap-2">
        {(['SELECTED', 'RESERVE', 'REJECTED'] as const).map((value) => <button type="button" key={value} onClick={() => setState(value)} className={`rounded-xl border p-3 text-left transition ${state === value ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-100' : 'border-zinc-200 bg-white hover:border-violet-200'}`}><div className="text-2xl font-bold">{counts[value]}</div><div className="text-xs text-zinc-500">{value === 'SELECTED' ? 'Selecionados' : value === 'RESERVE' ? 'Na reserva' : 'Rejeitados'}</div></button>)}
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 sm:flex-row">
        <div className="min-w-0 flex-1"><Label>Público</Label><select className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" value={audience} onChange={(e) => setAudience(e.target.value as SmartAudienceSlug | 'ALL')}><option value="ALL">Todos os públicos</option>{plan.audienceSlugs.map((slug) => <option key={slug} value={slug}>{slug}</option>)}</select></div>
        <div className="min-w-0 flex-1"><Label>Dia</Label><select className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)}><option value="ALL">Todos os dias</option>{dates.map((value) => <option key={value} value={value}>{formatDate(value)}</option>)}</select></div>
      </div>
      {mutation.isError && <div className="mt-4"><ErrorState message={apiErrorMessage(mutation.error)} /></div>}
      <div className="mt-4 space-y-3">
        {visible.length === 0 ? <EmptyState title="Nada neste filtro">Escolha outro público, dia ou situação para revisar os produtos.</EmptyState> : visible.map((item) => <PlanItemCard key={item.id} item={item} editable={editable} saving={mutation.isPending} onPatch={(patch) => mutation.mutate({ item, patch })} />)}
      </div>
    </section>
  )
}

function PlanActions({ plan, audiences, onPlanChange, onCreateFresh, aiBlocked }: { plan: SmartPlan; audiences: SmartAudience[]; onPlanChange: (plan: SmartPlan) => void; onCreateFresh: () => void; aiBlocked: boolean }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<'approve' | 'cancel' | null>(null)
  const submitting = useRef(false)
  const hasUnknownSend = plan.sends?.some((send) => send.status === 'UNKNOWN') ?? false
  const hasFailedSend = plan.sends?.some((send) => send.status === 'FAILED') ?? false
  const analysisFailure = isAnalysisFailure(plan)
  type PlanAction = 'approve' | 'pause' | 'resume' | 'cancel' | 'retry'
  type PlanActionRequest = { action: PlanAction; requestId?: string }
  const mutation = useMutation({
    mutationFn: ({ action, requestId }: PlanActionRequest) => smartCampaignApi.action(plan.id, action, plan.revision, requestId),
    retry: false,
    onSuccess: (updated) => { setConfirming(null); onPlanChange(updated); queryClient.invalidateQueries({ queryKey: ['smart-plans'] }) },
    onSettled: () => { submitting.current = false },
  })
  const action = (name: PlanAction, input?: PlanActionRequest) => {
    if (submitting.current || mutation.isPending || (name === 'retry' && aiBlocked)) return
    submitting.current = true
    mutation.mutate(input ?? { action: name, requestId: name === 'retry' ? createSmartAIRequestId() : undefined })
  }
  const selectedCount = plan.items.filter((item) => item.state === 'SELECTED').length
  const destinationNames = [...new Set(audiences
    .filter((audience) => plan.audienceSlugs.includes(audience.slug))
    .flatMap((audience) => audience.destinations.length
      ? audience.destinations.map((destination) => destination.groupName)
      : audience.destinationGroupIds))]
  return (
    <Card className="sticky bottom-4 z-10 mt-5 border-violet-200 shadow-lg">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><p className="font-semibold">{planStatusLabel(plan.status)}</p><p className="text-xs text-zinc-500">{plan.status === 'FAILED' && !analysisFailure ? 'O histórico desta execução foi preservado. Use uma coleta atualizada para montar um novo plano.' : 'A aprovação reserva os horários e inicia a execução na janela configurada.'}</p></div>
        <div className="flex flex-wrap gap-2">
          {(plan.status === 'REVIEW' || plan.status === 'READY' || plan.status === 'DRAFT') && <Button onClick={() => setConfirming('approve')} disabled={mutation.isPending}><Send size={16} /> Revisar aprovação</Button>}
          {(plan.status === 'APPROVED' || plan.status === 'SCHEDULED' || plan.status === 'RUNNING') && <Button variant="secondary" onClick={() => action('pause')} disabled={mutation.isPending}><Pause size={16} /> Pausar</Button>}
          {plan.status === 'PAUSED' && !hasFailedSend && <Button onClick={() => action('resume')} disabled={mutation.isPending || hasUnknownSend}><Play size={16} /> {hasUnknownSend ? 'Resolva os envios incertos' : 'Retomar'}</Button>}
          {analysisFailure && <Button onClick={() => action('retry')} disabled={mutation.isPending || aiBlocked}><RotateCcw size={16} /> Usar IA: repetir análise</Button>}
          {((plan.status === 'FAILED' && !analysisFailure) || hasFailedSend) && <Button variant="secondary" onClick={onCreateFresh}><FileJson size={16} /> Criar plano com coleta atualizada</Button>}
          {!['COMPLETED', 'CANCELLED', 'FAILED'].includes(plan.status) && <Button variant="danger" onClick={() => setConfirming('cancel')} disabled={mutation.isPending}><Square size={15} /> Revisar cancelamento</Button>}
        </div>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label={confirming === 'approve' ? 'Confirmar aprovação' : 'Confirmar cancelamento'} className={`mt-4 rounded-xl border p-4 ${confirming === 'approve' ? 'border-violet-200 bg-violet-50' : 'border-red-200 bg-red-50'}`}>
          <p className="font-semibold">{confirming === 'approve' ? 'Confirmar agenda e envios' : 'Confirmar cancelamento do plano'}</p>
          <p className="mt-1 text-sm text-zinc-700">{selectedCount} produto(s) · {plan.audienceSlugs.length} público(s) ({plan.audienceSlugs.join(', ')}) · início em {formatDate(plan.startDate)}.</p>
          {confirming === 'approve' && <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">Esta confirmação ativa os envios agendados para os grupos listados. Até você confirmar aqui, nenhuma campanha será iniciada.</p>}
          <p className="mt-1 text-sm text-zinc-700">{destinationNames.length} grupo(s): {destinationNames.join(', ') || 'nenhum grupo vinculado'}</p>
          <div className="mt-3 flex gap-2"><Button type="button" variant="secondary" onClick={() => setConfirming(null)} disabled={mutation.isPending}>Voltar</Button><Button type="button" variant={confirming === 'cancel' ? 'danger' : 'primary'} onClick={() => action(confirming)} disabled={mutation.isPending}>{confirming === 'approve' ? 'Confirmar e agendar' : 'Confirmar cancelamento'}</Button></div>
        </div>
      )}
      {mutation.isError && mutation.variables?.action === 'retry'
        ? <div className="mt-3"><ErrorState message={apiErrorMessage(mutation.error)} retry={() => action('retry', mutation.variables)} /></div>
        : mutation.isError && <p className="mt-3 text-xs text-red-700">{apiErrorMessage(mutation.error)}</p>}
    </Card>
  )
}

function PlanHistory({ plans, selectedId, onSelect }: { plans: SmartPlan[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (plans.length === 0) return <EmptyState title="Nenhum plano criado">Depois da primeira importação, análises e campanhas agendadas aparecerão aqui.</EmptyState>
  return (
    <div className="space-y-3">
      {plans.map((plan) => (
        <button type="button" key={plan.id} onClick={() => onSelect(plan.id)} className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-violet-300 ${selectedId === plan.id ? 'border-violet-400 ring-2 ring-violet-100' : 'border-zinc-200'}`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="flex flex-wrap items-center gap-2"><strong>Plano de {formatDate(plan.startDate)}</strong><Badge tone={statusTone(plan.status)}>{planStatusLabel(plan.status)}</Badge></div><p className="mt-1 text-xs text-zinc-500">{plan.days} dia(s) · {plan.audienceSlugs.join(', ')} · atualizado {formatDateTime(plan.updatedAt)}</p></div>
            <ChevronRight className="shrink-0 text-zinc-400" size={18} />
          </div>
          {plan.progress?.total ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-violet-600" style={{ width: `${Math.min(100, (plan.progress.completed / plan.progress.total) * 100)}%` }} /></div> : null}
        </button>
      ))}
    </div>
  )
}

export default function SmartCampaignsPage() {
  const [stage, setStage] = useState<Stage>('audiences')
  const [planDate, setPlanDate] = useState(today())
  const [selectedAudiences, setSelectedAudiences] = useState<Set<SmartAudienceSlug>>(new Set())
  const [selectionInitialized, setSelectionInitialized] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const aiStatusQuery = useQuery({ queryKey: ['smart-ai-status'], queryFn: smartCampaignApi.aiStatus, retry: false, staleTime: 60_000 })
  const audiencesQuery = useQuery({ queryKey: ['smart-audiences'], queryFn: smartCampaignApi.audiences })
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => groupApi.list() })
  const plansQuery = useQuery({
    queryKey: ['smart-plans'],
    queryFn: smartCampaignApi.plans,
    refetchInterval: (query) => {
      const statuses = query.state.data?.map((plan) => plan.status) ?? []
      if (statuses.includes('ANALYZING')) return planPollInterval('ANALYZING')
      if (statuses.includes('RUNNING')) return planPollInterval('RUNNING')
      return statuses.some((status) => status === 'APPROVED' || status === 'SCHEDULED') ? planPollInterval('SCHEDULED') : false
    },
  })
  const detailQuery = useQuery({
    queryKey: ['smart-plan', selectedPlanId],
    queryFn: () => smartCampaignApi.plan(selectedPlanId as string),
    enabled: Boolean(selectedPlanId),
    refetchInterval: (query) => planPollInterval(query.state.data?.status),
  })

  const defaultAudienceSelection = useMemo(
    () => new Set((audiencesQuery.data ?? []).filter((audience) => audience.enabled).map((audience) => audience.slug)),
    [audiencesQuery.data],
  )
  const workflowSelection = selectionInitialized ? selectedAudiences : defaultAudienceSelection
  const selectAudiences = (next: Set<SmartAudienceSlug>) => {
    setSelectedAudiences(next)
    setSelectionInitialized(true)
  }

  const activePlan = detailQuery.data
  const aiBlocked = aiStatusQuery.isLoading || aiUnavailable(aiStatusQuery.data)
  const handlePlan = (plan: SmartPlan) => {
    setSelectedPlanId(plan.id)
    queryClient.setQueryData(['smart-plan', plan.id], plan)
  }
  const onCreated = (plan: SmartPlan) => { handlePlan(plan); setStage('review') }

  if (audiencesQuery.isLoading || groupsQuery.isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <header className="mb-6 rounded-3xl bg-gradient-to-br from-violet-700 via-violet-600 to-fuchsia-600 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium"><BrainCircuit size={14} /> Planejamento com inteligência de produto</div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Campanhas inteligentes</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-violet-100 sm:text-base">Encontre as melhores ofertas para cada público, distribua até 50 produtos por dia e acompanhe cada agenda em um único fluxo.</p></div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-white/10 p-3"><strong className="block text-lg">09h</strong>início padrão</div><div className="rounded-xl bg-white/10 p-3"><strong className="block text-lg">12–16</strong>minutos</div><div className="rounded-xl bg-white/10 p-3"><strong className="block text-lg">50</strong>máximo/dia</div></div>
        </div>
      </header>

      <AIStatusBanner status={aiStatusQuery.data} error={aiStatusQuery.error} />

      <nav aria-label="Etapas da campanha" className="mb-6 overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
        <div className="flex min-w-max gap-1">
          {STAGES.map(({ id, label, icon: Icon }, index) => <button type="button" key={id} onClick={() => setStage(id)} aria-current={stage === id ? 'step' : undefined} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition sm:px-4 ${stage === id ? 'bg-violet-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${stage === id ? 'bg-white/20' : 'bg-zinc-100'}`}>{index + 1}</span><Icon size={16} />{label}</button>)}
        </div>
      </nav>

      {audiencesQuery.isError && <ErrorState message={apiErrorMessage(audiencesQuery.error)} retry={() => audiencesQuery.refetch()} />}
      {groupsQuery.isError && <div className="mb-4"><ErrorState message={`Não foi possível carregar os grupos: ${apiErrorMessage(groupsQuery.error)}`} retry={() => groupsQuery.refetch()} /></div>}

      {audiencesQuery.data && stage === 'audiences' && <AudienceSetup audiences={audiencesQuery.data} groups={groupsQuery.data ?? []} />}
      {audiencesQuery.data && stage === 'keywords' && <KeywordPlanner audiences={audiencesQuery.data} selected={workflowSelection} setSelected={selectAudiences} planDate={planDate} setPlanDate={setPlanDate} aiBlocked={aiBlocked} />}
      {stage === 'import' && audiencesQuery.data && <ImportPlanner audiences={audiencesQuery.data} selected={workflowSelection} planDate={planDate} onCreated={onCreated} aiStatus={aiStatusQuery.data} aiBlocked={aiBlocked} />}
      {stage === 'review' && (
        <div>
          {!selectedPlanId && <EmptyState title="Escolha um plano">Abra um plano no acompanhamento ou crie uma análise a partir do JSON da extensão.</EmptyState>}
          {detailQuery.isLoading && <Card className="flex items-center gap-3"><Spinner /> Carregando plano…</Card>}
          {detailQuery.isError && <ErrorState message={apiErrorMessage(detailQuery.error)} retry={() => detailQuery.refetch()} />}
          {activePlan && <><PlanReview plan={activePlan} onPlanChange={handlePlan} /><PlanActions plan={activePlan} audiences={audiencesQuery.data ?? []} onPlanChange={handlePlan} onCreateFresh={() => setStage('import')} aiBlocked={aiBlocked} /></>}
        </div>
      )}
      {stage === 'monitor' && (
        <section aria-labelledby="history-title">
          <div className="mb-5 flex items-end justify-between gap-3"><div><h2 id="history-title" className="text-xl font-bold">Planos e envios</h2><p className="mt-1 text-sm text-zinc-500">Acompanhe análise, aprovação, pausas e execução.</p></div><Button type="button" variant="secondary" onClick={() => plansQuery.refetch()} disabled={plansQuery.isFetching}><RefreshCw className={plansQuery.isFetching ? 'animate-spin' : ''} size={15} /> Atualizar</Button></div>
          {plansQuery.isLoading && <Card className="flex items-center gap-3"><Spinner /> Carregando histórico…</Card>}
          {plansQuery.isError && <ErrorState message={apiErrorMessage(plansQuery.error)} retry={() => plansQuery.refetch()} />}
          {plansQuery.data && <PlanHistory plans={plansQuery.data} selectedId={selectedPlanId} onSelect={(id) => { setSelectedPlanId(id); setStage('review') }} />}
        </section>
      )}

      {stage !== 'monitor' && (
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => { const index = STAGES.findIndex((item) => item.id === stage); setStage(STAGES[Math.min(index + 1, STAGES.length - 1)].id) }} disabled={stage === 'review'}>Próxima etapa <ChevronRight size={16} /></Button>
        </div>
      )}
    </div>
  )
}

