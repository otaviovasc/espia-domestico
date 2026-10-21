import { buildSmartSearchPreset } from '@/lib/smartSearchPreset'
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  BrainCircuit,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  FileJson,
  Download,
  ExternalLink,
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
  Shuffle,
  Sparkles,
  Square,
  Upload,
  Users,
  House, Shirt, TreePine, Fish, PawPrint, Package, ArrowLeft,
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
import { ActionStatus } from '@/components/ActionStatus'
import { AnimatedSelection } from '@/components/AnimatedSelection'
import { BrandPattern } from '@/components/BrandPattern'
import { CampaignConfirmDialog } from '@/components/CampaignConfirmDialog'
import { GroupCombobox } from '@/components/GroupCombobox'
import { useDraftBaseline } from '@/hooks/useDraftBaseline'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { audienceInput, audienceValidation, validPlanDate, inferFileAudience, countFileOffers, optionalNumber, smartLocalDate, campaignTimingValidation, canAdvanceSmartPlan, nextSmartDelivery, smartCampaignStart, reservedSmartStart, planAudienceContext, safeAffiliateUrl, smartDeliveriesCsv, smartRecoveryReason } from '@/lib/smartCampaignUi'
import './smart-campaigns.css'
import { createSmartAIRequestId } from '@/lib/smartAiSafety'

type Stage = 'audiences' | 'keywords' | 'import' | 'review' | 'monitor'

const STAGES: { id: Stage; label: string; icon: typeof Users }[] = [
  { id: 'audiences', label: 'Públicos', icon: Users },
  { id: 'keywords', label: 'Palavras-chave', icon: Sparkles },
  { id: 'import', label: 'Importar e analisar', icon: FileJson },
  { id: 'review', label: 'Revisar agenda', icon: PackageCheck },
  { id: 'monitor', label: 'Acompanhar', icon: History },
]

const NICHE_STYLES: Record<SmartAudienceSlug, { icon: typeof Users; label: string; color: string; soft: string }> = {
  DOMESTICA: { icon: House, label: 'Casa e autocuidado', color: 'text-accent', soft: 'border-accent/30 bg-accent-soft' },
  MASCULINO: { icon: Shirt, label: 'Masculino', color: 'text-info', soft: 'border-info/30 bg-info-soft' },
  NATAL: { icon: TreePine, label: 'Natal', color: 'text-success', soft: 'border-success/30 bg-success-soft' },
  PESCA: { icon: Fish, label: 'Pesca', color: 'text-info', soft: 'border-info/30 bg-info-soft' },
  PET: { icon: PawPrint, label: 'Pets', color: 'text-warning', soft: 'border-warning/30 bg-warning-soft' },
}
function audienceLabel(audience: Pick<SmartAudience, 'name' | 'slug'>) {
  return !audience.name || audience.name.toUpperCase() === audience.slug ? NICHE_STYLES[audience.slug].label : audience.name
}
type DirtyChange = (key: string, dirty: boolean) => void
function NicheIcon({ slug, size = 20 }: { slug: SmartAudienceSlug; size?: number }) {
  const Icon = NICHE_STYLES[slug].icon
  return <Icon size={size} aria-hidden="true" className="shrink-0" />
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
  return smartLocalDate()
}

function formatDate(value: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function addLocalDays(value: string, days: number): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function formatDateTime(value?: string | null, timeZone?: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(value))
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
    <Card className="border-danger/30 bg-danger-soft">
      <div className="flex flex-col gap-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
        <div role="alert" className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{message}</span></div>
        {retry && <Button type="button" variant="secondary" onClick={retry}><RefreshCw size={15} /> Tentar novamente</Button>}
      </div>
    </Card>
  )
}

function EmptyState({ title, children }: { title: string; children: string }) {
  return (
    <Card className="border-dashed py-10 text-center">
      <BrainCircuit className="mx-auto mb-3 text-subtle" size={32} />
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted">{children}</p>
    </Card>
  )
}

function AIStatusBanner({ status, error }: { status?: SmartAIStatus; error?: unknown }) {
  if (error) {
    return <div role="status" className="mb-5 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">Não foi possível conferir o orçamento da IA. Nenhuma análise foi iniciada. Os botões continuam disponíveis e o servidor ainda aplicará os limites configurados.</div>
  }
  if (!status) return <div className="mb-5 h-12 animate-pulse rounded-xl bg-surface-muted" aria-label="Carregando configuração da IA" />
  if (aiUnavailable(status)) {
    return <div role="alert" className="mb-5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger"><strong>IA indisponível.</strong> {status.enabled ? 'Configure a chave do provedor no servidor para liberar análises.' : 'As análises estão desativadas no servidor.'} Consultar e revisar planos não gera custo.</div>
  }
  return (
    <div className="mb-5 flex flex-col justify-between gap-2 rounded-xl border border-success/30 bg-success-soft p-3 text-sm text-success sm:flex-row sm:items-center">
      <span><strong>IA sob demanda:</strong> nenhuma chamada ocorre ao abrir, navegar, atualizar ou revisar esta página.</span>
      <span className="text-xs">{status.model || 'Modelo configurado'} · máx. {formatUsd(status.limits.requestCostUsd)}/ação · {status.limits.dailyRequests}/dia · orçamento {formatUsd(status.limits.dailyCostUsd)}/dia</span>
    </div>
  )
}

function AudienceCard({ audience, groups, onDirtyChange }: { audience: SmartAudience; groups: Group[]; onDirtyChange: DirtyChange }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(audience)
  const [keywords, setKeywords] = useState(audience.profile.keywords.join(', '))
  const [negative, setNegative] = useState(audience.profile.negativeKeywords.join(', '))
  const [expanded, setExpanded] = useState(false)
  const input = audienceInput(draft, keywords, negative)
  const snapshot = JSON.stringify(input)
  const reportDirty = useCallback((dirty: boolean) => onDirtyChange(`audience:${audience.slug}`, dirty), [audience.slug, onDirtyChange])
  const { dirty, markClean } = useDraftBaseline(snapshot)
  const validation = audienceValidation(input)
  const prefix = useId()
  const saving = useRef(false)
  const mutation = useMutation({
    mutationFn: () => smartCampaignApi.updateAudience(audience.slug, input),
    onSuccess: (updated) => {
      setDraft(updated)
      setKeywords(updated.profile.keywords.join(', '))
      setNegative(updated.profile.negativeKeywords.join(', '))
      markClean(JSON.stringify(audienceInput(updated, updated.profile.keywords.join(', '), updated.profile.negativeKeywords.join(', '))))
      void queryClient.invalidateQueries({ queryKey: ['smart-audiences'] })
    },
    onSettled: () => { saving.current = false },
  })
  useEffect(() => { reportDirty(dirty || mutation.isPending) }, [dirty, mutation.isPending, reportDirty])
  useEffect(() => () => reportDirty(false), [reportDirty])
  const style = NICHE_STYLES[audience.slug]
  const selectedGroups = draft.destinationGroupIds.map((id) => groups.find((group) => group.id === id) ?? { id, name: audience.destinations.find((destination) => destination.groupId === id)?.groupName ?? id, size: 0, announceOnly: false })
  const numberField = (key: 'dailyCap' | 'maxStandoutMessages' | 'minIntervalMinutes' | 'maxIntervalMinutes', label: string, min: number, max: number) => <div><Label htmlFor={`${prefix}-${key}`}>{label}</Label><Input id={`${prefix}-${key}`} type="number" min={min} max={max} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} /></div>
  function reset() {
    setDraft(audience); setKeywords(audience.profile.keywords.join(', ')); setNegative(audience.profile.negativeKeywords.join(', '))
    markClean(JSON.stringify(audienceInput(audience, audience.profile.keywords.join(', '), audience.profile.negativeKeywords.join(', '))))
    mutation.reset()
  }
  return <Card className="smart-audience overflow-hidden p-0">
    <div className={`flex items-start justify-between gap-3 border-b p-5 ${draft.enabled ? style.soft : 'border-line bg-surface-muted'}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={`smart-niche-icon ${style.color}`}><NicheIcon slug={audience.slug} size={22} /></span>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg font-semibold text-ink">{audienceLabel(audience)}</h3><Badge tone={draft.enabled ? 'success' : 'neutral'}>{draft.enabled ? 'Ativo' : 'Inativo'}</Badge></div><p className="mt-1 text-sm leading-relaxed text-muted">{audience.description}</p></div>
      </div>
      <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" aria-label={`Ativar ${audienceLabel(audience)}`} className="h-4 w-4 accent-accent" checked={draft.enabled} disabled={mutation.isPending} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />Ativar</label>
    </div>
    <fieldset disabled={mutation.isPending} className="min-w-0 space-y-4 p-5">
      <legend className="sr-only">Configurar {audienceLabel(audience)}</legend>
      <div className="grid gap-2 text-xs text-muted sm:grid-cols-3"><p><strong className="block text-base tabular-nums text-ink">{draft.dailyCap}</strong>produtos por dia</p><p><strong className="block text-base tabular-nums text-ink">{draft.startTime}–{draft.endTime}</strong>horário de Brasília</p><p><strong className="block text-base tabular-nums text-ink">{draft.minIntervalMinutes}–{draft.maxIntervalMinutes} min</strong>entre envios</p></div>
      {groups.length === 0 && <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">Conecte o WhatsApp para carregar os grupos. Os vínculos salvos continuam disponíveis abaixo.</p>}
      <GroupCombobox label={`Grupos de ${audienceLabel(audience)}`} description="Busque e vincule os destinos deste público. As alterações só valem depois de salvar." items={groups} value={selectedGroups} onChange={(next) => setDraft({ ...draft, destinationGroupIds: next.map((group) => group.id) })} disabled={mutation.isPending} />
      <fieldset className="min-w-0 border-t border-line pt-4" aria-describedby={`${prefix}-filters-help`}>
        <legend className="text-sm font-semibold text-ink">Filtros de ofertas</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={input.excludePolitical} onChange={(e) => setDraft({ ...draft, excludePolitical: e.target.checked })} />Excluir produtos políticos</label>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor={`${prefix}-min-price`}>Preço mínimo (R$)</Label><Input id={`${prefix}-min-price`} type="number" min={0} step="0.01" value={draft.minPrice ?? ''} placeholder="Sem mínimo" onChange={(e) => setDraft({ ...draft, minPrice: optionalNumber(e.target.value) })} /></div>
          <div><Label htmlFor={`${prefix}-max-price`}>Preço máximo (R$)</Label><Input id={`${prefix}-max-price`} type="number" min={0} step="0.01" value={draft.maxPrice ?? ''} placeholder="Sem máximo" onChange={(e) => setDraft({ ...draft, maxPrice: optionalNumber(e.target.value) })} /></div>
          <div><Label htmlFor={`${prefix}-commission`}>Comissão mínima (%)</Label><Input id={`${prefix}-commission`} type="number" min={0} max={100} step="0.1" value={draft.minCommissionPercent ?? ''} placeholder="Sem mínimo" onChange={(e) => setDraft({ ...draft, minCommissionPercent: optionalNumber(e.target.value) })} /></div>
          <div><Label htmlFor={`${prefix}-estimated`}>Comissão mínima por venda (R$)</Label><Input id={`${prefix}-estimated`} type="number" min={0} max={1000000} step="0.01" value={draft.minEstimatedCommission ?? ''} placeholder="Sem mínimo" onChange={(e) => setDraft({ ...draft, minEstimatedCommission: optionalNumber(e.target.value) })} /></div>
        </div>
        <p id={`${prefix}-filters-help`} className="mt-2 text-xs text-muted">Valores em reais. Campos vazios não aplicam limite; zero é um valor válido.</p>
      </fieldset>
      <button type="button" className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-accent" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={`${prefix}-rules`}><Settings2 size={16} />{expanded ? 'Ocultar regras e limites' : 'Ajustar regras e limites'}</button>
      <div id={`${prefix}-rules`} hidden={!expanded} className="space-y-4 border-t border-line pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('dailyCap', 'Máximo por dia', 1, 50)}
          <div><Label htmlFor={`${prefix}-end`}>Encerrar até</Label><Input id={`${prefix}-end`} type="time" min="09:01" max="21:00" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} /></div>
          {numberField('minIntervalMinutes', 'Intervalo mínimo (min)', 12, 16)}
          {numberField('maxIntervalMinutes', 'Intervalo máximo (min)', 12, 16)}
          {numberField('maxStandoutMessages', 'Destaques por dia', 0, 10)}
        </div>
        <div><Label htmlFor={`${prefix}-instructions`}>O que combina com este público</Label><textarea id={`${prefix}-instructions`} className="field-control min-h-28 w-full" maxLength={2000} value={draft.profile.instructions} onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, instructions: e.target.value } })} /></div>
        <div><Label htmlFor={`${prefix}-keywords`}>Termos-base, separados por vírgula</Label><Input id={`${prefix}-keywords`} value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
        <div><Label htmlFor={`${prefix}-negative`}>Excluir termos, separados por vírgula</Label><Input id={`${prefix}-negative`} value={negative} onChange={(e) => setNegative(e.target.value)} /></div>
      </div>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-muted px-5 py-3">
      <ActionStatus state={mutation.isPending ? 'saving' : mutation.isError ? 'error' : dirty ? 'unsaved' : 'saved'} label={mutation.isPending ? 'Salvando público…' : mutation.isError ? 'Falha ao salvar' : dirty ? 'Alterações pendentes' : 'Configuração salva'} />
      <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={!dirty || mutation.isPending} onClick={reset}>Restaurar salvo</Button><Button loading={mutation.isPending} loadingText="Salvando…" disabled={!dirty || !!validation} onClick={() => { if (saving.current || !dirty || validation) return; saving.current = true; mutation.mutate() }}><Save size={15} />Salvar público</Button></div>
    </div>
    {dirty && validation && <p role="status" className="px-5 py-3 text-sm text-warning">{validation}</p>}
    {mutation.isError && <p role="alert" className="px-5 py-3 text-sm text-danger">{apiErrorMessage(mutation.error)}</p>}
  </Card>
}

function AudienceSetup({ audiences, groups, onDirtyChange }: { audiences: SmartAudience[]; groups: Group[]; onDirtyChange: DirtyChange }) {
  return <section aria-labelledby="audience-title"><div className="mb-5"><h2 id="audience-title" className="section-heading">Públicos e regras</h2><p className="page-description">Escolha os destinos e salve as regras de cada público antes de planejar as ofertas.</p></div><div className="grid gap-5 xl:grid-cols-2">{audiences.map((audience) => <AudienceCard key={audience.slug} audience={audience} groups={groups} onDirtyChange={onDirtyChange} />)}</div></section>
}

function WorkflowSelection({ audiences, selected, setSelected, planDate, setPlanDate, disabled = false }: {
  audiences: SmartAudience[]; selected: Set<SmartAudienceSlug>; setSelected: (next: Set<SmartAudienceSlug>) => void; planDate: string; setPlanDate: (date: string) => void; disabled?: boolean
}) {
  const id = useId()
  return <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]"><legend className="sr-only">Data e públicos do plano</legend><div><Label htmlFor={id}>Data da campanha</Label><Input id={id} type="date" min={today()} value={planDate} onChange={(e) => setPlanDate(e.target.value)} /></div><fieldset className="min-w-0"><legend className="field-label">Públicos incluídos</legend><div className="flex flex-wrap gap-2">{audiences.filter((audience) => audience.enabled).map((audience) => <label key={audience.slug} className={`smart-audience-choice flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm ${selected.has(audience.slug) ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted'}`}><input type="checkbox" className="h-4 w-4 accent-accent" checked={selected.has(audience.slug)} onChange={() => { const next = new Set(selected); if (next.has(audience.slug)) next.delete(audience.slug); else next.add(audience.slug); setSelected(next) }} /><NicheIcon slug={audience.slug} size={16} />{audienceLabel(audience)}</label>)}</div>{audiences.every((audience) => !audience.enabled) && <p className="text-sm text-warning">Ative e salve pelo menos um público na primeira etapa.</p>}</fieldset>{!validPlanDate(planDate, today()) && <p role="status" className="text-sm text-warning sm:col-span-2">Escolha uma data válida a partir de hoje, no horário de Brasília.</p>}</fieldset>
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
          <div className="flex items-center gap-2"><span className="text-xl"><NicheIcon slug={pack.audienceSlug} /></span><h3 className={`font-bold ${style.color}`}>{pack.name && pack.name.toUpperCase() !== pack.audienceSlug ? pack.name : NICHE_STYLES[pack.audienceSlug].label}</h3></div>
          <Badge tone="violet">Modo {pack.mode || 'ANY'}</Badge>
        </div>
        {pack.reason && <p className="mt-2 text-xs text-muted">{pack.reason}</p>}
        <p className="mt-2 text-xs text-muted">Prefira o preset: palavras inteiras, sem diferenciar acentos. Atualize e recarregue a extensão antes de usar.</p>
      </div>
      <div className="p-4">
        {pack.calendarContext && pack.calendarContext.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">{pack.calendarContext.map((context) => <Badge key={context} tone="amber">{context}</Badge>)}</div>
        )}
        <div className="flex flex-wrap gap-2">
          {phrases.map((phrase) => {
            const details = pack.phrases?.find((item) => item.keyword === phrase)
            return <span key={phrase} title={details?.reason} className="rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-sm text-ink">{phrase}</span>
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs text-muted">
            {pack.minCommissionPercent !== undefined ? `Comissão ≥ ${pack.minCommissionPercent}%` : 'Sem comissão mínima'}
            {pack.minEstimatedCommission !== undefined ? ` · estimada ≥ ${formatMoney(pack.minEstimatedCommission)}` : ''}
            {pack.minPrice !== undefined ? ` · preço mínimo ${formatMoney(pack.minPrice)}` : ''}
            {pack.maxPrice !== undefined ? ` · preço máximo ${formatMoney(pack.maxPrice)}` : ''}
            {pack.excludePolitical ? ' · políticos excluídos' : ''}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={copy}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? 'Copiado' : 'Copiar lista'}</Button>
            <Button type="button" onClick={copyPreset}>{presetCopied ? <Check size={15} /> : <FileJson size={15} />}{presetCopied ? 'Preset copiado' : 'Copiar preset da extensão'}</Button>
          </div>
        </div>
        {copyError && <p role="alert" className="mt-2 text-xs text-danger">{copyError}</p>}
      </div>
    </Card>
  )
}

function KeywordPlanner({ audiences, selected, setSelected, planDate, setPlanDate, aiBlocked, onDirtyChange }: {
  audiences: SmartAudience[]
  selected: Set<SmartAudienceSlug>
  setSelected: (next: Set<SmartAudienceSlug>) => void
  planDate: string
  setPlanDate: (date: string) => void
  aiBlocked: boolean
  onDirtyChange: DirtyChange
}) {
  type KeywordRequest = Parameters<typeof smartCampaignApi.keywords>[0]
  const submitting = useRef(false)
  const mutation = useMutation({
    mutationFn: (input: KeywordRequest) => smartCampaignApi.keywords(input),
    retry: false,
    onSettled: () => { submitting.current = false },
  })
  useEffect(() => { onDirtyChange('keywords-pending', mutation.isPending) }, [mutation.isPending, onDirtyChange])
  const fingerprint = `${planDate}:${[...selected].sort().join(',')}`
  const resultIsCurrent = mutation.variables
    ? `${mutation.variables.date}:${[...mutation.variables.audienceSlugs].sort().join(',')}` === fingerprint
    : false
  const submit = (input?: KeywordRequest) => {
    if (submitting.current || mutation.isPending || aiBlocked || !validPlanDate(planDate, today()) || selected.size === 0) return
    submitting.current = true
    mutation.mutate(input ?? { requestId: createSmartAIRequestId(), date: planDate, audienceSlugs: [...selected] })
  }

  return (
    <section aria-labelledby="keywords-title">
      <h2 id="keywords-title" className="text-xl font-bold">Busca inteligente para o dia</h2>
      <p className="mt-1 text-sm text-muted">Gere termos compatíveis com o nicho, a data e seus filtros. As sugestões são planejamento, não tendências ao vivo.</p>
      <Card className="mt-5">
        <div className="mb-4 rounded-xl border border-info/30 bg-info-soft p-3 text-xs leading-relaxed text-info">
          A extensão aplica estes termos ao texto visível dos cards que o hub de afiliados já descobriu na página. Ela não executa novas pesquisas globais no Mercado Livre. Por isso, os pacotes priorizam palavras curtas em modo ANY; frases entram apenas quando ajudam a evitar resultados ambíguos.
        </div>
        <WorkflowSelection audiences={audiences} selected={selected} setSelected={setSelected} planDate={planDate} setPlanDate={setPlanDate} disabled={mutation.isPending} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><p className="max-w-lg text-xs leading-relaxed text-muted">As sugestões usam o orçamento de IA mostrado acima. Copie o resultado para a extensão e faça sua coleta.</p><Button type="button" loading={mutation.isPending} loadingText="Gerando palavras-chave…" onClick={() => submit()} disabled={!validPlanDate(planDate, today()) || selected.size === 0 || aiBlocked}><Sparkles size={16} />Usar IA: gerar palavras-chave</Button></div>
      </Card>
      <div className="mt-4">
        {mutation.isError && resultIsCurrent && <ErrorState message={apiErrorMessage(mutation.error)} retry={mutation.variables ? () => submit(mutation.variables) : undefined} />}
        {(!mutation.data || !resultIsCurrent) && !mutation.isPending && <EmptyState title="Escolha os públicos e a data">Clique em “Usar IA” para montar listas curtas para a seleção atual.</EmptyState>}
        {mutation.isPending && <Card className="flex items-center gap-3 text-sm text-muted"><Spinner /> Preparando as sugestões para a data escolhida…</Card>}
        {mutation.data && resultIsCurrent && (
          <div className="grid gap-4 xl:grid-cols-2">{mutation.data.packs.map((pack) => <KeywordPackCard key={pack.audienceSlug} pack={pack} date={mutation.data.date} />)}</div>
        )}
      </div>
    </section>
  )
}

function ImportPlanner({ audiences, selected, setSelected, planDate, setPlanDate, onCreated, aiStatus, aiBlocked, onDirtyChange }: {
  audiences: SmartAudience[]; selected: Set<SmartAudienceSlug>; setSelected: (next: Set<SmartAudienceSlug>) => void; planDate: string; setPlanDate: (date: string) => void; onCreated: (plan: SmartPlan) => void; aiStatus?: SmartAIStatus; aiBlocked: boolean; onDirtyChange: DirtyChange
}) {
  const queryClient = useQueryClient()
  const [rawJson, setRawJson] = useState('')
  const [days, setDays] = useState(1)
  const [startNow, setStartNow] = useState(false)
  const [campaignStartTime, setCampaignStartTime] = useState('09:00')
  const immediateStart = startNow && planDate === today()
  const endTime = audiences.filter((entry) => selected.has(entry.slug)).map((entry) => entry.policy.endTime).sort()[0] ?? '21:00'
  const timingError = campaignTimingValidation(campaignStartTime, immediateStart, planDate, today(), endTime)
  const [filePayloads, setFilePayloads] = useState<SmartImportPayload[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const submitting = useRef(false)
  const readVersion = useRef(0)
  const [reading, setReading] = useState(false)
  const snapshot = JSON.stringify({ rawJson, days, startNow: immediateStart, campaignStartTime, files: filePayloads.map(({ name, targetAudienceSlug }) => ({ name, targetAudienceSlug })) })
  const { dirty, markClean } = useDraftBaseline(snapshot)
  useEffect(() => () => { readVersion.current++ }, [])
  const daysId = useId()
  const mutation = useMutation({
    mutationFn: smartCampaignApi.createPlan,
    retry: false,
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['smart-plans'] })
      setRawJson(''); setFilePayloads([]); setFileError(null)
      markClean(JSON.stringify({ rawJson: '', days, startNow: immediateStart, campaignStartTime, files: [] }))
      onCreated(plan)
    },
    onSettled: () => { submitting.current = false },
  })

  useEffect(() => { onDirtyChange('import', dirty || reading || mutation.isPending) }, [dirty, reading, mutation.isPending, onDirtyChange])

  const invalidTargets = filePayloads.some((file) => file.targetAudienceSlug && !selected.has(file.targetAudienceSlug))
  const previousRequest = mutation.variables
  const requestIsCurrent = !!previousRequest && previousRequest.date === planDate && previousRequest.days === days
    && previousRequest.startNow === immediateStart && previousRequest.campaignStartTime === campaignStartTime
    && [...previousRequest.audienceSlugs].sort().join(',') === [...selected].sort().join(',')
    && (previousRequest.payloads ? previousRequest.payloads === filePayloads : previousRequest.rawJson === rawJson)
  const submit = (retryInput?: SmartCreatePlanInput) => {
    if (retryInput && !requestIsCurrent) return
    if (submitting.current || mutation.isPending || aiBlocked || !validPlanDate(planDate, today()) || selected.size === 0 || reading || !!fileError || invalidTargets || timingError || !(filePayloads.length || (rawJson.trim() && jsonValid))) return
    submitting.current = true
    mutation.mutate(retryInput ?? (filePayloads.length
      ? { requestId: createSmartAIRequestId(), date: planDate, days, audienceSlugs: [...selected], payloads: filePayloads, startNow: immediateStart, campaignStartTime }
      : { requestId: createSmartAIRequestId(), date: planDate, days, audienceSlugs: [...selected], rawJson, startNow: immediateStart, campaignStartTime }))
  }

  const loadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    if (files.length === 0) return
    const inputElement = event.target
    const version = ++readVersion.current
    setReading(true)
    setFileError(null)
    try {
      if (files.length > 50) throw new Error('files')
      if (files.some((file) => file.name.length > 255)) throw new Error('name')
      if (files.reduce((total, file) => total + file.size, 0) > 30 * 1024 * 1024) throw new Error('size')
      const parsed = await Promise.all(files.map(async (file) => JSON.parse(await file.text()) as unknown))
      if (version !== readVersion.current) return
      const payloads = parsed.map((json, index) => ({ name: files[index].name, json, targetAudienceSlug: inferFileAudience(files[index].name, selected, audiences) }))
      setRawJson('')
      setFilePayloads(payloads)
    } catch (error) {
      if (version !== readVersion.current) return
      const reason = error instanceof Error ? error.message : ''
      setFileError(reason === 'files'
        ? 'Selecione no máximo 50 arquivos por análise.'
        : reason === 'size'
          ? 'Os arquivos juntos devem ter no máximo 30 MB.'
          : reason === 'name'
            ? 'Um nome de arquivo é longo demais.'
            : 'Um dos arquivos não contém JSON válido. Revise o arquivo exportado pela extensão.')
    } finally {
      if (version === readVersion.current) setReading(false)
      inputElement.value = ''
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
      <p className="mt-1 text-sm text-muted">Carregue a coleta, confira o público de cada arquivo e prepare uma agenda para revisão. Os envios só começam depois da aprovação.</p>
      <Card className="mt-5"><WorkflowSelection audiences={audiences} selected={selected} setSelected={setSelected} planDate={planDate} setPlanDate={setPlanDate} disabled={mutation.isPending || reading} /></Card>
      <fieldset disabled={mutation.isPending || reading} className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]"><legend className="sr-only">Importação e duração do plano</legend>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-semibold">JSON da extensão</h3><p className="text-xs text-muted">Você pode importar coletas separadas ou classificar um lote misto.</p></div>
            <label className="smart-file-control inline-flex cursor-pointer items-center gap-2 rounded-lg bg-surface-muted px-4 py-2 text-sm font-medium text-ink hover:bg-surface">
              <Upload size={16} /> Carregar ou substituir arquivos
              <input className="sr-only" type="file" accept="application/json,.json" multiple onChange={loadFiles} />
            </label>
          </div>
          {reading && <p role="status" className="mt-3 text-sm text-info">Lendo e validando arquivos…</p>}
          {filePayloads.length > 0 ? <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-muted">Confira o público sugerido para cada arquivo. Ele indica a origem da coleta; a triagem pode incluir outro público quando houver evidência no produto.</p>
            {filePayloads.map((file, index) => {
              const target = file.targetAudienceSlug
              const invalid = !!target && !selected.has(target)
              const count = countFileOffers(file.json)
              const inputId = `${daysId}-file-${index}`
              return <div key={`${file.name}-${index}`} className="rounded-xl border border-line bg-surface-muted p-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><h4 className="break-words text-sm font-semibold">{file.name}</h4><p className="mt-1 text-xs text-muted">{count === null ? 'O servidor identificará os produtos deste formato.' : `${count} produto(s) no arquivo`}</p></div><Button variant="ghost" aria-label={`Remover ${file.name}`} onClick={() => { setFilePayloads((current) => current.filter((_, itemIndex) => itemIndex !== index)); setFileError(null) }}>Remover</Button></div>
                <Label htmlFor={inputId} className="mt-3">Público de origem</Label>
                <select id={inputId} aria-label={`Público de ${file.name}`} aria-invalid={invalid} className="field-control w-full" value={target ?? 'ALL'} onChange={(event) => {
                  const value = event.target.value as SmartAudienceSlug | 'ALL'
                  setFilePayloads((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, targetAudienceSlug: value === 'ALL' ? undefined : value } : item))
                  setFileError(null)
                }}><option value="ALL">Classificar entre todos os selecionados</option>{invalid && <option value={target} disabled>{NICHE_STYLES[target].label} — não selecionado</option>}{audiences.filter((audience) => selected.has(audience.slug)).map((audience) => <option key={audience.slug} value={audience.slug}>{audienceLabel(audience)}</option>)}</select>
                <p className={`mt-2 text-xs leading-relaxed ${invalid ? 'text-danger' : 'text-muted'}`}>{invalid ? 'Este público saiu da seleção do plano. Selecione-o acima ou altere a origem deste arquivo.' : target ? `Origem sugerida: ${NICHE_STYLES[target].label}. Confira antes de analisar.` : 'Coleta mista: a triagem busca públicos prováveis e a IA avalia os casos ambíguos.'}</p>
              </div>
            })}
            <Button variant="secondary" onClick={() => { setFilePayloads([]); setRawJson(''); setFileError(null) }}>Remover arquivos e colar JSON</Button>
          </div> : <textarea
            className="field-control mt-3 min-h-80 w-full font-mono text-xs"
            value={rawJson}
            onChange={(e) => { setRawJson(e.target.value); setFilePayloads([]); setFileError(null) }}
            placeholder="Cole aqui o JSON exportado pela extensão…"
            spellCheck={false}
            aria-label="JSON exportado pela extensão"
          />}
          {fileError && <p role="alert" className="mt-2 text-sm text-danger">{fileError} A seleção anterior foi mantida; escolha novos arquivos ou edite o JSON.</p>}
          {rawJson && jsonCheckPending && <p className="mt-2 text-xs text-muted">Validando JSON…</p>}
          {rawJson && jsonValid && <p className="mt-2 text-xs text-success">JSON válido{parsedCount ? ` · ${parsedCount} registro(s) no nível principal` : ''}</p>}
          {rawJson && !jsonCheckPending && !jsonValid && <p className="mt-2 text-xs text-danger">O conteúdo ainda não é um JSON válido.</p>}
        </Card>
        <div className="space-y-4">
          <Card>
            <h3 className="font-semibold">Proposta de agenda</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Início</dt><dd className="font-medium">{formatDate(planDate)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Públicos</dt><dd className="font-medium">{selected.size}</dd></div>
            </dl>
            <div className="mt-4"><Label htmlFor={`${daysId}-start`}>Horário de início (Brasília)</Label><input id={`${daysId}-start`} className="field-control w-full" type="time" min="09:00" max={endTime} value={campaignStartTime} aria-invalid={!!timingError} disabled={immediateStart} onChange={(event) => setCampaignStartTime(event.target.value)} /></div>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={immediateStart} disabled={planDate !== today()} onChange={(event) => setStartNow(event.target.checked)} />Iniciar ao aprovar hoje</label>
            {timingError && <p role="status" className="mt-2 text-xs text-danger">{timingError}</p>}
            {immediateStart && <p className="mt-2 text-xs text-warning">A aprovação poderá iniciar envios antes das 09:00. A análise não envia mensagens.</p>}
            <div className="mt-4"><Label htmlFor={daysId}>Espalhar a campanha por</Label><select id={daysId} className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={1}>1 dia · {formatDate(planDate)}</option><option value={2}>2 dias · até {formatDate(addLocalDays(planDate, 1))}</option><option value={3}>3 dias · até {formatDate(addLocalDays(planDate, 2))}</option></select>
              <p className="mt-2 rounded-lg bg-surface-muted p-3 text-xs leading-relaxed text-muted">Define por quantas datas a proposta pode se estender. Cada público pode receber até <strong>50 produtos por dia</strong>, respeitando também o limite do grupo de WhatsApp vinculado. Ex.: dois públicos com grupos diferentes podem receber até 50 ofertas cada no mesmo dia. Ofertas que perderem o frescor antes do envio ficam de fora.</p></div>
            <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft p-3 text-xs leading-relaxed text-accent">A proposta considera encaixe no público, valor, comissão, sazonalidade, frescor e variedade. Usa IA para até {aiStatus?.limits.batchSize ?? 'o limite configurado de'} produtos por lote. Você revisa a proposta antes de confirmar os envios.</div>
            <Button className="mt-4 w-full" loading={mutation.isPending || reading} loadingText={reading ? "Lendo arquivos…" : "Criando plano…"} type="button" disabled={mutation.isPending || reading || !!fileError || !!timingError || !validPlanDate(planDate, today()) || !(filePayloads.length > 0 || (rawJson.trim() && jsonValid)) || selected.size === 0 || invalidTargets || aiBlocked} onClick={() => submit()}>
              {mutation.isPending ? <Spinner /> : <BrainCircuit size={17} />} Usar IA: analisar e montar proposta
            </Button>
          </Card>
          {mutation.isError && !requestIsCurrent && <p className="text-sm text-muted">A configuração mudou depois da última tentativa. Use “analisar e montar proposta” para enviar a seleção atual.</p>}
          {mutation.isError && <ErrorState message={apiErrorMessage(mutation.error)} retry={mutation.variables && requestIsCurrent ? () => submit(mutation.variables) : undefined} />}
        </div>
      </fieldset>
    </section>
  )
}

function ItemStateSelect({ item, onChange, disabled }: { item: SmartPlanItem; onChange: (state: SmartPlanItemState) => void; disabled: boolean }) {
  return (
    <select aria-label={`Situação de ${item.product.title}`} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs font-medium" value={item.state} onChange={(e) => onChange(e.target.value as SmartPlanItemState)} disabled={disabled}>
      <option value="SELECTED">Selecionado</option><option value="RESERVE">Reserva</option><option value="REJECTED">Rejeitado</option>
    </select>
  )
}

function PlanItemCard({ item, editable, saving, timeZone, onPatch, message, onMessageChange, onSaveMessage, onCancelMessage }: {
  item: SmartPlanItem; editable: boolean; saving: boolean; onPatch: (patch: Partial<SmartPlanItem>) => void;
  timeZone: string;
  message?: string; onMessageChange: (text: string) => void; onSaveMessage: () => void; onCancelMessage: () => void
}) {
  const editingMessage = message !== undefined
  const affiliateUrl = safeAffiliateUrl(item.product.affiliateUrl)
  const discount = item.product.originalPrice && item.product.originalPrice > item.product.discountedPrice
    ? Math.round((1 - item.product.discountedPrice / item.product.originalPrice) * 100) : undefined

  return (
    <Card className={`${item.state === 'SELECTED' ? 'border-accent/30' : item.state === 'REJECTED' ? 'opacity-75' : ''}`}>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
          {item.product.imageUrl ? <img className="h-full w-full object-contain" src={item.product.imageUrl} alt="" loading="lazy" /> : <div className="flex h-full items-center justify-center text-subtle"><Package size={28} /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-ink">{item.product.title}</h4>
                {item.standout && <Badge tone="violet">Destaque</Badge>}
                {item.category && <Badge>{item.category}</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2 text-sm">
                <strong className="smart-price-tag">{formatMoney(item.product.discountedPrice)}</strong>
                {item.product.originalPrice && <span className="text-xs text-subtle line-through">{formatMoney(item.product.originalPrice)}</span>}
                {discount !== undefined && <span className="text-xs font-semibold text-success">-{discount}%</span>}
                {item.estimatedCommission !== undefined && <span className="text-xs text-muted">Comissão est. {formatMoney(item.estimatedCommission)}</span>}
              </div>
            </div>
            <ItemStateSelect item={item} disabled={!editable || saving} onChange={(state) => onPatch({ state })} />
          </div>
          <p className="mt-2 text-sm text-muted">{item.reason || 'Sem justificativa informada.'}</p>
          {affiliateUrl && <a className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent underline" href={affiliateUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Abrir oferta em nova aba</a>}
          {item.rejectionReasons && item.rejectionReasons.length > 0 && <p className="mt-1 text-xs text-danger">{item.rejectionReasons.join(' · ')}</p>}
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <span className="rounded-lg bg-surface-muted px-2.5 py-2"><strong>Nota</strong> {score(item.score)}</span>
            <span className="rounded-lg bg-surface-muted px-2.5 py-2"><strong>Encaixe</strong> {score(item.fitScore)}</span>
            <span className="rounded-lg bg-surface-muted px-2.5 py-2"><strong>Comissão</strong> {item.product.commissionRate !== undefined ? `${item.product.commissionRate}%` : item.product.commissionPercent || 'desconhecida'}</span>
            <span className="rounded-lg bg-surface-muted px-2.5 py-2"><strong>Frescor</strong> {item.freshnessHours !== undefined ? `${Math.round(item.freshnessHours)}h` : 'desconhecido'}</span>
          </div>
          {item.product.extensionEvidence?.visibleSignals && <p className="mt-2 text-xs text-muted">Sinais observados no Mercado Livre: {item.product.extensionEvidence.visibleSignals.rating !== undefined && `nota ${item.product.extensionEvidence.visibleSignals.rating.toLocaleString('pt-BR')}/5`}{item.product.extensionEvidence.visibleSignals.rating !== undefined && item.product.extensionEvidence.visibleSignals.soldCount !== undefined && ' · '}{item.product.extensionEvidence.visibleSignals.soldCount !== undefined && `${item.product.extensionEvidence.visibleSignals.soldCountIsLowerBound ? 'mais de ' : ''}${item.product.extensionEvidence.visibleSignals.soldCount.toLocaleString('pt-BR')} vendidos`}. Influenciam levemente a variedade/atratividade, não o encaixe no público.</p>}
          {item.warnings && item.warnings.length > 0 && <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-2 text-xs text-warning">{item.warnings.join(' · ')}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Clock3 size={14} /> {item.scheduledAt ? formatDateTime(item.scheduledAt, timeZone) : item.state === 'SELECTED' ? 'Horário será calculado na aprovação' : 'Sem horário'}
            {editable && item.state === 'SELECTED' && <label className="ml-auto flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="accent-accent" checked={Boolean(item.standout)} onChange={(e) => onPatch({ standout: e.target.checked })} disabled={saving} /> Mensagem especial</label>}
          </div>
          {(item.standout || item.customMessage || editingMessage) && (
            <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-accent">Introdução especial</span>{editable && <button type="button" className="text-xs text-accent underline" disabled={saving} onClick={() => { if (editingMessage) onCancelMessage(); else onMessageChange(item.customMessage ?? '') }}>{editingMessage ? 'Descartar edição' : 'Editar'}</button>}</div>
              {editingMessage ? <div className="mt-2"><textarea className="min-h-20 w-full rounded-lg border border-accent/30 bg-surface p-2 text-sm" aria-label={`Introdução especial de ${item.product.title}`} maxLength={800} disabled={saving} value={message} onChange={(e) => onMessageChange(e.target.value)} /><Button className="mt-2" type="button" disabled={saving} onClick={onSaveMessage}><Save size={14} /> Salvar texto</Button></div> : <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{item.customMessage || 'A inteligência não sugeriu uma introdução especial.'}</p>}
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

function UnknownSendResolution({ planId, sends, onDirtyChange }: { planId: string; sends: SmartPlanSend[]; onDirtyChange: DirtyChange }) {
  const queryClient = useQueryClient()
  const [decision, setDecision] = useState<{ send: SmartPlanSend; resolution: SmartSendResolution } | null>(null)
  const [checked, setChecked] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer) }, [])
  const cooling = (send: SmartPlanSend) => Boolean(send.resolutionAvailableAt && new Date(send.resolutionAvailableAt).getTime() > now)
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
  useEffect(() => { onDirtyChange('resolution-pending', mutation.isPending) }, [mutation.isPending, onDirtyChange])
  const choose = (send: SmartPlanSend, resolution: SmartSendResolution) => {
    mutation.reset()
    setChecked(false)
    setDecision({ send, resolution })
  }
  return (
    <Card className="mt-4 border-danger/30 bg-danger-soft" >
      <div role="alert" className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 shrink-0 text-danger" size={22} />
        <div>
          <h3 className="font-bold text-danger">Ação necessária: resultado do envio desconhecido</h3>
          <p className="mt-1 text-sm leading-relaxed text-danger">O plano foi pausado automaticamente para evitar duplicatas. Aguarde pelo menos cinco minutos após a tentativa e confira diretamente no grupo do WhatsApp antes de decidir.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {sends.map((send) => (
          <div key={send.id} className="rounded-xl border border-danger/30 bg-surface p-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2"><strong>{send.offerTitle || 'Oferta sem título'}</strong><Badge tone="red">A confirmar</Badge><Badge>{NICHE_STYLES[send.audienceSlug].label}</Badge></div>
                <p className="mt-1 text-sm text-ink">Grupo: {send.groupName}</p>
                <p className="mt-1 text-xs text-muted">Tentativa prevista para {formatDateTime(send.scheduledAt)} · {send.attempts} tentativa(s)</p>
                {cooling(send) && <p role="status" className="mt-2 text-xs text-warning">Confira o grupo. A decisão será liberada em {formatDateTime(send.resolutionAvailableAt)}.</p>}
                {send.lastError && <p className="mt-1 text-xs text-danger">{send.lastError}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => choose(send, 'sent')} disabled={mutation.isPending || cooling(send)}><Check size={15} /> Apareceu no grupo</Button>
                <Button type="button" variant="secondary" onClick={() => choose(send, 'retry')} disabled={mutation.isPending || cooling(send)}><RotateCcw size={15} /> Não apareceu: reenviar</Button>
                <Button type="button" variant="ghost" onClick={() => choose(send, 'skip')} disabled={mutation.isPending || cooling(send)}>Não reenviar</Button>
              </div>
            </div>
            {decision?.send.id === send.id && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4">
                <h4 className="font-semibold text-warning">{RESOLUTION_COPY[decision.resolution].title}</h4>
                <p className="mt-1 text-sm text-warning">{RESOLUTION_COPY[decision.resolution].description}</p>
                {decision.send.resolutionAvailableAt && (
                  <p className="mt-2 text-xs font-medium text-warning">Decisão liberada pelo servidor em {formatDateTime(decision.send.resolutionAvailableAt)}.</p>
                )}
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-ink">
                  <input className="mt-0.5 accent-accent" type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
                  Conferi este grupo diretamente no WhatsApp e entendo o efeito desta decisão.
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant={decision.resolution === 'retry' ? 'danger' : 'primary'} disabled={!checked || mutation.isPending || cooling(decision.send)} onClick={() => mutation.mutate(decision)}>
                    {mutation.isPending ? <Spinner /> : <Check size={15} />} {RESOLUTION_COPY[decision.resolution].confirm}
                  </Button>
                  <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => { setDecision(null); setChecked(false) }}>Voltar</Button>
                </div>
                {mutation.isError && <p role="alert" className="mt-2 text-xs text-danger">{apiErrorMessage(mutation.error)}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function DeliveryInspector({ plan }: { plan: SmartPlan }) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState('ALL')
  const [page, setPage] = useState(0)
  const id = useId()
  const sends = plan.sends ?? []
  const filtered = sends.filter((send) => filter === 'ALL' || (filter === 'ERROR' ? !!send.lastError : send.status === filter))
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1)
  const currentPage = Math.min(page, lastPage)
  const labels: Record<SmartPlanSend['status'], string> = { PENDING: 'Pendente', SENDING: 'Enviando', SENT: 'Enviado', SKIPPED: 'Ignorado', FAILED: 'Falha', UNKNOWN: 'A confirmar' }
  const download = () => {
    const url = URL.createObjectURL(new Blob([smartDeliveriesCsv(plan)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `campanha-${plan.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-envios.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!sends.length) return null
  return <div className="mt-3 border-t border-line pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="inline-flex items-center gap-2 text-sm font-medium text-accent" aria-expanded={expanded} aria-controls={`${id}-deliveries`} onClick={() => setExpanded((value) => !value)}><ChevronRight size={16} className={expanded ? 'rotate-90' : ''} aria-hidden="true" />{expanded ? 'Ocultar entregas' : `Ver entregas (${sends.length})`}{sends.some((send) => send.lastError) ? ' e erros completos' : ''}</button><Button variant="ghost" onClick={download}><Download size={15} />Exportar todos os envios (CSV)</Button></div>
    {expanded && <div id={`${id}-deliveries`} className="mt-3">
      <Label htmlFor={`${id}-status`}>Situação da entrega</Label><select id={`${id}-status`} className="field-control w-full sm:w-64" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0) }}><option value="ALL">Todas</option><option value="ERROR">Com erro registrado</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <div className="mt-2 divide-y divide-line">{filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((send) => <article key={send.id} className="min-w-0 py-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 font-semibold">{send.groupName}</h4><Badge tone={send.status === 'UNKNOWN' || send.status === 'FAILED' ? 'danger' : 'neutral'}>{labels[send.status]}</Badge></div>
        <p className="mt-1 text-xs text-muted">{NICHE_STYLES[send.audienceSlug].label} · {formatDateTime(send.scheduledAt, send.timezone ?? plan.timezone ?? 'America/Sao_Paulo')} · {send.attempts} tentativa(s)</p>
        {send.offerTitle && <p className="mt-1">{send.offerTitle}</p>}
        {send.sentAt && <p className="mt-1 text-xs text-success">Enviado em {formatDateTime(send.sentAt, send.timezone ?? plan.timezone ?? 'America/Sao_Paulo')}</p>}
        {send.lastError && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-danger">{send.lastError}</p>}
      </article>)}</div>
      {!filtered.length && <p role="status" className="py-4 text-sm text-muted">Nenhuma entrega nesta situação.</p>}
      {filtered.length > 25 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3"><span className="text-xs text-muted">{currentPage * 25 + 1}–{Math.min((currentPage + 1) * 25, filtered.length)} de {filtered.length}</span><div className="flex gap-2"><Button variant="secondary" aria-label="Página anterior de entregas" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={16} /></Button><Button variant="secondary" aria-label="Próxima página de entregas" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>}
    </div>}
  </div>
}

function PlanReview({ plan, audiences, actions, onPlanChange, onDirtyChange, externalBusy }: { plan: SmartPlan; audiences: SmartAudience[]; actions: ReactNode; onPlanChange: (plan: SmartPlan) => void; onDirtyChange: DirtyChange; externalBusy: boolean }) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<Record<string, string>>({})
  const changedMessages = Object.entries(messages).some(([id, text]) => text !== (plan.items.find((item) => item.id === id)?.customMessage ?? ''))
  const prefix = useId()
  const submitting = useRef(false)
  const [audience, setAudience] = useState<SmartAudienceSlug | 'ALL'>('ALL')
  const [date, setDate] = useState('ALL')
  const [state, setState] = useState<SmartPlanItemState>('SELECTED')
  const [campaignStartTime, setCampaignStartTime] = useState(plan.settings?.global?.campaignStartTime ?? '09:00')
  const [startNow, setStartNow] = useState(plan.settings?.global?.startNow ?? false)
  const savedStartNow = plan.settings?.global?.startNow ?? false
  const savedCampaignStartTime = plan.settings?.global?.campaignStartTime ?? '09:00'
  const mutation = useMutation({
    mutationFn: ({ item, patch }: { item: SmartPlanItem; patch: Partial<SmartPlanItem> }) => smartCampaignApi.updatePlan(plan.id, plan.revision, [{
      id: item.id, state: patch.state, standout: patch.standout, customMessage: patch.customMessage, audienceSlug: patch.audienceSlug, date: patch.date,
    }]),
    onSettled: () => { submitting.current = false },
    onSuccess: (updated, { item, patch }) => {
      onPlanChange(updated)
      if (patch.customMessage !== undefined) setMessages((current) => { const next = { ...current }; delete next[item.id]; return next })
      void queryClient.invalidateQueries({ queryKey: ['smart-plans'] })
    },
  })
  const startTimeMutation = useMutation({
    mutationFn: () => smartCampaignApi.updatePlan(plan.id, plan.revision, [], campaignStartTime, startNow),
    onSuccess: (updated) => {
      onPlanChange(updated)
      void queryClient.invalidateQueries({ queryKey: ['smart-plans'] })
    },
    onSettled: () => { submitting.current = false },
  })
  const shuffleMutation = useMutation({
    mutationFn: () => smartCampaignApi.action(plan.id, 'shuffle', plan.revision),
    retry: false,
    onSuccess: (updated) => { onPlanChange(updated); void queryClient.invalidateQueries({ queryKey: ['smart-plans'] }) },
    onSettled: () => { submitting.current = false },
  })
  const reviewBusy = externalBusy || mutation.isPending || startTimeMutation.isPending || shuffleMutation.isPending
  const changedStartTime = campaignStartTime !== savedCampaignStartTime || startNow !== savedStartNow
  useEffect(() => { setCampaignStartTime(savedCampaignStartTime); setStartNow(savedStartNow) }, [savedCampaignStartTime, savedStartNow])
  const ownPending = mutation.isPending || startTimeMutation.isPending || shuffleMutation.isPending
  useEffect(() => { onDirtyChange('review', changedMessages || changedStartTime || ownPending) }, [changedMessages, changedStartTime, ownPending, onDirtyChange])
  useEffect(() => () => onDirtyChange('review', false), [onDirtyChange])
  const patchItem = (item: SmartPlanItem, patch: Partial<SmartPlanItem>) => {
    if (submitting.current || reviewBusy || plan.status !== 'REVIEW') return
    submitting.current = true
    mutation.mutate({ item, patch })
  }
  const dates = [...new Set(plan.items.map((item) => item.date).filter(Boolean))].sort()
  const counts = useMemo(() => plan.items.reduce((acc, item) => { acc[item.state]++; return acc }, { SELECTED: 0, RESERVE: 0, REJECTED: 0 }), [plan.items])
  const agenda = useMemo(() => {
    const rows = new Map<string, { audienceSlug: SmartAudienceSlug; date: string; count: number }>()
    for (const item of plan.items) {
      if (item.state !== 'SELECTED') continue
      const key = `${item.audienceSlug}:${item.date}`
      const current = rows.get(key) ?? { audienceSlug: item.audienceSlug, date: item.date, count: 0 }
      current.count++
      rows.set(key, current)
    }
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.audienceSlug.localeCompare(b.audienceSlug))
  }, [plan.items])
  const visible = plan.items.filter((item) => (audience === 'ALL' || item.audienceSlug === audience) && (date === 'ALL' || item.date === date) && item.state === state)
    .sort((a, b) => a.date.localeCompare(b.date) || a.audienceSlug.localeCompare(b.audienceSlug) || (a.sendOrder ?? Number.MAX_SAFE_INTEGER) - (b.sendOrder ?? Number.MAX_SAFE_INTEGER) || b.score - a.score)
  const editable = plan.status === 'REVIEW'
  const analysisFailure = isAnalysisFailure(plan)
  const contexts = plan.audienceSlugs.map((slug) => ({ slug, ...planAudienceContext(plan, slug, audiences) }))
  const endTime = contexts.map((entry) => entry.policy?.endTime ?? '21:00').sort()[0] ?? '21:00'
  const timingError = campaignTimingValidation(campaignStartTime, startNow, plan.startDate, today(), endTime)
  const nextDelivery = nextSmartDelivery(plan)

  if (plan.status === 'ANALYZING') {
    const percent = plan.progress?.total ? Math.round((plan.progress.completed / plan.progress.total) * 100) : null
    return <Card className="py-12 text-center"><LoaderCircle className="mx-auto animate-spin text-accent" size={36} /><h2 className="mt-4 text-lg font-bold">Análise em andamento</h2><p className="mt-1 text-sm text-muted">{plan.progress?.message || 'O servidor está avaliando os produtos e montando as agendas.'}</p>{percent !== null && <div className="mx-auto mt-4 max-w-sm"><div className="h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} /></div><p className="mt-1 text-xs text-muted">{plan.progress?.completed} de {plan.progress?.total} · {percent}%</p></div>}</Card>
  }

  if (analysisFailure)
    return (
      <>
        <ErrorState
          message={plan.error || 'A análise dos produtos falhou. Você pode tentar esta análise novamente.'}
        />
        {actions}
      </>
    )

  return (
    <section aria-labelledby="review-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div><h2 id="review-title" className="text-xl font-bold">Agenda proposta</h2><p className="mt-1 text-sm text-muted">Plano de {formatDate(plan.startDate)} · versão {plan.revision}</p></div>
        <Badge tone={statusTone(plan.status)}>{planStatusLabel(plan.status)}</Badge>
      </div>
      {plan.warnings && plan.warnings.length > 0 && <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">{plan.warnings.join(' · ')}</div>}
      {contexts.some((entry) => entry.drift) && <p role="status" className="mt-4 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">As regras ou os destinos atuais diferem deste plano. O resumo usa as regras salvas na criação e os destinos dos envios já reservados. Alterações do público não reconfiguram este histórico.</p>}
      {contexts.some((entry) => !entry.policyFrozen) && <p role="status" className="mt-3 text-sm text-warning">Snapshot de regras indisponível para parte do plano. Os limites atuais exibidos são apenas referência.</p>}
      <Card className="mt-4 border-accent/20">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">Resumo da campanha</h3><p className="text-sm text-muted">{counts.SELECTED} selecionados · {counts.RESERVE} na reserva · {counts.REJECTED} rejeitados</p></div>
        {nextDelivery && <div className="mt-3 border-y border-line py-3 text-sm"><p className="font-medium">{plan.status === 'PAUSED' ? 'Próxima reserva (plano pausado)' : 'Próxima entrega agendada'}: {formatDateTime(nextDelivery.scheduledAt, nextDelivery.timezone ?? plan.timezone ?? 'America/Sao_Paulo')}</p><p className="mt-1 text-xs text-muted">{nextDelivery.groupName} · {NICHE_STYLES[nextDelivery.audienceSlug].label} · {nextDelivery.timezone ?? plan.timezone ?? 'America/Sao_Paulo'}</p></div>}
        {editable && <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-surface-muted p-3">
          <div><Label htmlFor={`${prefix}-campaign-start`}>Início da campanha (Brasília)</Label><input id={`${prefix}-campaign-start`} className="field-control block w-full" type="time" min="09:00" max={endTime} value={campaignStartTime} aria-invalid={!!timingError} disabled={reviewBusy || startNow} onChange={(event) => setCampaignStartTime(event.target.value)} /></div>
          <label className="flex min-h-11 items-center gap-2 py-2 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={startNow} disabled={reviewBusy || (!startNow && plan.startDate !== today())} onChange={(event) => setStartNow(event.target.checked)} />Iniciar ao aprovar hoje</label>
          <Button type="button" disabled={!changedStartTime || reviewBusy || !!timingError} onClick={() => { if (submitting.current || reviewBusy || !editable || timingError || !changedStartTime) return; submitting.current = true; startTimeMutation.mutate() }}>{startTimeMutation.isPending ? <Spinner /> : <Save size={15} />} Salvar início da campanha</Button>
          {timingError && <p role="status" className="w-full text-xs text-danger">{timingError}</p>}
          <p className="w-full text-xs text-muted">Os horários de cada produto serão distribuídos automaticamente a partir desse início, respeitando os intervalos e limites dos públicos.</p>
        </div>}
        {agenda.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[28rem] text-left text-sm"><thead><tr className="border-b border-line text-xs text-muted"><th className="px-2 py-2 font-medium">Dia</th><th className="px-2 py-2 font-medium">Público</th><th className="px-2 py-2 font-medium">Grupo(s)</th><th className="px-2 py-2 text-right font-medium">Ofertas</th></tr></thead><tbody>{agenda.map((row) => {
          const context = planAudienceContext(plan, row.audienceSlug, audiences)
          const groups = context.destinations.map((destination) => destination.groupName)
          return <tr key={`${row.audienceSlug}:${row.date}`} className="border-b border-line last:border-0"><td className="px-2 py-2">{formatDate(row.date)}</td><td className="px-2 py-2">{NICHE_STYLES[row.audienceSlug].label}</td><td className="max-w-xs break-words px-2 py-2">{groups.length ? groups.join(', ') : <span className="text-danger">Sem destino registrado</span>}<span className="block text-xs text-muted">{context.destinationsFrozen ? 'Destinos reservados' : 'Destinos atuais; confirmados ao aprovar'}</span></td><td className="px-2 py-2 text-right tabular-nums">{row.count} / {context.policy?.dailyCap ?? '—'}</td></tr>
        })}</tbody></table></div> : <p className="mt-3 text-sm text-warning">Nenhuma oferta foi selecionada para envio. Revise as reservas e os critérios dos públicos.</p>}
      </Card>
      {actions}
      {plan.sendSummary && (
        <Card className="mt-4">
          <div className="flex items-center gap-2"><Send size={17} className="text-accent" /><h3 className="font-semibold">Execução dos envios</h3></div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[['PENDING', 'Pendentes'], ['SENDING', 'Enviando'], ['SENT', 'Enviados'], ['SKIPPED', 'Ignorados'], ['FAILED', 'Falhas'], ['UNKNOWN', 'A confirmar']].map(([key, label]) => (
              <div key={key} className="rounded-lg bg-surface-muted p-2 text-center"><strong className="block text-lg">{plan.sendSummary?.[key] ?? 0}</strong><span className="text-xs text-muted">{label}</span></div>
            ))}
          </div>
          <DeliveryInspector plan={plan} />
        </Card>
      )}
      {plan.sends?.some((send) => send.status === 'UNKNOWN') && (
        <UnknownSendResolution onDirtyChange={onDirtyChange} planId={plan.id} sends={plan.sends.filter((send) => send.status === 'UNKNOWN')} />
      )}
      <div className="mt-5 grid grid-cols-3 gap-2">
        {(['SELECTED', 'RESERVE', 'REJECTED'] as const).map((value) => <button type="button" key={value} aria-pressed={state === value} onClick={() => setState(value)} className={`rounded-xl border p-3 text-left transition ${state === value ? 'border-accent/30 bg-accent-soft ring-2 ring-accent/20' : 'border-line bg-surface hover:border-accent/30'}`}><div className="text-2xl font-bold">{counts[value]}</div><div className="text-xs text-muted">{value === 'SELECTED' ? 'Selecionados' : value === 'RESERVE' ? 'Na reserva' : 'Rejeitados'}</div></button>)}
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row">
        <div className="min-w-0 flex-1"><Label htmlFor={`${prefix}-audience`}>Público</Label><select id={`${prefix}-audience`} className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm" value={audience} onChange={(e) => setAudience(e.target.value as SmartAudienceSlug | 'ALL')}><option value="ALL">Todos os públicos</option>{plan.audienceSlugs.map((slug) => <option key={slug} value={slug}>{NICHE_STYLES[slug].label}</option>)}</select></div>
        <div className="min-w-0 flex-1"><Label htmlFor={`${prefix}-date`}>Dia</Label><select id={`${prefix}-date`} className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)}><option value="ALL">Todos os dias</option>{dates.map((value) => <option key={value} value={value}>{formatDate(value)}</option>)}</select></div>
      </div>
      {editable && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p id={`${prefix}-shuffle-scope`} className="text-xs text-muted">Todos os selecionados, em todos os públicos e dias. Os filtros acima não limitam o embaralhamento; itens fixados mantêm a posição.</p><Button variant="secondary" aria-describedby={`${prefix}-shuffle-scope`} disabled={reviewBusy || changedMessages || changedStartTime || counts.SELECTED < 2} onClick={() => { if (submitting.current || reviewBusy || !editable || changedMessages || changedStartTime || counts.SELECTED < 2) return; submitting.current = true; shuffleMutation.mutate() }}>{shuffleMutation.isPending ? <Spinner /> : <Shuffle size={16} />}Embaralhar todos os selecionados</Button></div>}
      {(mutation.isError || startTimeMutation.isError || shuffleMutation.isError) && <div className="mt-4"><ErrorState message={apiErrorMessage(mutation.error ?? startTimeMutation.error ?? shuffleMutation.error)} /></div>}
      {changedMessages && <p role="status" className="mt-4 rounded-lg bg-warning-soft p-3 text-sm text-warning">Há introduções especiais não salvas. Elas permanecem ao mudar os filtros. Salve ou descarte as edições antes de aprovar ou retomar.</p>}
      <div className="mt-4 space-y-3">
        {visible.length === 0 ? <EmptyState title="Nada neste filtro">Escolha outro público, dia ou situação para revisar os produtos.</EmptyState> : visible.map((item) => {
          const policy = planAudienceContext(plan, item.audienceSlug, audiences).policy
          return <PlanItemCard key={item.id} item={item} editable={editable} saving={reviewBusy} timeZone={policy?.timezone ?? plan.timezone ?? 'America/Sao_Paulo'}
          message={messages[item.id]}
          onMessageChange={(text) => setMessages((current) => ({ ...current, [item.id]: text }))}
          onCancelMessage={() => setMessages((current) => { const next = { ...current }; delete next[item.id]; return next })}
          onSaveMessage={() => patchItem(item, { customMessage: messages[item.id] })}
          onPatch={(patch) => patchItem(item, patch)} />
        })}
      </div>
    </section>
  )
}

function PlanActions({ plan, audiences, onPlanChange, onCreateFresh, aiBlocked, draftsPending, onDirtyChange }: { plan: SmartPlan; audiences: SmartAudience[]; onPlanChange: (plan: SmartPlan) => void; onCreateFresh: () => void; aiBlocked: boolean; draftsPending: boolean; onDirtyChange: DirtyChange }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<'approve' | 'cancel' | 'resume' | 'advance' | null>(null)
  const [actionError, setActionError] = useState('')
  const confirmationRevision = useRef(plan.revision)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])
  const submitting = useRef(false)
  const hasUnknownSend = (plan.sendSummary?.UNKNOWN ?? 0) > 0 || (plan.sends?.some((send) => send.status === 'UNKNOWN') ?? false)
  const hasFailedSend = (plan.sendSummary?.FAILED ?? 0) > 0 || (plan.sends?.some((send) => send.status === 'FAILED') ?? false)
  const hasInFlightSend = (plan.sendSummary?.SENDING ?? 0) > 0 || (plan.sends?.some((send) => send.status === 'SENDING') ?? false)
  const destinationDrift = plan.audienceSlugs.some((slug) => planAudienceContext(plan, slug, audiences).destinationDrift)
  const recoveryReason = smartRecoveryReason(plan)
  const analysisFailure = isAnalysisFailure(plan)
  type PlanAction = 'approve' | 'pause' | 'resume' | 'cancel' | 'retry' | 'advance'
  type PlanActionRequest = { action: PlanAction; requestId?: string }
  const mutation = useMutation({
    mutationFn: ({ action, requestId }: PlanActionRequest) => smartCampaignApi.action(plan.id, action, plan.revision, requestId),
    retry: false,
    onSuccess: (updated) => { setActionError(''); setConfirming(null); onPlanChange(updated); queryClient.invalidateQueries({ queryKey: ['smart-plans'] }) },
    onSettled: () => { submitting.current = false },
  })
  useEffect(() => { onDirtyChange('plan-action', mutation.isPending) }, [mutation.isPending, onDirtyChange])
  const action = (name: PlanAction, input?: PlanActionRequest, expectedRevision?: number) => {
    if (expectedRevision !== undefined && expectedRevision !== plan.revision) { setActionError('O plano mudou durante a confirmação. Revise a agenda atualizada e confirme novamente.'); return }
    if (submitting.current || mutation.isPending || (name === 'retry' && aiBlocked) || ((name === 'approve' || name === 'resume' || name === 'advance') && draftsPending)) return
    if (name === 'advance' && !canAdvanceSmartPlan(plan)) return
    if (name === 'approve' && (!['REVIEW', 'READY', 'DRAFT'].includes(plan.status) || !selectedCount || missingAudienceNames.length)) return
    if (name === 'resume' && (plan.status !== 'PAUSED' || hasUnknownSend || hasFailedSend || hasInFlightSend || destinationDrift)) return
    if (name === 'cancel' && (hasUnknownSend || hasInFlightSend || ['COMPLETED', 'CANCELLED', 'FAILED'].includes(plan.status))) return
    setActionError('')
    submitting.current = true
    mutation.mutate(input ?? { action: name, requestId: name === 'retry' ? createSmartAIRequestId() : undefined })
  }
  const selectedCount = plan.items.filter((item) => item.state === 'SELECTED').length
  const selectedSlugs = [...new Set(plan.items.filter((item) => item.state === 'SELECTED').map((item) => item.audienceSlug))]
  const missingAudienceNames = selectedSlugs
    .filter((slug) => !(audiences.find((audience) => audience.slug === slug)?.destinations.length || audiences.find((audience) => audience.slug === slug)?.destinationGroupIds.length))
    .map((slug) => audienceLabel(audiences.find((audience) => audience.slug === slug) ?? { slug, name: '' }))
  const destinationNames = [...new Set(selectedSlugs.flatMap((slug) => planAudienceContext(plan, slug, audiences).destinations.map((group) => group.groupName)))]
  const campaignStartTime = smartCampaignStart(plan, plan.startDate)
  const canAdvance = canAdvanceSmartPlan(plan, now)
  const reviewAction = (name: NonNullable<typeof confirming>) => { confirmationRevision.current = plan.revision; setActionError(''); setConfirming(name) }
  const scheduleLines = selectedSlugs.flatMap((slug) => {
    const audience = audiences.find((entry) => entry.slug === slug)
    const context = planAudienceContext(plan, slug, audiences)
    const zone = context.policy?.timezone ?? plan.timezone ?? 'America/Sao_Paulo'
    const audienceItems = plan.items.filter((item) => item.state === 'SELECTED' && item.audienceSlug === slug)
    return [...new Set(audienceItems.map((item) => item.date))].sort().map((date) => {
      const dated = audienceItems.filter((item) => item.date === date)
      const groups = context.destinations.map((destination) => destination.groupName).join(', ') || 'sem grupo vinculado'
      const reserved = reservedSmartStart(plan, slug, date, zone)
      const start = reserved ? `primeira reserva ${formatDateTime(reserved, zone)}` : `início ${smartCampaignStart(plan, date)}`
      return `${audience ? audienceLabel(audience) : NICHE_STYLES[slug].label} · ${groups} · ${formatDate(date)} · ${start} (${zone}; ${dated.length} produtos)`
    })
  })
  const approvalDescription = `${selectedCount} produto(s), ${selectedSlugs.length} público(s). Início em ${formatDate(plan.startDate)}: ${campaignStartTime}.\n\nAgenda por público e grupo:\n${scheduleLines.map((line) => `• ${line}`).join('\n')}\n\nDestinos: ${destinationNames.join(', ') || 'nenhum grupo vinculado'}.\n\n${plan.settings?.global?.startNow ? 'Ao confirmar, os envios de hoje podem começar antes das 09:00, no próximo minuto disponível. Os outros dias mantêm o horário configurado. ' : ''}Os horários respeitam os intervalos e limites salvos neste plano. Um produto só será enviado uma vez por grupo nesta campanha; campanhas diferentes podem enviar o mesmo produto. Ao confirmar, os envios pelo WhatsApp começam conforme a agenda.`
  return (
    <Card className="smart-plan-actions mt-5 border-accent/30">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><p className="font-semibold">{planStatusLabel(plan.status)}</p><p className="text-xs text-muted">{plan.status === 'FAILED' && !analysisFailure ? 'O histórico desta execução foi preservado. Use uma coleta atualizada para montar um novo plano.' : 'A aprovação reserva os horários e inicia a execução na janela configurada.'}</p></div>
        <div className="flex flex-wrap gap-2" aria-busy={mutation.isPending}>
          {(plan.status === 'REVIEW' || plan.status === 'READY' || plan.status === 'DRAFT') && <Button onClick={() => reviewAction('approve')} disabled={mutation.isPending || draftsPending || selectedCount === 0 || missingAudienceNames.length > 0}><Send size={16} /> Revisar e aprovar campanha</Button>}
          {(plan.status === 'APPROVED' || plan.status === 'SCHEDULED' || plan.status === 'RUNNING') && <Button variant="secondary" onClick={() => action('pause')} disabled={mutation.isPending}><Pause size={16} /> Pausar</Button>}
          {canAdvance && <Button onClick={() => reviewAction('advance')} disabled={mutation.isPending || draftsPending}><Play size={16} />Adiantar envios de hoje</Button>}
          {plan.status === 'PAUSED' && !hasFailedSend && <Button onClick={() => reviewAction('resume')} disabled={mutation.isPending || hasUnknownSend || hasInFlightSend || destinationDrift || draftsPending}><Play size={16} />{recoveryReason === 'binding-change' ? 'Revisar retomada do vínculo original' : 'Revisar e retomar'}</Button>}
          {analysisFailure && <Button onClick={() => action('retry')} disabled={mutation.isPending || aiBlocked}><RotateCcw size={16} /> Usar IA: repetir análise</Button>}
          {((plan.status === 'FAILED' && !analysisFailure) || hasFailedSend) && <Button variant="secondary" onClick={onCreateFresh}><FileJson size={16} /> Criar plano com coleta atualizada</Button>}
          {!['COMPLETED', 'CANCELLED', 'FAILED'].includes(plan.status) && <Button variant="danger" onClick={() => reviewAction('cancel')} disabled={mutation.isPending || hasUnknownSend || hasInFlightSend}><Square size={15} /> Revisar cancelamento</Button>}
        </div>
      </div>
      {mutation.isPending && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted"><Spinner />Aplicando ação ao plano…</p>}
      {draftsPending && <p role="status" className="mt-3 text-sm text-warning">Salve ou descarte as edições dos públicos, mensagens e horário antes de liberar envios.</p>}
      {(hasUnknownSend || hasInFlightSend) && <p role="status" className="mt-3 text-sm text-warning">{hasUnknownSend ? 'Resolva os envios a confirmar abaixo.' : 'Aguarde o envio em andamento.'} A retomada e o cancelamento ficam bloqueados enquanto a entrega não estiver resolvida.</p>}
      {plan.status === 'PAUSED' && (recoveryReason || destinationDrift) && <div role="status" className="mt-3 space-y-2 border-t border-line pt-3 text-sm text-warning">
        <p>{destinationDrift || recoveryReason === 'binding-change' ? 'O último bloqueio indica mudança de conta ou destino. Este plano não pode ser aprovado novamente nem transferido para outro vínculo. Restaure a conta e os grupos originais antes de revisar a retomada.' : 'O último bloqueio indica conexão temporariamente indisponível. Reconecte a mesma conta e mantenha os grupos originais antes de revisar a retomada.'}</p>
        <p>Para usar outro vínculo, resolva primeiro envios incertos ou em andamento, cancele os pendentes e crie uma nova proposta somente com os produtos comprovadamente não entregues. Uma nova coleta não exclui os produtos já enviados automaticamente.</p>
      </div>}
      {(selectedCount === 0 || missingAudienceNames.length > 0) && (plan.status === 'REVIEW' || plan.status === 'READY' || plan.status === 'DRAFT') && <div role="status" className="mt-3 space-y-1 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
        {selectedCount === 0 && <p>Nenhum produto selecionado. Mude itens da reserva para selecionados depois de revisar os critérios.</p>}
        {missingAudienceNames.length > 0 && <p>Vincule e salve um grupo de WhatsApp para: {missingAudienceNames.join(', ')}.</p>}
      </div>}
      {confirming && <CampaignConfirmDialog
        title={confirming === 'approve' ? 'Confirmar agenda e envios?' : confirming === 'advance' ? 'Adiantar os envios de hoje?' : confirming === 'resume' ? 'Retomar os envios deste plano?' : 'Cancelar este plano?'}
        description={confirming === 'approve' ? approvalDescription : `${selectedCount} produto(s), ${selectedSlugs.length} público(s). Início em ${formatDate(plan.startDate)}.\n\nDestinos registrados: ${destinationNames.join(', ') || 'nenhum grupo vinculado'}.\n\n${confirming === 'advance' ? 'Os envios pendentes de hoje começarão no próximo minuto disponível, inclusive antes das 09:00. Os intervalos, limites e verificações de entrega continuam ativos. Mensagens já enviadas e agendas de outros dias não serão alteradas.' : confirming === 'cancel' ? 'Os próximos envios serão cancelados. Mensagens já enviadas ou iniciadas não podem ser desfeitas.' : 'Confirme apenas se a conta e os grupos originais estiverem restaurados. O servidor verificará o vínculo antes de retomar os envios pendentes; esta ação não troca os destinos. Os horários e limites salvos neste plano continuam valendo.'}`}
        confirmLabel={confirming === 'approve' ? (plan.settings?.global?.startNow ? 'Confirmar e iniciar hoje' : 'Confirmar e agendar') : confirming === 'advance' ? 'Adiantar e iniciar hoje' : confirming === 'resume' ? 'Retomar envios' : 'Cancelar plano'}
        danger={confirming === 'cancel'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => { const next = confirming; setConfirming(null); action(next, undefined, confirmationRevision.current) }}
      />}
      {mutation.isError && mutation.variables?.action === 'retry'
        ? <div className="mt-3"><ErrorState message={apiErrorMessage(mutation.error)} retry={() => action('retry', mutation.variables)} /></div>
        : mutation.isError && <p role="alert" className="mt-3 text-xs text-danger">{apiErrorMessage(mutation.error)}</p>}
      {actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}
    </Card>
  )
}

function PlanHistory({ plans, selectedId, onSelect }: { plans: SmartPlan[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (plans.length === 0) return <EmptyState title="Nenhum plano criado">Depois da primeira importação, análises e campanhas agendadas aparecerão aqui.</EmptyState>
  return (
    <div className="space-y-3">
      {plans.map((plan) => (
        <button type="button" key={plan.id} onClick={() => onSelect(plan.id)} className={`w-full rounded-2xl border bg-surface p-4 text-left shadow-sm transition hover:border-accent/30 ${selectedId === plan.id ? 'border-accent/30 ring-2 ring-accent/20' : 'border-line'}`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="flex flex-wrap items-center gap-2"><strong>Plano de {formatDate(plan.startDate)}</strong><Badge tone={statusTone(plan.status)}>{planStatusLabel(plan.status)}</Badge></div><p className="mt-1 text-xs text-muted">{plan.days} dia(s) · {plan.audienceSlugs.map((slug) => NICHE_STYLES[slug].label).join(', ')} · atualizado {formatDateTime(plan.updatedAt)}</p></div>
            <ChevronRight className="shrink-0 text-subtle" size={18} />
          </div>
          {plan.progress?.total ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (plan.progress.completed / plan.progress.total) * 100)}%` }} /></div> : null}
        </button>
      ))}
    </div>
  )
}

export default function SmartCampaignsPage() {
  const [searchParams] = useSearchParams()
  const [stage, setStage] = useState<Stage>('audiences')
  const stagesRef = useRef<HTMLElement>(null)
  useEffect(() => { stagesRef.current?.querySelector('[aria-current=step]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [stage])
  const [planDate, setPlanDate] = useState(today())
  const [selectedAudiences, setSelectedAudiences] = useState<Set<SmartAudienceSlug>>(new Set())
  const [selectionInitialized, setSelectionInitialized] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  useEffect(() => {
    const planId = searchParams.get('plan')
    if (planId) { setSelectedPlanId(planId); setStage('review') }
  }, [searchParams])
  const [nextPlanId, setNextPlanId] = useState<string | null>(null)
  const [dirtyParts, setDirtyParts] = useState<Record<string, boolean>>({})
  const reportDirty = useCallback<DirtyChange>((key, dirty) => setDirtyParts((current) => current[key] === dirty ? current : { ...current, [key]: dirty }), [])
  const dirty = Object.values(dirtyParts).some(Boolean)
  const audienceDirty = Object.entries(dirtyParts).some(([key, value]) => key.startsWith('audience:') && value)
  const { prompt } = useUnsavedChanges(dirty, 'Há configurações, arquivos ou textos não salvos nas campanhas inteligentes. Continue editando para preservá-los.')
  const queryClient = useQueryClient()
  const aiStatusQuery = useQuery({ queryKey: ['smart-ai-status'], queryFn: smartCampaignApi.aiStatus, retry: false, staleTime: 60_000 })
  const audiencesQuery = useQuery({ queryKey: ['smart-audiences'], queryFn: smartCampaignApi.audiences })
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => groupApi.list() })
  const plansQuery = useQuery({
    queryKey: ['smart-plans'], queryFn: smartCampaignApi.plans,
    refetchInterval: (query) => {
      const statuses = query.state.data?.map((plan) => plan.status) ?? []
      if (statuses.includes('ANALYZING')) return planPollInterval('ANALYZING')
      if (statuses.includes('RUNNING')) return planPollInterval('RUNNING')
      return statuses.some((status) => status === 'APPROVED' || status === 'SCHEDULED') ? planPollInterval('SCHEDULED') : false
    },
  })
  const detailQuery = useQuery({
    queryKey: ['smart-plan', selectedPlanId], queryFn: () => smartCampaignApi.plan(selectedPlanId as string), enabled: Boolean(selectedPlanId),
    refetchInterval: (query) => planPollInterval(query.state.data?.status),
  })
  const audiences = audiencesQuery.data ?? []
  const defaultAudienceSelection = useMemo(() => new Set((audiencesQuery.data ?? []).filter((audience) => audience.enabled).map((audience) => audience.slug)), [audiencesQuery.data])
  const workflowSelection = new Set([...(selectionInitialized ? selectedAudiences : defaultAudienceSelection)].filter((slug) => defaultAudienceSelection.has(slug)))
  const selectAudiences = (next: Set<SmartAudienceSlug>) => { setSelectedAudiences(next); setSelectionInitialized(true) }
  const activePlan = detailQuery.data
  const aiBlocked = aiStatusQuery.isLoading || aiUnavailable(aiStatusQuery.data) || audienceDirty || !!dirtyParts.review || !!dirtyParts['plan-action']
  const handlePlan = (plan: SmartPlan) => { setSelectedPlanId(plan.id); queryClient.setQueryData(['smart-plan', plan.id], plan) }
  const onCreated = (plan: SmartPlan) => { handlePlan(plan); setStage('review') }
  const openPlan = (id: string) => {
    if (id !== selectedPlanId && (dirtyParts['plan-action'] || dirtyParts['resolution-pending'])) return
    if (id !== selectedPlanId && dirtyParts.review) { setNextPlanId(id); return }
    setSelectedPlanId(id); setStage('review')
  }
  const currentIndex = STAGES.findIndex((item) => item.id === stage)
  return <div className="workspace-page smart-workspace max-w-6xl pb-8">
    {prompt}
    <header className="page-header smart-page-header">
      <div className="relative z-1 min-w-0"><h1 className="page-title">Campanhas inteligentes</h1><p className="page-description">Prepare ofertas para cada público, revise a agenda e acompanhe os envios.</p></div>
      <BrandPattern variant="header" className="smart-header-pattern" />
      <Button variant="secondary" onClick={() => setStage('monitor')}><History size={16} />Ver planos</Button>
    </header>
    <AIStatusBanner status={aiStatusQuery.data} error={aiStatusQuery.error} />
    <nav ref={stagesRef} aria-label="Etapas da campanha" className="smart-stages mb-5 overflow-x-auto rounded-xl border border-line bg-surface p-2">
      <AnimatedSelection value={stage}>{(indicator) => <div className="flex min-w-max gap-1">{STAGES.map(({ id, label, icon: Icon }, index) => <button type="button" key={id} onClick={() => setStage(id)} aria-current={stage === id ? 'step' : undefined} className={`relative flex min-h-12 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${stage === id ? 'text-accent' : 'text-muted hover:bg-surface-muted'}`}>{indicator(id)}<span className="relative z-1 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md border border-current/20 text-xs tabular-nums">{index + 1}</span><Icon size={16} aria-hidden="true" />{label}</span></button>)}</div>}</AnimatedSelection>
    </nav>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>Etapa {currentIndex + 1} de {STAGES.length} · {STAGES[currentIndex].label}</span><span role="status">{dirty ? 'Há alterações pendentes. Você pode alternar entre as etapas.' : 'Cada etapa fica disponível para consulta.'}</span></div>
    {audienceDirty && stage !== 'audiences' && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"><p>Salve as regras dos públicos antes de usar IA ou liberar envios.</p><Button variant="secondary" onClick={() => setStage('audiences')}>Revisar públicos</Button></div>}
    {audiencesQuery.isLoading && <div role="status" className="surface-panel flex items-center gap-3 p-6 text-sm text-muted"><Spinner />Carregando públicos…</div>}
    {audiencesQuery.isError && <ErrorState message={apiErrorMessage(audiencesQuery.error)} retry={() => { void audiencesQuery.refetch() }} />}
    {groupsQuery.isError && <div className="mb-4"><ErrorState message={`Não foi possível carregar os grupos: ${apiErrorMessage(groupsQuery.error)}`} retry={() => { void groupsQuery.refetch() }} /></div>}
    {audiencesQuery.data && <>
      <div hidden={stage !== 'audiences'}><AudienceSetup audiences={audiences} groups={groupsQuery.data ?? []} onDirtyChange={reportDirty} /></div>
      <div hidden={stage !== 'keywords'}><KeywordPlanner audiences={audiences} selected={workflowSelection} setSelected={selectAudiences} planDate={planDate} setPlanDate={setPlanDate} aiBlocked={aiBlocked} onDirtyChange={reportDirty} /></div>
      <div hidden={stage !== 'import'}><ImportPlanner audiences={audiences} selected={workflowSelection} setSelected={selectAudiences} planDate={planDate} setPlanDate={setPlanDate} onCreated={onCreated} aiStatus={aiStatusQuery.data} aiBlocked={aiBlocked} onDirtyChange={reportDirty} /></div>
    </>}
    {!!dirtyParts.review && stage !== 'review' && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft p-3 text-sm text-warning"><p>Há introduções especiais não salvas no plano aberto.</p><Button variant="secondary" onClick={() => setStage('review')}>Revisar textos</Button></div>}
    <div hidden={stage !== 'review'}>
      {!selectedPlanId && <div className="space-y-4"><EmptyState title="Escolha um plano para revisar">Abra um plano salvo ou importe uma coleta para preparar sua primeira análise.</EmptyState><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setStage('monitor')}><History size={16} />Abrir planos</Button><Button onClick={() => setStage('import')}><Upload size={16} />Importar coleta</Button></div></div>}
      {selectedPlanId && detailQuery.isLoading && <Card className="flex items-center gap-3"><Spinner />Carregando plano…</Card>}
      {detailQuery.isError && <ErrorState message={apiErrorMessage(detailQuery.error)} retry={() => { void detailQuery.refetch() }} />}
      {selectedPlanId && <div className="mb-4 flex justify-end"><Button variant="ghost" loading={detailQuery.isFetching} loadingText="Atualizando…" onClick={() => { void detailQuery.refetch() }}><RefreshCw size={15} />Atualizar plano</Button></div>}
      {activePlan && <PlanReview key={activePlan.id} plan={activePlan} audiences={audiences} actions={<PlanActions key={`actions:${activePlan.id}`} plan={activePlan} audiences={audiences} onPlanChange={handlePlan} onCreateFresh={() => setStage('import')} aiBlocked={aiBlocked} draftsPending={audienceDirty || !!dirtyParts.review} onDirtyChange={reportDirty} />} onPlanChange={handlePlan} onDirtyChange={reportDirty} />}
    </div>
    <section hidden={stage !== 'monitor'} aria-labelledby="history-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 id="history-title" className="section-heading">Planos e envios</h2><p className="page-description">Consulte análises, aprovações, pausas e resultados.</p></div><Button variant="secondary" onClick={() => { void plansQuery.refetch() }} loading={plansQuery.isFetching} loadingText="Atualizando…"><RefreshCw size={15} />Atualizar</Button></div>
      {plansQuery.isLoading && <Card className="flex items-center gap-3"><Spinner />Carregando histórico…</Card>}
      {plansQuery.isError && <ErrorState message={apiErrorMessage(plansQuery.error)} retry={() => { void plansQuery.refetch() }} />}
      {plansQuery.data && <PlanHistory plans={plansQuery.data} selectedId={selectedPlanId} onSelect={openPlan} />}
    </section>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><Button variant="ghost" onClick={() => setStage(STAGES[currentIndex - 1].id)} disabled={currentIndex === 0}><ArrowLeft size={16} />Etapa anterior</Button>{currentIndex < STAGES.length - 1 && <Button variant="secondary" onClick={() => setStage(STAGES[currentIndex + 1].id)}>Próxima etapa<ChevronRight size={16} /></Button>}</div>
    {nextPlanId && <CampaignConfirmDialog title="Abrir outro plano?" description="Há textos não salvos neste plano. Ao abrir outro, essas edições serão descartadas." confirmLabel="Descartar e abrir" onCancel={() => setNextPlanId(null)} onConfirm={() => { if (dirtyParts['plan-action']) return; reportDirty('review', false); setSelectedPlanId(nextPlanId); setNextPlanId(null); setStage('review') }} />}
  </div>
}
