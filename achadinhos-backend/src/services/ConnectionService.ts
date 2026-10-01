import { injectable, inject } from 'tsyringe'
import { createHash } from 'crypto'
import { Connection, CONNECTION_STATUS_ENUM, UazapiCredentials } from '@/database/models/Connection'
import { UazapiClient, UazapiInstanceCredentials } from '@/channels/uazapi/UazapiClient'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { BadRequestError, NotFoundError } from '@/middleware/Error/AppError'

export interface ConnectionStatusResult {
  id: number
  uuid: string
  status: CONNECTION_STATUS_ENUM
  phoneNumber: string | null
  qrCode: string | null
  pairingCode: string | null
  lastConnectedAt: Date | null
}

export interface ConnectedContext {
  creds: UazapiInstanceCredentials
  /** Stable, non-secret identity for the currently attached UAZAPI instance. */
  scope: string
}

export function connectionScopeForCredentials(credentials: UazapiCredentials): string {
  let normalizedBaseUrl: string
  try {
    const url = new URL(credentials.baseUrl)
    normalizedBaseUrl = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    normalizedBaseUrl = credentials.baseUrl.trim().replace(/\/+$/, '')
  }
  const serverHash = createHash('sha256').update(normalizedBaseUrl).digest('hex').slice(0, 32)
  const instanceId = credentials.instanceId?.trim()
  return instanceId
    ? `server:${serverHash}:instance:${instanceId}`
    : `server:${serverHash}:token:${createHash('sha256').update(credentials.instanceToken).digest('hex')}`
}

const QR_TTL_MS = 60_000

/**
 * Manages the single WhatsApp connection each user owns. The UAZAPI admin
 * token stays in backend env; users never see it. Instance tokens are stored
 * in connection.credentials and never returned to the client or logged.
 */
@injectable()
export class ConnectionService {
  constructor(@inject(UazapiClient) private uazapi: UazapiClient) {}

  /** Map stored credentials to the shape the client expects (token = instanceToken). */
  private toClientCreds(connection: Connection): UazapiInstanceCredentials | null {
    const c = connection.credentials
    if (!c || !c.baseUrl || !c.instanceToken) return null
    return { baseUrl: c.baseUrl, token: c.instanceToken }
  }

  isProvisioningConfigured(): boolean {
    return Boolean(env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_ADMIN_TOKEN)
  }

  async getByUser(userId: number): Promise<Connection | null> {
    return Connection.findOne({ where: { userId } })
  }

  async getOrCreate(userId: number): Promise<Connection> {
    const existing = await this.getByUser(userId)
    if (existing) return existing
    return Connection.create({
      userId,
      credentials: null,
      status: CONNECTION_STATUS_ENUM.DISCONNECTED,
    })
  }

  private connectionScope(connection: Connection): string | null {
    const credentials = connection.credentials
    if (!credentials?.instanceToken) return null
    return connectionScopeForCredentials(credentials)
  }

  async getConnectionScope(userId: number): Promise<string | null> {
    const connection = await this.getByUser(userId)
    return connection ? this.connectionScope(connection) : null
  }

  /**
   * Resolve a connection by its public uuid (used by the UAZAPI webhook, which
   * carries no authenticated user). Returns the scope used to isolate stored
   * messages, or null when the connection is unknown / not provisioned.
   */
  async resolveScopeByUuid(uuid: string): Promise<string | null> {
    if (!uuid) return null
    const connection = await Connection.findOne({ where: { uuid } })
    if (!connection) return null
    return this.connectionScope(connection)
  }

  private toStatusResult(
    connection: Connection,
    pairingCode: string | null = null,
  ): ConnectionStatusResult {
    return {
      id: connection.id,
      uuid: connection.uuid,
      status: connection.status,
      phoneNumber: connection.phoneNumber ?? null,
      qrCode: connection.qrCode ?? null,
      pairingCode,
      lastConnectedAt: connection.lastConnectedAt ?? null,
    }
  }

  /**
   * Provision a fresh UAZAPI instance for this user's connection (if not
   * already provisioned) and start the connect cycle to obtain a QR / pair code.
   */
  async connect(userId: number, pairingPhoneNumber?: string): Promise<ConnectionStatusResult> {
    if (!this.isProvisioningConfigured()) {
      throw BadRequestError('UAZAPI não está configurado no servidor (UAZAPI_ADMIN_TOKEN ausente)')
    }
    const connection = await this.getOrCreate(userId)

    if (pairingPhoneNumber !== undefined) {
      connection.pairingPhoneNumber = pairingPhoneNumber || null
    }

    // Provision instance on first connect.
    let creds = this.toClientCreds(connection)
    if (!creds) {
      const created = await this.uazapi.createInstance(env.UAZAPI_BASE_URL, {
        name: `achadinhos-user-${userId}`,
      })
      const instanceToken = created.token || created.instance?.token
      const instanceId = created.instance?.id
      if (!instanceToken || !instanceId) {
        throw BadRequestError('Falha ao provisionar a instância UAZAPI')
      }
      const stored: UazapiCredentials = {
        baseUrl: env.UAZAPI_BASE_URL,
        instanceId,
        instanceToken,
      }
      connection.credentials = stored
      creds = { baseUrl: stored.baseUrl, token: stored.instanceToken }
      logger.info({ userId, instanceId }, 'UAZAPI instance provisioned')
    }

    const phone = connection.pairingPhoneNumber || undefined
    const result = await this.uazapi.connect(creds, phone)

    if (result.connected) {
      connection.status = CONNECTION_STATUS_ENUM.CONNECTED
      connection.qrCode = null
      connection.qrCodeExpiresAt = null
      connection.lastConnectedAt = new Date()
      connection.phoneNumber = result.instance?.owner ?? connection.phoneNumber ?? null
      await connection.save()
      return this.toStatusResult(connection)
    }

    const qrCode = result.qrcode || result.instance?.qrcode || null
    const pairingCode = result.paircode || result.instance?.paircode || null
    connection.qrCode = qrCode
    connection.qrCodeExpiresAt = qrCode ? new Date(Date.now() + QR_TTL_MS) : null
    connection.status = pairingCode
      ? CONNECTION_STATUS_ENUM.WAITING_PHONE_CODE
      : CONNECTION_STATUS_ENUM.WAITING_QR
    await connection.save()
    return this.toStatusResult(connection, pairingCode)
  }

  /**
   * Attach the user's connection to an ALREADY-EXISTING UAZAPI instance the
   * user brings — no admin token, no QR, no provisioning. We verify the token
   * by calling GET /instance/status and, if the session is live, store the
   * credentials and mark the connection CONNECTED.
   *
   * `instanceId` is optional (only needed later for admin delete); when the
   * status response exposes an id we capture it.
   */
  async attachExisting(
    userId: number,
    params: { baseUrl: string; instanceToken: string; instanceId?: string },
  ): Promise<ConnectionStatusResult> {
    const baseUrl = params.baseUrl?.trim()
    const instanceToken = params.instanceToken?.trim()
    if (!baseUrl || !instanceToken) {
      throw BadRequestError('Informe a URL do servidor UAZAPI e o token da instância')
    }

    const creds = { baseUrl, token: instanceToken }
    let status
    try {
      status = await this.uazapi.getStatus(creds)
    } catch {
      throw BadRequestError(
        'Não foi possível validar a instância. Verifique a URL do servidor e o token.',
      )
    }

    const connected = Boolean(status.status?.connected || status.instance?.status === 'connected')
    const instanceId = params.instanceId?.trim() || status.instance?.id || undefined
    const owner = status.instance?.owner ?? null

    const connection = await this.getOrCreate(userId)
    connection.credentials = {
      baseUrl,
      instanceId: instanceId ?? '',
      instanceToken,
    }
    connection.qrCode = null
    connection.qrCodeExpiresAt = null

    if (connected) {
      connection.status = CONNECTION_STATUS_ENUM.CONNECTED
      connection.phoneNumber = owner ?? connection.phoneNumber ?? null
      connection.lastConnectedAt = new Date()
    } else {
      // Token is valid but the WhatsApp session is not connected yet — keep the
      // creds and let the normal connect() flow surface a QR when needed.
      connection.status = CONNECTION_STATUS_ENUM.DISCONNECTED
    }
    await connection.save()

    if (!connected) {
      throw BadRequestError(
        'A instância foi reconhecida, mas o WhatsApp não está conectado nela. Conecte o número na instância e tente novamente.',
      )
    }

    logger.info({ userId, instanceId }, 'Attached to existing UAZAPI instance')
    return this.toStatusResult(connection)
  }

  /** Poll UAZAPI status and reconcile the local row. */
  async refreshStatus(userId: number): Promise<ConnectionStatusResult> {
    const connection = await this.getByUser(userId)
    if (!connection) {
      // No connection yet — report a synthetic disconnected state.
      return {
        id: 0,
        uuid: '',
        status: CONNECTION_STATUS_ENUM.DISCONNECTED,
        phoneNumber: null,
        qrCode: null,
        pairingCode: null,
        lastConnectedAt: null,
      }
    }
    const creds = this.toClientCreds(connection)
    if (!creds) return this.toStatusResult(connection)

    try {
      const status = await this.uazapi.getStatus(creds)
      const connected = Boolean(status.status?.connected || status.instance?.status === 'connected')
      if (connected) {
        connection.status = CONNECTION_STATUS_ENUM.CONNECTED
        connection.qrCode = null
        connection.qrCodeExpiresAt = null
        connection.lastConnectedAt = new Date()
        const owner = status.instance?.owner
        if (owner) connection.phoneNumber = owner
      } else if (connection.status === CONNECTION_STATUS_ENUM.CONNECTED) {
        // Was connected, now dropped.
        connection.status = CONNECTION_STATUS_ENUM.DISCONNECTED
      }
      await connection.save()
    } catch (error) {
      logger.warn({ error, userId }, 'Failed to refresh UAZAPI status')
    }
    return this.toStatusResult(connection)
  }

  async disconnect(userId: number): Promise<void> {
    const connection = await this.getByUser(userId)
    if (!connection) throw NotFoundError('Conexão não encontrada')
    const creds = this.toClientCreds(connection)
    if (creds) {
      try {
        await this.uazapi.disconnect(creds)
      } catch (error) {
        logger.warn({ error, userId }, 'UAZAPI disconnect failed (continuing local cleanup)')
      }
    }
    connection.status = CONNECTION_STATUS_ENUM.DISCONNECTED
    connection.qrCode = null
    connection.qrCodeExpiresAt = null
    await connection.save()
  }

  /** Resolve client credentials for a connected user, or throw. */
  async requireConnectedCreds(userId: number): Promise<UazapiInstanceCredentials> {
    return (await this.requireConnectedContext(userId)).creds
  }

  /** Resolve credentials plus an instance scope used to isolate send history. */
  async requireConnectedContext(userId: number): Promise<ConnectedContext> {
    const connection = await this.getByUser(userId)
    if (!connection)
      throw BadRequestError('Você ainda não tem uma conexão. Conecte um número primeiro.')
    const creds = this.toClientCreds(connection)
    if (!creds) throw BadRequestError('Conexão não provisionada. Conecte um número primeiro.')
    if (connection.status !== CONNECTION_STATUS_ENUM.CONNECTED) {
      throw BadRequestError('Seu número do WhatsApp não está conectado.')
    }
    const scope = this.connectionScope(connection)
    if (!scope) throw BadRequestError('Conexão não provisionada. Conecte um número primeiro.')
    return { creds, scope }
  }

  /** The webhook URL this backend expects UAZAPI to call for this connection. */
  private buildWebhookUrl(connection: Connection): string | null {
    const base = env.API_BASE_URL || process.env.API_BASE_URL
    if (!base) return null
    return `${base.replace(/\/$/, '')}/api/v1/webhook/uazapi/${connection.uuid}`
  }

  /**
   * Report the webhook currently configured on the instance vs. the URL this
   * backend expects (derived from API_BASE_URL). Lets the UI show whether they
   * match without changing anything.
   */
  async getWebhookInfo(userId: number): Promise<{
    configuredUrl: string | null
    expectedUrl: string | null
    enabled: boolean
    matches: boolean
    apiBaseUrlConfigured: boolean
  }> {
    const connection = await this.getByUser(userId)
    if (!connection) throw NotFoundError('Conexão não encontrada')
    const creds = this.toClientCreds(connection)
    if (!creds) throw BadRequestError('Conexão não provisionada. Conecte um número primeiro.')

    const expectedUrl = this.buildWebhookUrl(connection)
    const webhooks = await this.uazapi.getWebhooks(creds)
    // The instance may hold several; prefer one pointing at this backend.
    const mine = expectedUrl
      ? webhooks.find((w) => (w.url || '').startsWith(expectedUrl.split('?')[0]))
      : undefined
    const current = mine ?? webhooks[0]

    return {
      configuredUrl: current?.url ?? null,
      expectedUrl,
      enabled: Boolean(current?.enabled),
      matches: Boolean(expectedUrl && current?.url && current.url.startsWith(expectedUrl)),
      apiBaseUrlConfigured: Boolean(env.API_BASE_URL || process.env.API_BASE_URL),
    }
  }

  /**
   * (Re)register the webhook on the instance using the current API_BASE_URL.
   * Use after setting/changing the ngrok tunnel URL without re-scanning the QR.
   */
  async updateWebhook(userId: number): Promise<{ url: string }> {
    const connection = await this.getByUser(userId)
    if (!connection) throw NotFoundError('Conexão não encontrada')
    const creds = this.toClientCreds(connection)
    if (!creds) throw BadRequestError('Conexão não provisionada. Conecte um número primeiro.')

    const url = this.buildWebhookUrl(connection)
    if (!url) {
      throw BadRequestError(
        'API_BASE_URL não está configurado no servidor. Defina a URL pública (ex.: ngrok) no .env e reinicie o backend.',
      )
    }

    await this.uazapi.setWebhook(creds, {
      url,
      events: ['messages', 'messages_update', 'connection'],
      excludeMessages: ['wasSentByApi'],
      enabled: true,
    })
    logger.info({ userId, connectionId: connection.id }, 'UAZAPI webhook updated')
    return { url }
  }
}
