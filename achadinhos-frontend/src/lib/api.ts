import axios from 'axios'

/** Same-origin in dev via Vite proxy; set VITE_API_BASE for a separate host. */
const baseURL = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

const TOKEN_KEY = 'achadinhos_token'

/**
 * Bearer-token fallback for browsers that block the cross-site cookie even with
 * CHIPS/Partitioned. Stored in sessionStorage (per-tab, cleared on tab close)
 * rather than localStorage to shrink the XSS exposure window. The httpOnly,
 * Partitioned session cookie remains the primary, JS-invisible mechanism.
 */
export function setAuthToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // sessionStorage unavailable — cookie auth still applies.
  }
}

export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const api = axios.create({
  baseURL,
  withCredentials: true,
})

// Attach the stored token as a Bearer header on every request. The backend
// accepts either the httpOnly cookie or this header, so auth survives even when
// third-party cookies are blocked.
api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
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
  savedProductId?: number
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
  category?: 'A' | 'B' | 'C' | 'D'
  relevanceScore?: number
  discountPercent?: number
  commissionRate?: number
  /** Snapshot of the classifier configuration used for this result. */
  classificationProfileId?: string
  classificationProfileName?: string
}

export interface ClassificationProfileWeights {
  relevance: number
  discount: number
  commission: number
}

export interface ClassificationProfileThresholds {
  aScore: number
  aRelevance: number
  aDiscount: number
  aCommission: number
  bScore: number
  bRelevance: number
  cScore: number
  dRelevance: number
}

export interface ClassificationProfile {
  id: string
  name: string
  nicheDescription: string
  relevanceInstructions: string
  weights: ClassificationProfileWeights
  discountCap: number
  commissionCap: number
  thresholds: ClassificationProfileThresholds
  builtIn: boolean
}

export type ClassificationProfileInput = Omit<ClassificationProfile, 'id' | 'builtIn'>

/** Matches the identity keys returned by /campaigns/check-offers. */
export function offerIdentity(offer: Pick<Offer, 'savedProductId' | 'source' | 'productId' | 'affiliateUrl'>): string {
  return offer.savedProductId
    ? `saved:${offer.savedProductId}`
    : offer.productId?.trim()
    ? offer.source?.trim()
      ? JSON.stringify([offer.source.trim().toLowerCase(), offer.productId.trim()])
      : offer.productId.trim()
    : offer.affiliateUrl.trim()
}

export interface SavedProduct {
  id: number
  offer: Offer
  manualOverrides?: string[]
  groupIds: number[]
  classifications: Record<string, SavedProductClassification>
  createdAt: string
  updatedAt: string
}

export interface SavedProductClassification {
  category: 'A' | 'B' | 'C' | 'D'
  relevanceScore?: number
  profileName: string
  discountPercent?: number
  commissionRate?: number
  classifiedAt: string
}

export interface ProductGroup {
  id: number
  name: string
  isDefault: boolean
  productCount: number
  createdAt: string
  updatedAt: string
}

type SavedProductEditableField =
  | 'title'
  | 'description'
  | 'category'
  | 'discountedPrice'
  | 'originalPrice'
  | 'discountPercent'
  | 'commissionRate'
  | 'commissionPercent'
  | 'commissioned'
  | 'coupon'
  | 'affiliateUrl'
  | 'imageUrl'

export type SavedProductOfferPatch = {
  [K in SavedProductEditableField]?: Offer[K] | null
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
  shuffleOffers: boolean
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
  /** Explicit opt-in: resend pairs already SENT on this connection. */
  allowResend: boolean
  status: CampaignStatus
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  totalSent: number
  totalFailed: number
  totalSkipped: number
  createdAt: string
  editable: boolean
  /** RUNNING but its process died (deploy/crash) — can be resumed. */
  stalled?: boolean
}

export interface CampaignProgress {
  status: CampaignStatus
  totalPlanned: number
  sent: number
  failed: number
  skipped: number
  remaining: number
  /** Raw successful sends including resends (optional for older backends). */
  totalSends?: number
  /** Extra sends beyond the first per pair. */
  resends?: number
  lastSentAt: string | null
  nextSendEtaMinAt: string | null
  nextSendEtaMaxAt: string | null
  estimatedCompletionAt: string | null
  stalled: boolean
  avgIntervalSeconds: number
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
  groups: OfferGroupDelivery[]
  sentGroupIds: string[]
  sendingGroupIds: string[]
  eligibleGroupIds: string[]
}

export interface OfferGroupDelivery {
  groupId: string
  groupName: string
  status: 'sent' | 'sending' | 'unsent'
  sentCount: number
  lastSentAt: string | null
  inActiveCampaign: boolean
  activeCampaignNames: string[]
  claimStatus: 'sent' | 'sending' | 'unconfirmed' | null
  claimCreatedAt: string | null
  claimCampaignId: number | null
  recoverable: boolean
}

export interface ImportResult {
  source: string
  totalSeen: number
  offers: Offer[]
  errors: { index: number; message: string }[]
  previews: OfferPreview[]
  categorization?: {
    method: 'jev' | 'fallback'
    counts: Record<'A' | 'B' | 'C' | 'D', number>
    profile: Pick<ClassificationProfile, 'id' | 'name'>
  }
}

export type AdTimingMode = 'fixed' | 'beat'
export type AdColorPreset = 'natural' | 'vibrant' | 'warm' | 'cool' | 'none'
export type AdFramingMode = 'cover' | 'contain-blur' | 'contain-solid'
export type AdAssetKind = 'clip' | 'music'
export type AdRenderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AdClipSpeed = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2
export type AdTransitionPreset = 'cut' | 'fade' | 'dissolve' | 'slide-left' | 'slide-up' | 'zoom'
export type AdTransitionSfx = 'none' | 'whoosh' | 'pop' | 'click'
export type AdVisualEffectsPreset = 'natural' | 'clean-product' | 'warm-ugc' | 'vivid' | 'cinematic' | 'custom'

export interface AdClipEdit {
  trimStart: number
  trimEnd: number | null
  speed: AdClipSpeed
  framingOverride: boolean
  focusX: number
  focusY: number
  zoom: number
}

export interface AdTransitionConfig {
  preset: AdTransitionPreset
  durationSeconds: number
  sfx: AdTransitionSfx
  sfxVolume: number
}

export interface AdVisualEffectsConfig {
  preset: AdVisualEffectsPreset
  brightness: number
  contrast: number
  saturation: number
  sharpness: number
  temperature: number
  vignette: number
  grain: number
  glow: number
}

export interface AdHookConfig {
  enabled: boolean
  clipAssetId: number | null
  durationSeconds: number
  text: string
}

export interface AdMusicTrack {
  assetId: number
  volume: number
  startSeconds: number
  endSeconds: number | null
  sourceStartSeconds: number
  fadeInSeconds: number
  fadeOutSeconds: number
}

export interface AdProjectConfig {
  variationCount: number
  texts: string[]
  selectedClipIds: number[]
  clipEdits: Record<string, AdClipEdit>
  musicAssetId: number | null
  musicVolume: number
  musicTracks: AdMusicTrack[]
  timing: { mode: 'fixed'; seconds: number } | { mode: 'beat' }
  transition: AdTransitionConfig
  output: {
    width: number
    height: number
    durationSeconds: number
    fps: 24 | 25 | 30
  }
  framing: {
    mode: AdFramingMode
    focusX: number
    focusY: number
    backgroundColor: string
  }
  colorPreset: AdColorPreset
  visualEffects: AdVisualEffectsConfig
  hook: AdHookConfig
  textStyle: {
    fontSize: number
    positionY: number
    fontColor: string
    borderColor: string
    borderWidth: number
  }
}

export interface AdAsset {
  id: number
  kind: AdAssetKind
  originalName: string
  mimeType: string
  sizeBytes: number
  durationSeconds: number
  width: number | null
  height: number | null
  contentUrl: string
  createdAt: string
}

export interface AdRenderOutput {
  index: number
  fileName: string
  sizeBytes: number
  durationSeconds: number
  seed: string
  cutTimes: number[]
  clipAssetIds: number[]
  textOrder: string[]
  downloadUrl: string
  /** Missing on renders created before timing provenance was recorded. */
  timingSource?: 'beat' | 'fixed' | 'fallback'
}

export interface AdRenderJob {
  id: number
  projectId: number
  status: AdRenderStatus
  progress: number
  error: string | null
  config: AdProjectConfig
  outputs: AdRenderOutput[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

interface AdProjectBase {
  id: number
  name: string
  config: AdProjectConfig
  createdAt: string
  updatedAt: string
}

export interface AdProjectSummary extends AdProjectBase {
  assetCount: number
  latestJob: AdRenderJob | null
}

export interface AdProject extends AdProjectBase {
  assets: AdAsset[]
  latestJobs: AdRenderJob[]
}

export type AdProjectInput = Pick<AdProject, 'name' | 'config'>

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
    const res = await api.post('/auth/login', { email, password })
    const token = (res.data as { token?: string }).token
    if (token) setAuthToken(token)
    return (res.data as { data: AuthUser }).data
  },
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      setAuthToken(null)
    }
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
  async attachExisting(params: {
    baseUrl: string
    instanceToken: string
    instanceId?: string
  }): Promise<ConnectionState> {
    return unwrap<ConnectionState>(await api.post('/connection/attach', params))
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
    opts?: { source?: string; template?: string; classificationProfileId?: string },
  ): Promise<ImportResult> {
    return unwrap<ImportResult>(
      await api.post('/campaigns/import-offers', {
        json,
        source: opts?.source,
        template: opts?.template,
        classificationProfileId: opts?.classificationProfileId,
      }),
    )
  },
  async preview(offers: Offer[], template?: string): Promise<OfferPreview[]> {
    return unwrap<OfferPreview[]>(await api.post('/campaigns/preview', { offers, template }))
  },
  async checkOffers(
    offers: Pick<Offer, 'savedProductId' | 'source' | 'productId' | 'affiliateUrl'>[],
    groupIds?: string[],
  ): Promise<Record<string, OfferFlag>> {
    return unwrap<Record<string, OfferFlag>>(
      await api.post('/campaigns/check-offers', { offers, ...(groupIds ? { groupIds } : {}) }),
    )
  },
  async checkOffersBatched(
    offers: Pick<Offer, 'savedProductId' | 'source' | 'productId' | 'affiliateUrl'>[],
    groupIds?: string[],
  ): Promise<Record<string, OfferFlag>> {
    const batches: Array<Promise<Record<string, OfferFlag>>> = []
    for (let offset = 0; offset < offers.length; offset += 100) {
      batches.push(this.checkOffers(offers.slice(offset, offset + 100), groupIds))
    }
    return Object.assign({}, ...(await Promise.all(batches)))
  },
  async resolveDeliveryClaim(
    identity:
      | { savedProductId: number }
      | { offer: Pick<Offer, 'source' | 'productId' | 'affiliateUrl'> },
    groupId: string,
    resolution: 'sent' | 'retry',
  ): Promise<{ savedProductId: number | null; groupId: string; status: 'sent' | 'unsent' }> {
    return unwrap<{ savedProductId: number | null; groupId: string; status: 'sent' | 'unsent' }>(
      await api.post('/campaigns/delivery-claims/resolve', { ...identity, groupId, resolution }),
    )
  },
  async create(payload: {
    name: string
    offers: Offer[]
    groups: { id: string; name: string }[]
    safety: Safety
    messageTemplate?: string
    sendImages?: boolean
    allowResend?: boolean
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
      allowResend: boolean
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
  async progress(id: number): Promise<CampaignProgress> {
    return unwrap<CampaignProgress>(await api.get(`/campaigns/${id}/progress`))
  },
  async removeOffer(id: number, affiliateUrl: string): Promise<Campaign> {
    return unwrap<Campaign>(await api.delete(`/campaigns/${id}/offers`, { data: { affiliateUrl } }))
  },
}

export const classificationProfileApi = {
  async list(): Promise<ClassificationProfile[]> {
    return unwrap<ClassificationProfile[]>(await api.get('/classification-profiles'))
  },
  async create(profile: ClassificationProfileInput): Promise<ClassificationProfile> {
    return unwrap<ClassificationProfile>(await api.post('/classification-profiles', profile))
  },
  async update(id: string, profile: ClassificationProfileInput): Promise<ClassificationProfile> {
    return unwrap<ClassificationProfile>(await api.put(`/classification-profiles/${encodeURIComponent(id)}`, profile))
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/classification-profiles/${encodeURIComponent(id)}`)
  },
}

export const savedProductApi = {
  async list(limit = 100, offset = 0): Promise<{ items: SavedProduct[]; total: number }> {
    return unwrap<{ items: SavedProduct[]; total: number }>(
      await api.get('/saved-products', { params: { limit, offset } }),
    )
  },
  async save(offers: Offer[]): Promise<{ saved: SavedProduct[]; created: number; updated: number }> {
    return unwrap<{ saved: SavedProduct[]; created: number; updated: number }>(
      await api.post('/saved-products', { offers }),
    )
  },
  async update(id: number, offer: SavedProductOfferPatch, classificationProfileId?: string): Promise<SavedProduct> {
    return unwrap<SavedProduct>(await api.patch(`/saved-products/${id}`, {
      offer,
      ...(classificationProfileId ? { classificationProfileId } : {}),
    }))
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/saved-products/${id}`)
  },
}

function adMediaUrl(path: string): string {
  const base = baseURL.replace(/\/$/, '')
  return `${base}${path}`
}

export interface AdCaptionArtwork {
  text: string
  svg: string
}

export const adProjectApi = {
  async previewSfx(preset: Exclude<AdTransitionSfx, 'none'>): Promise<ArrayBuffer> {
    return (await api.get<ArrayBuffer>(`/ad-projects/preview/sfx/${preset}`, { responseType: 'arraybuffer' })).data
  },
  async previewTiming(projectId: number, config: AdProjectConfig, signal?: AbortSignal): Promise<{
    cuts: number[]
    timingSource: 'beat' | 'fixed' | 'fallback'
  }> {
    return unwrap(await api.post(`/ad-projects/${encodeURIComponent(projectId)}/preview/timing`, { config }, { signal }))
  },
  async previewCaptions(
    input: { texts: string[]; output: Pick<AdProjectConfig['output'], 'width' | 'height'>; textStyle: AdProjectConfig['textStyle'] },
    signal?: AbortSignal,
  ): Promise<AdCaptionArtwork[]> {
    return unwrap<{ captions: AdCaptionArtwork[] }>(
      await api.post('/ad-projects/preview/captions', input, { signal }),
    ).captions
  },
  async list(): Promise<AdProjectSummary[]> {
    return unwrap<AdProjectSummary[]>(await api.get('/ad-projects'))
  },
  async create(input: AdProjectInput): Promise<AdProject> {
    return unwrap<AdProject>(await api.post('/ad-projects', input))
  },
  async get(id: number): Promise<AdProject> {
    return unwrap<AdProject>(await api.get(`/ad-projects/${encodeURIComponent(id)}`))
  },
  async update(id: number, input: Partial<AdProjectInput>): Promise<AdProject> {
    return unwrap<AdProject>(await api.patch(`/ad-projects/${encodeURIComponent(id)}`, input))
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/ad-projects/${encodeURIComponent(id)}`)
  },
  async duplicate(id: number): Promise<AdProject> {
    return unwrap<AdProject>(await api.post(`/ad-projects/${encodeURIComponent(id)}/duplicate`))
  },
  async uploadAssets(id: number, kind: AdAssetKind, files: File[]): Promise<AdAsset[]> {
    const body = new FormData()
    body.append('kind', kind)
    for (const file of files) body.append('files', file)
    return unwrap<AdAsset[]>(await api.post(`/ad-projects/${encodeURIComponent(id)}/assets`, body))
  },
  async importMusic(id: number, url: string): Promise<{ asset: AdAsset; project: AdProject }> {
    return unwrap<{ asset: AdAsset; project: AdProject }>(await api.post(`/ad-projects/${encodeURIComponent(id)}/music/import`, {
      url,
      confirmRights: true,
    }))
  },
  async removeAsset(projectId: number, assetId: number): Promise<void> {
    await api.delete(`/ad-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`)
  },
  assetContentUrl(projectId: number, assetId: number): string {
    return adMediaUrl(`/ad-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/content`)
  },
  async assetContent(projectId: number, assetId: number): Promise<Blob> {
    const response = await api.get(
      `/ad-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/content`,
      { responseType: 'blob' },
    )
    return response.data as Blob
  },
  async listJobs(projectId: number): Promise<AdRenderJob[]> {
    return unwrap<AdRenderJob[]>(await api.get(`/ad-projects/${encodeURIComponent(projectId)}/render-jobs`))
  },
  async render(projectId: number, config?: AdProjectConfig): Promise<AdRenderJob> {
    return unwrap<AdRenderJob>(await api.post(`/ad-projects/${encodeURIComponent(projectId)}/render-jobs`, config ? { config } : {}))
  },
  async getJob(projectId: number, jobId: number): Promise<AdRenderJob> {
    return unwrap<AdRenderJob>(await api.get(`/ad-projects/${encodeURIComponent(projectId)}/render-jobs/${encodeURIComponent(jobId)}`))
  },
  async cancelJob(projectId: number, jobId: number): Promise<AdRenderJob> {
    return unwrap<AdRenderJob>(await api.post(`/ad-projects/${encodeURIComponent(projectId)}/render-jobs/${encodeURIComponent(jobId)}/cancel`))
  },
  outputUrl(projectId: number, jobId: number, outputIndex: number): string {
    return adMediaUrl(`/ad-projects/${encodeURIComponent(projectId)}/render-jobs/${encodeURIComponent(jobId)}/outputs/${outputIndex}`)
  },
  async outputContent(projectId: number, jobId: number, outputIndex: number): Promise<Blob> {
    const response = await api.get(
      `/ad-projects/${encodeURIComponent(projectId)}/render-jobs/${encodeURIComponent(jobId)}/outputs/${outputIndex}`,
      { responseType: 'blob' },
    )
    return response.data as Blob
  },
}
