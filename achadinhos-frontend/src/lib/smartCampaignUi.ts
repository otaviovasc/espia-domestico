import type { SmartAudience, SmartAudienceSlug } from './smartCampaignApi'

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
    // Explicit null clears an existing minimum; undefined would disappear from JSON.
    minCommissionPercent: audience.minCommissionPercent ?? null,
    minEstimatedCommission: audience.minEstimatedCommission ?? null,
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
  if (input.minCommissionPercent !== null && (!Number.isFinite(input.minCommissionPercent) || input.minCommissionPercent < 0 || input.minCommissionPercent > 100)) return 'A comissão mínima deve ficar entre 0 e 100%.'
  if (input.minEstimatedCommission !== null && (!Number.isFinite(input.minEstimatedCommission) || input.minEstimatedCommission < 0 || input.minEstimatedCommission > 1_000_000)) return 'Revise o valor da comissão estimada mínima.'
  return null
}

export function validPlanDate(value: string, minimum: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < minimum) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
