import axios, { AxiosInstance, AxiosError } from 'axios'
import { injectable } from 'tsyringe'
import { AppError, InternalError } from '@/middleware/Error/AppError'
import { logger } from '@/utils/logger'
import { env } from '@/config/env'

// ===========================================
// TYPES
// ===========================================

/** Per-instance credentials. baseUrl + instance token. */
export interface UazapiInstanceCredentials {
  baseUrl: string
  token: string
}

export interface UazapiInstance {
  id?: string
  token?: string
  status?: 'disconnected' | 'connecting' | 'connected' | 'hibernated'
  name?: string
  profileName?: string
  profilePicUrl?: string
  paircode?: string
  qrcode?: string
  owner?: string
}

export interface UazapiCreateInstanceResponse {
  response?: string
  instance?: UazapiInstance
  token?: string
  connected?: boolean
  loggedIn?: boolean
  name?: string
  info?: string
  status?: { connected?: boolean; loggedIn?: boolean; jid?: unknown }
}

export interface UazapiConnectResponse {
  instance?: UazapiInstance
  qrcode?: string
  paircode?: string
  connected?: boolean
  response?: string
}

export interface UazapiStatusResponse {
  instance?: UazapiInstance & { paircode?: string; qrcode?: string; owner?: string }
  status?: {
    connected: boolean
    loggedIn: boolean
    jid?: { user?: string; server?: string } | null
  }
}

export interface UazapiSendResponse {
  id?: string
  messageid?: string
  messageId?: string
  chatid?: string
  status?: string
  [key: string]: unknown
}

/** Group object returned by POST /group/list. */
export interface UazapiGroup {
  /** Group JID, ends with @g.us */
  JID?: string
  jid?: string
  id?: string
  Name?: string
  name?: string
  subject?: string
  /** Participant count, when returned */
  Size?: number
  size?: number
  participantsCount?: number
  IsAnnounce?: boolean
  isAnnounce?: boolean
  /** True when only admins can post; broadcasters must be admins */
  announce?: boolean
  [key: string]: unknown
}

export interface UazapiListGroupsResponse {
  groups?: UazapiGroup[]
  Groups?: UazapiGroup[]
  [key: string]: unknown
}

const UAZAPI_TIMEOUT_MS = 30_000

/** Redact a token for safe logging — keeps first 4 chars for correlation. */
export const redactUazapiToken = (token?: string): string =>
  token ? `${token.slice(0, 4)}…[redacted]` : '[absent]'

/**
 * Validate an Uazapi base URL. Must be http(s); path/query are stripped.
 * Prevents tokens from being sent to arbitrary/malformed hosts.
 */
export const normalizeUazapiBaseUrl = (baseUrl: string): string => {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new AppError(`Invalid Uazapi baseUrl: "${baseUrl}"`, 400, 'UAZAPI_INVALID_BASE_URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(
      `Invalid Uazapi baseUrl protocol: "${url.protocol}" (expected http/https)`,
      400,
      'UAZAPI_INVALID_BASE_URL',
    )
  }
  return url.origin
}

/**
 * Uazapi HTTP client.
 *
 * Auth:
 * - Admin operations (create instance) use the `admintoken` header with the
 *   account-wide UAZAPI_ADMIN_TOKEN env var (backend only).
 * - Instance operations (connect, status, send, groups) use the `token` header
 *   with the per-instance token.
 *
 * Tokens are never logged; errors are normalized to AppError with redacted
 * details. Uazapi returns HTTP 200 with `{"error":true,...}` on some failures,
 * so the body is always checked.
 */
@injectable()
export class UazapiClient {
  private buildInstanceClient(creds: UazapiInstanceCredentials): AxiosInstance {
    return axios.create({
      baseURL: normalizeUazapiBaseUrl(creds.baseUrl),
      timeout: UAZAPI_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', token: creds.token },
    })
  }

  private buildAdminClient(baseUrl: string): AxiosInstance {
    const adminToken = env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_ADMIN_TOKEN
    if (!adminToken) {
      throw InternalError('UAZAPI_ADMIN_TOKEN is not configured')
    }
    return axios.create({
      baseURL: normalizeUazapiBaseUrl(baseUrl),
      timeout: UAZAPI_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', admintoken: adminToken },
    })
  }

  private ensureOk(operation: string, data: unknown, token?: string): void {
    if (data && typeof data === 'object' && (data as { error?: unknown }).error === true) {
      const rawMessage =
        (data as { message?: unknown }).message || (data as { response?: unknown }).response
      const providerMessage =
        typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)
      const safeMessage = token
        ? providerMessage.split(token).join(redactUazapiToken(token))
        : providerMessage
      const message = `Uazapi ${operation} failed: ${safeMessage}`
      logger.warn({ operation }, message)
      throw new AppError(message, 502, 'UAZAPI_ERROR')
    }
  }

  private handleError(operation: string, error: unknown, token?: string): never {
    const redact = (text: string): string =>
      token ? text.split(token).join(redactUazapiToken(token)) : text

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: string; message?: string; response?: string }>
      const status = axiosError.response?.status
      const providerMessage =
        axiosError.response?.data?.error ||
        axiosError.response?.data?.message ||
        axiosError.response?.data?.response ||
        axiosError.message
      const safeMessage = redact(`Uazapi ${operation} failed: ${providerMessage}`)
      logger.warn(
        { operation, status, baseUrl: axiosError.config?.baseURL, path: axiosError.config?.url },
        safeMessage,
      )
      if (status && status >= 400 && status < 600) {
        throw new AppError(safeMessage, status, 'UAZAPI_ERROR')
      }
      throw InternalError(safeMessage)
    }
    const message = redact(`Uazapi ${operation} failed: ${(error as Error)?.message || 'unknown'}`)
    logger.error({ operation }, message)
    throw InternalError(message)
  }

  // ===========================================
  // ADMIN OPERATIONS (admintoken header)
  // ===========================================

  /** Create a new Uazapi instance. Admin operation. */
  async createInstance(
    baseUrl: string,
    params: { name: string; adminField01?: string; adminField02?: string },
  ): Promise<UazapiCreateInstanceResponse> {
    const client = this.buildAdminClient(baseUrl)
    try {
      const { data } = await client.post<UazapiCreateInstanceResponse>('/instance/create', params)
      this.ensureOk('createInstance', data, env.UAZAPI_ADMIN_TOKEN)
      return data
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('createInstance', error, env.UAZAPI_ADMIN_TOKEN)
    }
  }

  /** Delete the instance permanently. Admin operation (DELETE /instance with { id }). */
  async deleteInstance(creds: UazapiInstanceCredentials, instanceId: string): Promise<void> {
    const client = this.buildAdminClient(creds.baseUrl)
    try {
      const { data } = await client.delete('/instance', { data: { id: instanceId } })
      this.ensureOk('deleteInstance', data, env.UAZAPI_ADMIN_TOKEN)
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('deleteInstance', error, env.UAZAPI_ADMIN_TOKEN)
    }
  }

  // ===========================================
  // INSTANCE LIFECYCLE (token header)
  // ===========================================

  /** Start a connection cycle. Pass `phone` for a pairing code, omit for QR code. */
  async connect(creds: UazapiInstanceCredentials, phone?: string): Promise<UazapiConnectResponse> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post<UazapiConnectResponse>(
        '/instance/connect',
        phone ? { phone } : {},
      )
      this.ensureOk('connect', data, creds.token)
      return data
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('connect', error, creds.token)
    }
  }

  async getStatus(creds: UazapiInstanceCredentials): Promise<UazapiStatusResponse> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.get<UazapiStatusResponse>('/instance/status')
      this.ensureOk('getStatus', data, creds.token)
      return data
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('getStatus', error, creds.token)
    }
  }

  async disconnect(creds: UazapiInstanceCredentials): Promise<void> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post('/instance/disconnect')
      this.ensureOk('disconnect', data, creds.token)
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('disconnect', error, creds.token)
    }
  }

  /** List webhooks currently configured on the instance (GET /webhook). */
  async getWebhooks(
    creds: UazapiInstanceCredentials,
  ): Promise<Array<{ id?: string; url?: string; events?: string[]; enabled?: boolean }>> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.get('/webhook')
      this.ensureOk('getWebhooks', data, creds.token)
      if (Array.isArray(data)) return data
      if (data && typeof data === 'object' && Array.isArray((data as { webhooks?: unknown }).webhooks)) {
        return (data as { webhooks: Array<{ id?: string; url?: string; events?: string[]; enabled?: boolean }> })
          .webhooks
      }
      return []
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('getWebhooks', error, creds.token)
    }
  }

  /** Configure the instance webhook (creates when id omitted). */
  async setWebhook(
    creds: UazapiInstanceCredentials,
    params: { url: string; events?: string[]; excludeMessages?: string[]; enabled?: boolean },
  ): Promise<void> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post('/webhook', {
        url: params.url,
        events: params.events ?? ['connection'],
        excludeMessages: params.excludeMessages ?? ['wasSentByApi'],
        enabled: params.enabled ?? true,
        addUrlEvents: false,
        addUrlTypesMessages: false,
      })
      this.ensureOk('setWebhook', data, creds.token)
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('setWebhook', error, creds.token)
    }
  }

  // ===========================================
  // GROUPS (token header)
  // ===========================================

  /**
   * List the WhatsApp groups the connected number belongs to.
   * POST /group/list { limit, offset, noParticipants } -> { groups: [...] }.
   * Group JIDs end in @g.us and are used directly as the `number` when sending.
   */
  async listGroups(
    creds: UazapiInstanceCredentials,
    params: { limit?: number; offset?: number; noParticipants?: boolean } = {},
  ): Promise<UazapiGroup[]> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post<UazapiListGroupsResponse>('/group/list', {
        limit: params.limit ?? 200,
        offset: params.offset ?? 0,
        noParticipants: params.noParticipants ?? true,
      })
      this.ensureOk('listGroups', data, creds.token)
      const groups = data.groups || data.Groups || []
      return Array.isArray(groups) ? groups : []
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('listGroups', error, creds.token)
    }
  }

  /** Get details for a single group. POST /group/info { groupjid }. */
  async groupInfo(
    creds: UazapiInstanceCredentials,
    groupJid: string,
  ): Promise<UazapiGroup> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post<UazapiGroup>('/group/info', { groupjid: groupJid })
      this.ensureOk('groupInfo', data, creds.token)
      return data
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('groupInfo', error, creds.token)
    }
  }

  // ===========================================
  // MESSAGING (token header)
  // ===========================================

  /**
   * Send a text message. `number` accepts a group JID (…@g.us) directly.
   * `delay` is a client-side delay hint (ms) understood by Uazapi; `async`
   * queues the send in the instance's message queue.
   */
  async sendText(
    creds: UazapiInstanceCredentials,
    params: { number: string; text: string; delay?: number; async?: boolean; linkPreview?: boolean },
  ): Promise<UazapiSendResponse> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post<UazapiSendResponse>('/send/text', {
        number: params.number,
        text: params.text,
        ...(params.delay !== undefined ? { delay: params.delay } : {}),
        ...(params.async !== undefined ? { async: params.async } : {}),
        ...(params.linkPreview !== undefined ? { linkPreview: params.linkPreview } : {}),
      })
      this.ensureOk('sendText', data, creds.token)
      return data
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('sendText', error, creds.token)
    }
  }

  /**
   * Send a media message (image with caption for product offers).
   * `type` is one of image|video|document|audio; `file` is a public URL or
   * base64 data URL; `text` is the caption.
   */
  async sendMedia(
    creds: UazapiInstanceCredentials,
    params: {
      number: string
      type: 'image' | 'video' | 'document' | 'audio'
      file: string
      text?: string
      docName?: string
      delay?: number
      async?: boolean
    },
  ): Promise<UazapiSendResponse> {
    const client = this.buildInstanceClient(creds)
    try {
      const { data } = await client.post<UazapiSendResponse>('/send/media', {
        number: params.number,
        type: params.type,
        file: params.file,
        ...(params.text ? { text: params.text } : {}),
        ...(params.docName ? { docName: params.docName } : {}),
        ...(params.delay !== undefined ? { delay: params.delay } : {}),
        ...(params.async !== undefined ? { async: params.async } : {}),
      })
      this.ensureOk('sendMedia', data, creds.token)
      return data
    } catch (error) {
      if (error instanceof AppError) throw error
      this.handleError('sendMedia', error, creds.token)
    }
  }
}
