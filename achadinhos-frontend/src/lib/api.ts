import axios from 'axios'

/** Same-origin in dev via Vite proxy; set VITE_API_BASE for a separate host. */
const baseURL = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

export const api = axios.create({
  baseURL,
  withCredentials: true,
})

// ── Types ───────────────────────────────────────────
export interface AuthUser {
  id: number
  uuid: string
  name: string
  email: string
  role: 'ADMIN' | 'MEMBER'
}

export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'WAITING_QR'
  | 'WAITING_PHONE_CODE'
  | 'CONNECTED'

export interface ConnectionState {
  id: number
  uuid: string
  status: ConnectionStatus
  phoneNumber: string | null
  qrCode: string | null
  pairingCode: string | null
  lastConnectedAt: string | null
}

export interface Group {
  id: string
  name: string
  size: number
  announceOnly: boolean
}

export interface WebhookInfo {
  configuredUrl: string | null
  expectedUrl: string | null
  enabled: boolean
  matches: boolean
  apiBaseUrlConfigured: boolean
}

export interface Offer {
  title: string
  originalPrice?: number
  discountedPrice: number
  currency?: string
  description?: string
  affiliateUrl: string
  imageUrl?: string
  coupon?: string
  installmentLabel?: string
  commissionPercent?: string
  productId?: string
  source?: string
  commissioned?: boolean
}

export interface Ingestor {
  id: string
  label: string
}

export interface TemplatePlaceholder {
  key: string
  label: string
}

export interface CampaignMeta {
  ingestors: Ingestor[]
  placeholders: TemplatePlaceholder[]
  defaultTemplate: string
}

export interface Safety {
  minDelaySeconds: number
  maxDelaySeconds: number
  shuffleGroups: boolean
  maxPerHour: number
  warmupBatchSize: number
  warmupPauseFactor: number
}

export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export interface Campaign {
  id: number
  uuid: string
  name: string
  offers: Offer[]
  groups: { id: string; name: string }[]
  safety: Safety
  messageTemplate: string | null
  sendImages: boolean
  status: CampaignStatus
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  totalSent: number
  totalFailed: number
  createdAt: string
  editable: boolean
}

export interface CampaignLog {
  id: number
  campaignId: number
  groupId: string
  groupName: string
  offerTitle: string
  success: boolean
  messageId: string | null
  error: string | null
  sentAt: string
}

export interface OfferPreview {
  title: string
  message: string
}

export interface OfferFlag {
  alreadySent: boolean
  sentCount: number
  lastSentAt: string | null
  sampleGroup: string | null
  inActiveCampaign: boolean
  activeCampaignNames: string[]
}

export interface ImportResult {
  source: string
  totalSeen: number
  offers: Offer[]
  errors: { index: number; message: string }[]
  previews: OfferPreview[]
}

// ── Envelope helpers ────────────────────────────────
interface Envelope<T> {
  success: boolean
  data: T
  total?: number
}

function unwrap<T>(res: { data: Envelope<T> }): T {
  return res.data.data
}

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (
      (error.response?.data as { error?: { message?: string } })?.error?.message ??
      error.message
    )
  }
  return error instanceof Error ? error.message : 'Erro desconhecido'
}

// ── Auth ────────────────────────────────────────────
export const authApi = {
  async login(email: string, password: string): Promise<AuthUser> {
    return unwrap<AuthUser>(await api.post('/auth/login', { email, password }))
  },
  async logout(): Promise<void> {
    await api.post('/auth/logout')
  },
  async me(): Promise<AuthUser> {
    return unwrap<AuthUser>(await api.get('/auth/me'))
  },
  async register(name: string, email: string, password: string): Promise<AuthUser> {
    return unwrap<AuthUser>(await api.post('/auth/register', { name, email, password }))
  },
}

// ── Connection ──────────────────────────────────────
export const connectionApi = {
  async status(): Promise<ConnectionState> {
    return unwrap<ConnectionState>(await api.get('/connection'))
  },
  async connect(pairingPhoneNumber?: string): Promise<ConnectionState> {
    return unwrap<ConnectionState>(
      await api.post('/connection/connect', pairingPhoneNumber ? { pairingPhoneNumber } : {}),
    )
  },
  async disconnect(): Promise<void> {
    await api.post('/connection/disconnect')
  },
  async webhookInfo(): Promise<WebhookInfo> {
    return unwrap<WebhookInfo>(await api.get('/connection/webhook'))
  },
  async updateWebhook(): Promise<{ url: string }> {
    return unwrap<{ url: string }>(await api.post('/connection/webhook'))
  },
}

// ── Groups ──────────────────────────────────────────
export const groupApi = {
  async list(search?: string): Promise<Group[]> {
    return unwrap<Group[]>(await api.get('/groups', { params: search ? { search } : {} }))
  },
}

// ── Campaigns ───────────────────────────────────────
export const campaignApi = {
  async meta(): Promise<CampaignMeta> {
    return unwrap<CampaignMeta>(await api.get('/campaigns/meta'))
  },
  async importOffers(
    json: string | unknown,
    opts?: { source?: string; template?: string },
  ): Promise<ImportResult> {
    return unwrap<ImportResult>(
      await api.post('/campaigns/import-offers', {
        json,
        source: opts?.source,
        template: opts?.template,
      }),
    )
  },
  async preview(offers: Offer[], template?: string): Promise<OfferPreview[]> {
    return unwrap<OfferPreview[]>(await api.post('/campaigns/preview', { offers, template }))
  },
  async checkOffers(
    offers: { productId?: string; affiliateUrl: string }[],
  ): Promise<Record<string, OfferFlag>> {
    return unwrap<Record<string, OfferFlag>>(await api.post('/campaigns/check-offers', { offers }))
  },
  async create(payload: {
    name: string
    offers: Offer[]
    groups: { id: string; name: string }[]
    safety: Safety
    messageTemplate?: string
    sendImages?: boolean
    scheduledAt?: string
  }): Promise<Campaign> {
    return unwrap<Campaign>(await api.post('/campaigns', payload))
  },
  async run(id: number): Promise<Campaign> {
    return unwrap<Campaign>(await api.post(`/campaigns/${id}/run`))
  },
  async update(
    id: number,
    patch: Partial<{
      name: string
      offers: Offer[]
      groups: { id: string; name: string }[]
      safety: Safety
      messageTemplate: string | null
      sendImages: boolean
      scheduledAt: string | null
    }>,
  ): Promise<Campaign> {
    return unwrap<Campaign>(await api.patch(`/campaigns/${id}`, patch))
  },
  async pause(id: number): Promise<Campaign> {
    return unwrap<Campaign>(await api.post(`/campaigns/${id}/pause`))
  },
  async resume(id: number): Promise<Campaign> {
    return unwrap<Campaign>(await api.post(`/campaigns/${id}/resume`))
  },
  async cancel(id: number): Promise<Campaign> {
    return unwrap<Campaign>(await api.post(`/campaigns/${id}/cancel`))
  },
  async list(): Promise<{ items: Campaign[]; total: number }> {
    const res = await api.get('/campaigns')
    return { items: res.data.data as Campaign[], total: res.data.total as number }
  },
  async get(id: number): Promise<Campaign> {
    return unwrap<Campaign>(await api.get(`/campaigns/${id}`))
  },
  async logs(id: number): Promise<CampaignLog[]> {
    return unwrap<CampaignLog[]>(await api.get(`/campaigns/${id}/logs`))
  },
}
