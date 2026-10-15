import { api } from './api'

export const SMART_AUDIENCE_SLUGS = ['DOMESTICA', 'MASCULINO', 'NATAL', 'PESCA', 'PET'] as const
export type SmartAudienceSlug = (typeof SMART_AUDIENCE_SLUGS)[number]

export interface SmartAudienceProfile {
  instructions: string
  keywords: string[]
  negativeKeywords: string[]
}

export interface SmartAudienceDestination {
  groupId: string
  groupName: string
}

export interface SmartAudiencePolicy {
  dailyCap: number
  startTime: string
  endTime: string
  minGapSeconds: number
  maxGapSeconds: number
  maxStandouts: number
  freshnessHours: number
  timezone: string
}

export interface SmartAudience {
  id?: string | number
  slug: SmartAudienceSlug
  name: string
  description: string
  enabled: boolean
  active?: boolean
  profileId?: string | null
  destinationGroupIds: string[]
  destinations: SmartAudienceDestination[]
  profile: SmartAudienceProfile
  policy: SmartAudiencePolicy
  dailyCap: number
  startTime: string
  endTime: string
  minIntervalMinutes: number
  maxIntervalMinutes: number
  minCommissionPercent?: number | null
  minEstimatedCommission?: number | null
  maxStandoutMessages: number
  createdAt?: string
  updatedAt?: string
}

export interface KeywordPhrase {
  keyword: string
  kind?: 'EVERGREEN' | 'SEASONAL' | 'EXPERIMENTAL' | string
  reason?: string
}

export interface SmartKeywordPack {
  audienceSlug: SmartAudienceSlug
  name?: string
  keywords: string[]
  reason?: string
  mode?: 'ANY' | 'ALL'
  minCommissionPercent?: number
  minEstimatedCommission?: number
  phrases?: KeywordPhrase[]
  batches?: string[][]
  calendarContext?: string[]
}

export interface SmartKeywordResponse {
  date: string
  packs: SmartKeywordPack[]
}

export interface SmartAIStatus {
  enabled: boolean
  configured: boolean
  model: string | null
  limits: {
    dailyCostUsd: number
    globalDailyCostUsd?: number
    requestCostUsd: number
    dailyRequests: number
    batchSize: number
  }
}

export type SmartPlanStatus =
  | 'ANALYZING'
  | 'REVIEW'
  | 'READY'
  | 'DRAFT'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type SmartPlanItemState = 'SELECTED' | 'RESERVE' | 'REJECTED'

export interface SmartPlanProduct {
  title: string
  imageUrl?: string
  discountedPrice: number
  originalPrice?: number
  commissionRate?: number
  commissionPercent?: string
  affiliateUrl?: string
  source?: string
  productId?: string
  extensionEvidence?: {
    visibleSignals?: {
      rating?: number
      soldCount?: number
      soldCountIsLowerBound?: boolean
    }
  }
}

export interface SmartPlanScores {
  total?: number
  audienceFit?: number
  offerValue?: number
  commissionOpportunity?: number
  seasonalFit?: number
  freshness?: number
  assortment?: number
}

export interface SmartPlanItem {
  id: string
  key?: string
  audienceSlug: SmartAudienceSlug
  date: string
  sendDate?: string
  state: SmartPlanItemState
  selected?: boolean
  reserve?: boolean
  product: SmartPlanProduct
  offer?: SmartPlanProduct
  score: number
  scores?: SmartPlanScores
  fitScore?: number
  estimatedCommission?: number
  freshnessHours?: number
  reason: string
  category?: string
  rejectionReasons?: string[]
  warnings?: string[]
  scheduledAt?: string | null
  standout?: boolean
  customMessage?: string | null
  messageIntro?: string | null
  pinned?: boolean
}

export interface SmartPlanProgress {
  phase?: 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'FAILED' | string
  completed: number
  total: number
  failed?: number
  message?: string
}

export interface SmartPlanSummary {
  selected?: number
  reserve?: number
  rejected?: number
  scheduled?: number
}

export interface SmartPlanSend {
  id: string
  audienceSlug: SmartAudienceSlug
  groupId: string
  groupName: string
  offerTitle?: string
  status: 'PENDING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED' | 'UNKNOWN'
  scheduledAt: string
  sentAt?: string | null
  attempts: number
  lastError?: string | null
  unknownSince?: string | null
  resolutionAvailableAt?: string | null
}

export type SmartSendResolution = 'sent' | 'retry' | 'skip'

export interface SmartSendResolutionResult {
  id: string
  status: SmartPlanSend['status']
  scheduledAt: string
  sentAt?: string | null
}

export interface SmartPlan {
  id: string
  uuid?: string
  status: SmartPlanStatus
  revision: number
  startDate: string
  date?: string
  days: number
  timezone?: string
  audienceSlugs: SmartAudienceSlug[]
  progress?: SmartPlanProgress | null
  inputSummary?: { total?: number; valid?: number; duplicates?: number; warnings?: number }
  items: SmartPlanItem[]
  warnings?: string[]
  summary?: SmartPlanSummary
  sendSummary?: Record<string, number>
  sends?: SmartPlanSend[]
  error?: string | null
  approvedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface SmartPlanItemPatch {
  id: string
  state?: SmartPlanItemState
  audienceSlug?: SmartAudienceSlug
  date?: string
  scheduledAt?: string | null
  standout?: boolean
  customMessage?: string | null
  pinned?: boolean
}

export interface SmartImportPayload {
  name: string
  json: unknown
  source?: string
  targetAudienceSlug?: SmartAudienceSlug
}

export type SmartCreatePlanInput = {
  requestId: string
  date: string
  days: number
  audienceSlugs: SmartAudienceSlug[]
} & (
  | { rawJson: string; payloads?: never }
  | { rawJson?: never; payloads: SmartImportPayload[] }
)

interface Envelope<T> { data: T }

function canonicalSlug(slug: string): SmartAudienceSlug {
  return slug.toUpperCase() as SmartAudienceSlug
}

function unwrap<T>(response: { data: Envelope<T> | T }): T {
  const body = response.data
  return body && typeof body === 'object' && 'data' in body
    ? (body as Envelope<T>).data
    : body as T
}

function normalizeAudience(audience: SmartAudience): SmartAudience {
  const policy = audience.policy ?? {} as SmartAudiencePolicy
  return {
    ...audience,
    slug: canonicalSlug(audience.slug),
    enabled: audience.enabled ?? audience.active ?? false,
    destinationGroupIds: audience.destinationGroupIds ?? audience.destinations?.map((item) => item.groupId) ?? [],
    destinations: audience.destinations ?? [],
    profile: audience.profile ?? { instructions: '', keywords: [], negativeKeywords: [] },
    policy,
    dailyCap: audience.dailyCap ?? policy.dailyCap ?? 50,
    startTime: audience.startTime ?? policy.startTime ?? '09:00',
    endTime: audience.endTime ?? policy.endTime ?? '21:00',
    minIntervalMinutes: audience.minIntervalMinutes ?? Math.round((policy.minGapSeconds ?? 720) / 60),
    maxIntervalMinutes: audience.maxIntervalMinutes ?? Math.round((policy.maxGapSeconds ?? 960) / 60),
    maxStandoutMessages: audience.maxStandoutMessages ?? policy.maxStandouts ?? 3,
  }
}

function normalizeItem(item: SmartPlanItem): SmartPlanItem {
  const state = item.state ?? (item.selected ? 'SELECTED' : item.reserve ? 'RESERVE' : 'REJECTED')
  return {
    ...item,
    audienceSlug: canonicalSlug(item.audienceSlug),
    id: item.id ?? item.key ?? '',
    date: item.date ?? item.sendDate ?? '',
    state,
    product: item.product ?? item.offer ?? { title: 'Produto', discountedPrice: 0 },
    score: item.score ?? item.scores?.total ?? 0,
    fitScore: item.fitScore ?? item.scores?.audienceFit,
    reason: item.reason ?? item.rejectionReasons?.join(' · ') ?? '',
    customMessage: item.customMessage ?? item.messageIntro,
  }
}

function normalizePlan(plan: SmartPlan): SmartPlan {
  return {
    ...plan,
    id: plan.id ?? plan.uuid ?? '',
    startDate: plan.startDate ?? plan.date ?? '',
    audienceSlugs: (plan.audienceSlugs ?? []).map(canonicalSlug),
    items: (plan.items ?? []).map(normalizeItem),
    sends: plan.sends?.map((send) => ({ ...send, audienceSlug: canonicalSlug(send.audienceSlug) })),
  }
}

export const smartCampaignApi = {
  async aiStatus(): Promise<SmartAIStatus> {
    return unwrap<SmartAIStatus>(await api.get('/smart-campaigns/ai-status'))
  },
  async audiences(): Promise<SmartAudience[]> {
    const result = unwrap<SmartAudience[]>(await api.get('/smart-campaigns/audiences'))
    return result.map(normalizeAudience)
  },
  async updateAudience(slug: SmartAudienceSlug, input: Partial<SmartAudience>): Promise<SmartAudience> {
    return normalizeAudience(unwrap<SmartAudience>(await api.put(`/smart-campaigns/audiences/${slug}`, input)))
  },
  async keywords(input: { requestId: string; date: string; audienceSlugs: SmartAudienceSlug[] }): Promise<SmartKeywordResponse> {
    const result = unwrap<SmartKeywordResponse>(await api.post('/smart-campaigns/keywords', input))
    return {
      ...result,
      packs: result.packs.map((pack) => ({
        ...pack,
        audienceSlug: canonicalSlug(pack.audienceSlug ?? (pack as SmartKeywordPack & { slug?: string }).slug ?? ''),
      })),
    }
  },
  async createPlan(input: SmartCreatePlanInput): Promise<SmartPlan> {
    return normalizePlan(unwrap<SmartPlan>(await api.post('/smart-campaigns/plans', input)))
  },
  async plans(): Promise<SmartPlan[]> {
    const result = unwrap<SmartPlan[] | { items: SmartPlan[] }>(await api.get('/smart-campaigns/plans'))
    return (Array.isArray(result) ? result : result.items).map(normalizePlan)
  },
  async plan(id: string): Promise<SmartPlan> {
    return normalizePlan(unwrap<SmartPlan>(await api.get(`/smart-campaigns/plans/${id}`)))
  },
  async updatePlan(id: string, revision: number, items: SmartPlanItemPatch[]): Promise<SmartPlan> {
    return normalizePlan(unwrap<SmartPlan>(await api.patch(`/smart-campaigns/plans/${id}`, { revision, items })))
  },
  async action(id: string, action: 'approve' | 'pause' | 'resume' | 'cancel' | 'retry', revision?: number, requestId?: string): Promise<SmartPlan> {
    return normalizePlan(unwrap<SmartPlan>(await api.post(`/smart-campaigns/plans/${id}/${action}`, { revision, requestId })))
  },
  async resolveSend(id: string, resolution: SmartSendResolution): Promise<SmartSendResolutionResult> {
    return unwrap<SmartSendResolutionResult>(
      await api.post(`/smart-campaigns/sends/${id}/resolve`, { resolution }),
    )
  },
}

export function planStatusLabel(status: SmartPlanStatus): string {
  return ({
    ANALYZING: 'Analisando', REVIEW: 'Pronta para revisão', READY: 'Pronta para revisão', DRAFT: 'Rascunho',
    APPROVED: 'Aprovado', SCHEDULED: 'Agendado', RUNNING: 'Enviando', PAUSED: 'Pausado',
    COMPLETED: 'Concluído', FAILED: 'Falhou', CANCELLED: 'Cancelado',
  } satisfies Record<SmartPlanStatus, string>)[status]
}

export function canPollPlan(status?: SmartPlanStatus): boolean {
  return status === 'ANALYZING' || status === 'APPROVED' || status === 'SCHEDULED' || status === 'RUNNING'
}

