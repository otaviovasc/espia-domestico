import type { SmartAudience, SmartAudiencePolicy, SmartAudienceSlug, SmartPlan, SmartPlanSend } from './smartCampaignApi'

/** Suggest a source audience; the operator can review it before analysis. */
export function inferFileAudience(name: string, selected: Set<SmartAudienceSlug>, audiences: SmartAudience[]): SmartAudienceSlug | undefined {
  if (selected.size === 1) return [...selected][0]
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
  const normalizedName = normalize(name)
  const matches = audiences.filter((audience) => {
    if (!selected.has(audience.slug)) return false
    const labels = [audience.slug, audience.name].map(normalize)
    return labels.some((label) => label.length > 3 && normalizedName.includes(label)) || new RegExp(`(^|[^a-z])${audience.slug.toLowerCase()}([^a-z]|$)`).test(normalizedName)
  })
  return matches.length === 1 ? matches[0].slug : undefined
}

export function countFileOffers(value: unknown): number | null {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['offers', 'products', 'items', 'produtos', 'ofertas', 'data', 'cards']) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).length
  }
  return null
}

export function splitAudienceTerms(text: string): string[] {
  return text.split(',').map((term) => term.trim()).filter(Boolean)
}

/** Only editable values belong in the baseline; read-only query metadata can change. */
export function audienceInput(audience: SmartAudience, keywords: string, negativeKeywords: string) {
  return {
    enabled: audience.enabled,
    destinationGroupIds: [...audience.destinationGroupIds].sort(),
    profile: { ...audience.profile, keywords: splitAudienceTerms(keywords), negativeKeywords: splitAudienceTerms(negativeKeywords) },
    dailyCap: audience.dailyCap,
    startTime: audience.startTime,
    endTime: audience.endTime,
    minIntervalMinutes: audience.minIntervalMinutes,
    maxIntervalMinutes: audience.maxIntervalMinutes,
    excludePolitical: audience.excludePolitical ?? audience.policy?.excludePolitical ?? false,
    minPrice: audience.minPrice !== undefined ? audience.minPrice : audience.policy?.minPrice ?? null,
    maxPrice: audience.maxPrice !== undefined ? audience.maxPrice : audience.policy?.maxPrice ?? null,
    // Explicit null clears an existing minimum; undefined would disappear from JSON.
    minCommissionPercent: audience.minCommissionPercent !== undefined ? audience.minCommissionPercent : audience.policy?.minCommissionPercent ?? null,
    minEstimatedCommission: audience.minEstimatedCommission !== undefined ? audience.minEstimatedCommission : audience.policy?.minEstimatedCommission ?? null,
    maxStandoutMessages: audience.maxStandoutMessages,
  }
}

export function audienceValidation(input: ReturnType<typeof audienceInput>): string | null {
  if (input.enabled && input.destinationGroupIds.length === 0) return 'Selecione pelo menos um grupo para ativar este público.'
  if (input.destinationGroupIds.length > 20) return 'Selecione no máximo 20 grupos por público.'
  if (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > 50) return 'O limite diário deve ficar entre 1 e 50 produtos.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime) || input.endTime <= '09:00' || input.endTime > '21:00') return 'Escolha o encerramento depois das 09:00 e até as 21:00.'
  if (![input.minIntervalMinutes, input.maxIntervalMinutes].every((value) => Number.isInteger(value) && value >= 12 && value <= 16) || input.minIntervalMinutes > input.maxIntervalMinutes) return 'Use intervalos de 12 a 16 minutos, com o máximo maior ou igual ao mínimo.'
  if (!Number.isInteger(input.maxStandoutMessages) || input.maxStandoutMessages < 0 || input.maxStandoutMessages > 10) return 'Escolha de 0 a 10 destaques por dia.'
  if (input.profile.instructions.trim().length < 20 || input.profile.instructions.trim().length > 2000) return 'Descreva o público em 20 a 2.000 caracteres.'
  if (input.profile.keywords.length === 0 || input.profile.keywords.length > 20 || input.profile.negativeKeywords.length > 20 || [...input.profile.keywords, ...input.profile.negativeKeywords].some((term) => term.length < 2 || term.length > 80)) return 'Use até 20 termos por lista, com 2 a 80 caracteres cada. Inclua pelo menos um termo-base.'
    if ([input.minPrice, input.maxPrice].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return 'Os preços devem ser valores em reais maiores ou iguais a zero.'
    if (input.minPrice !== null && input.maxPrice !== null && input.minPrice > input.maxPrice) return 'O preço máximo deve ser maior ou igual ao preço mínimo.'
  if (input.minCommissionPercent !== null && (!Number.isFinite(input.minCommissionPercent) || input.minCommissionPercent < 0 || input.minCommissionPercent > 100)) return 'A comissão mínima deve ficar entre 0 e 100%.'
  if (input.minEstimatedCommission !== null && (!Number.isFinite(input.minEstimatedCommission) || input.minEstimatedCommission < 0 || input.minEstimatedCommission > 1_000_000)) return 'Revise o valor da comissão estimada mínima.'
  return null
}

export function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/** Calendar dates must use the same timezone on both sides of a comparison. */
export function smartLocalDate(value: Date = new Date(), timeZone = 'America/Sao_Paulo'): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function campaignTimingValidation(time: string, startNow: boolean, date: string, currentDate: string, endTime = '21:00'): string | null {
  if (startNow && date !== currentDate) return 'O início ao aprovar só está disponível para hoje. Desmarque a opção ou escolha a data de hoje.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || time < '09:00' || time >= endTime) return `Escolha um início a partir das 09:00 e antes das ${endTime}.`
  return null
}

export function canAdvanceSmartPlan(plan: SmartPlan, now = new Date()): boolean {
  if (plan.status !== 'SCHEDULED' || ['UNKNOWN', 'FAILED', 'SENDING'].some((status) => (plan.sendSummary?.[status] ?? 0) > 0 || plan.sends?.some((send) => send.status === status))) return false
  const date = smartLocalDate(now, plan.timezone)
  return plan.sends?.some((send) => send.status === 'PENDING' && Date.parse(send.scheduledAt) > now.getTime()
    && (send.localDate ?? smartLocalDate(new Date(send.scheduledAt), plan.timezone)) === date) ?? false
}

export function nextSmartDelivery(plan: SmartPlan): SmartPlanSend | undefined {
  return plan.sends?.filter((send) => (send.status === 'PENDING' || send.status === 'SENDING') && Number.isFinite(Date.parse(send.scheduledAt)))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0]
}

export function smartCampaignStart(plan: SmartPlan, date: string): string {
  const timing = plan.settings?.global
  if (timing?.earlyStart?.date === date && /^([01]\d|2[0-3]):[0-5]\d$/.test(timing.earlyStart.time)) return timing.earlyStart.time
  if (timing?.startNow && date === plan.startDate && ['REVIEW', 'READY', 'DRAFT'].includes(plan.status)) return 'ao aprovar hoje'
  return timing?.campaignStartTime ?? '09:00'
}

export function reservedSmartStart(plan: SmartPlan, slug: SmartAudienceSlug, date: string, timeZone = plan.timezone): string | undefined {
  const sends = plan.sends?.filter((send) => send.audienceSlug === slug && Number.isFinite(Date.parse(send.scheduledAt))
    && (send.localDate ?? smartLocalDate(new Date(send.scheduledAt), send.timezone ?? timeZone)) === date) ?? []
  const times = sends.length ? sends.map((send) => send.scheduledAt) : plan.items
    .filter((item) => item.audienceSlug === slug && item.date === date && item.state === 'SELECTED').map((item) => item.scheduledAt)
  return times.filter((time): time is string => !!time && Number.isFinite(Date.parse(time))).sort((a, b) => Date.parse(a) - Date.parse(b))[0]
}

export function planAudienceContext(plan: SmartPlan, slug: SmartAudienceSlug, audiences: SmartAudience[]) {
  const audience = audiences.find((entry) => entry.slug === slug)
  const frozen = plan.settings?.audiencePolicies?.[slug] ?? plan.settings?.audiences?.[slug]
  const sends = plan.sends?.filter((send) => send.audienceSlug === slug) ?? []
  const destinationsFrozen = !!plan.sends?.length
  const destinations = destinationsFrozen
    ? [...new Map(sends.map((send) => [send.groupId, { groupId: send.groupId, groupName: send.groupName }])).values()]
    : audience?.destinations.length ? audience.destinations : (audience?.destinationGroupIds ?? []).map((groupId) => ({ groupId, groupName: groupId }))
  const currentIds = [...(audience?.destinationGroupIds ?? [])].sort().join('\n')
  const savedIds = destinations.map((group) => group.groupId).sort().join('\n')
  const policyFingerprint = (policy?: SmartAudiencePolicy) => JSON.stringify([
    policy?.dailyCap, policy?.startTime, policy?.endTime, policy?.minGapSeconds, policy?.maxGapSeconds,
    policy?.maxStandouts, policy?.freshnessHours, policy?.timezone, policy?.excludePolitical ?? false,
    policy?.minPrice ?? null, policy?.maxPrice ?? null, policy?.minCommissionPercent ?? null, policy?.minEstimatedCommission ?? null,
  ])
  return {
    policy: frozen ?? audience?.policy,
    policyFrozen: !!frozen,
    destinations,
    destinationsFrozen,
    drift: (!!frozen && policyFingerprint(frozen) !== policyFingerprint(audience?.policy)) || (destinationsFrozen && savedIds !== currentIds),
  }
}

export function safeAffiliateUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

/** Quote every cell and neutralize formula prefixes, including hidden leading whitespace. */
export function smartCsvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function smartDeliveriesCsv(plan: SmartPlan): string {
  const rows: unknown[][] = [['Plano', 'Versão', 'Envio', 'Público', 'Grupo ID', 'Grupo', 'Produto', 'Situação', 'Agendado (ISO)', 'Fuso', 'Enviado (ISO)', 'Tentativas', 'Erro completo']]
  for (const send of plan.sends ?? []) rows.push([plan.id, plan.revision, send.id, send.audienceSlug, send.groupId, send.groupName, send.offerTitle, send.status, send.scheduledAt, send.timezone ?? plan.timezone, send.sentAt, send.attempts, send.lastError])
  return '\uFEFF' + rows.map((row) => row.map(smartCsvCell).join(';')).join('\r\n')
}

export function validPlanDate(value: string, minimum: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < minimum) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
