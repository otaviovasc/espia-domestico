import { injectable, inject } from 'tsyringe'
import { Op } from 'sequelize'
import { GroupMessage, GroupMessageDirection } from '@/database/models/GroupMessage'
import { UazapiClient } from '@/channels/uazapi/UazapiClient'
import { ConnectionService } from '@/services/ConnectionService'
import { renderOfferMessage } from '@/utils/messageTemplate'
import type { CampaignOffer } from '@/database/models/Campaign'
import { OfferSchema } from '@/dtos/campaign'
import { BadRequestError } from '@/middleware/Error/AppError'
import { logger } from '@/utils/logger'

export interface GroupMessageDTO {
  id: number
  groupId: string
  groupName: string | null
  direction: GroupMessageDirection
  sender: string | null
  senderName: string | null
  fromMe: boolean
  text: string | null
  mediaType: string | null
  mediaUrl: string | null
  timestamp: string
}

const toDTO = (m: GroupMessage): GroupMessageDTO => ({
  id: m.id,
  groupId: m.groupId,
  groupName: m.groupName ?? null,
  direction: m.direction,
  sender: m.sender ?? null,
  senderName: m.senderName ?? null,
  fromMe: m.fromMe,
  text: m.text ?? null,
  mediaType: m.mediaType ?? null,
  mediaUrl: m.mediaUrl ?? null,
  timestamp: m.timestamp.toISOString(),
})

/** Pull a value from the first key that is present on an object. */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return undefined
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

/** Interpret a UAZAPI/WhatsApp timestamp (seconds or ms, or ISO) as a Date. */
function parseTimestamp(v: unknown): Date {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // WhatsApp uses seconds; anything below ~10^12 is seconds.
    return new Date(v < 1e12 ? v * 1000 : v)
  }
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n) && v.trim() !== '') return parseTimestamp(n)
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

/**
 * A normalized view of a single inbound message extracted from the webhook
 * payload. Returns null when the event is not a group chat message we store.
 */
interface NormalizedIncoming {
  groupId: string
  groupName: string | null
  messageId: string | null
  sender: string | null
  senderName: string | null
  fromMe: boolean
  text: string | null
  mediaType: string | null
  mediaUrl: string | null
  timestamp: Date
}

function normalizeIncoming(raw: unknown): NormalizedIncoming | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Record<string, unknown>

  // The chat JID can live under several keys depending on UAZAPI version.
  const chatId =
    asString(pick(msg, 'chatid', 'chatId', 'remoteJid', 'remoteJID', 'jid', 'from', 'key_remoteJid'))
  // Some payloads nest the WhatsApp key under `key`.
  const key = (msg.key && typeof msg.key === 'object' ? (msg.key as Record<string, unknown>) : {})
  const resolvedChat = chatId || asString(pick(key, 'remoteJid', 'remoteJID'))
  if (!resolvedChat || !resolvedChat.endsWith('@g.us')) return null // groups only

  const fromMe = Boolean(pick(msg, 'fromMe', 'fromme') ?? pick(key, 'fromMe') ?? false)
  const messageId = asString(pick(msg, 'messageid', 'messageId', 'id') ?? pick(key, 'id'))
  const sender = asString(pick(msg, 'participant', 'sender', 'senderJid', 'author'))
  const senderName = asString(pick(msg, 'senderName', 'pushName', 'pushname', 'notifyName'))

  // Text can be a plain field or nested in message.conversation / extendedText.
  let text = asString(pick(msg, 'text', 'body', 'caption', 'conversation', 'content'))
  const inner = msg.message && typeof msg.message === 'object' ? (msg.message as Record<string, unknown>) : null
  if (!text && inner) {
    text =
      asString(pick(inner, 'conversation', 'text', 'caption')) ||
      asString(
        pick(
          (inner.extendedTextMessage as Record<string, unknown>) ?? {},
          'text',
        ),
      )
  }

  const mediaType = asString(pick(msg, 'mediaType', 'messageType', 'type'))
  const mediaUrl = asString(pick(msg, 'mediaUrl', 'url', 'fileURL', 'file'))
  const timestamp = parseTimestamp(
    pick(msg, 'messageTimestamp', 'timestamp', 'date', 't', 'moment'),
  )
  const groupName = asString(pick(msg, 'chatName', 'groupName', 'subject'))

  return {
    groupId: resolvedChat,
    groupName,
    messageId,
    sender,
    senderName,
    fromMe,
    text,
    // Only record a media type when it's a real media kind (not "text"/"chat").
    mediaType:
      mediaType && !/^(text|chat|conversation|extendedtext)$/i.test(mediaType) ? mediaType : null,
    mediaUrl,
    timestamp,
  }
}

/** Collect every candidate message object out of a webhook body. */
function extractMessages(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  // UAZAPI commonly sends { event, message } or { event, messages: [...] }.
  if (Array.isArray(b.messages)) return b.messages
  if (b.message) return [b.message]
  if (Array.isArray(b.data)) return b.data
  if (b.data) return [b.data]
  // Last resort: the body itself might be the message.
  if (b.chatid || b.remoteJid || b.key) return [b]
  return []
}

@injectable()
export class GroupMessageService {
  constructor(
    @inject(UazapiClient) private uazapi: UazapiClient,
    @inject(ConnectionService) private connectionService: ConnectionService,
  ) {}

  /**
   * Ingest a UAZAPI webhook body for a given connection scope. Stores inbound
   * group messages idempotently (dedup on connectionScope + messageId). Never
   * throws on bad data — the webhook must always answer 200 so UAZAPI does not
   * retry forever. Returns the number of rows stored.
   */
  async ingestWebhook(connectionScope: string, body: unknown): Promise<number> {
    const candidates = extractMessages(body)
    let stored = 0
    for (const raw of candidates) {
      const n = normalizeIncoming(raw)
      if (!n) continue
      try {
        if (n.messageId) {
          const [, created] = await GroupMessage.findOrCreate({
            where: { connectionScope, messageId: n.messageId },
            defaults: {
              connectionScope,
              groupId: n.groupId,
              groupName: n.groupName,
              direction: n.fromMe ? 'out' : 'in',
              messageId: n.messageId,
              sender: n.sender,
              senderName: n.senderName,
              fromMe: n.fromMe,
              text: n.text,
              mediaType: n.mediaType,
              mediaUrl: n.mediaUrl,
              timestamp: n.timestamp,
            },
          })
          if (created) stored += 1
        } else {
          await GroupMessage.create({
            connectionScope,
            groupId: n.groupId,
            groupName: n.groupName,
            direction: n.fromMe ? 'out' : 'in',
            messageId: null,
            sender: n.sender,
            senderName: n.senderName,
            fromMe: n.fromMe,
            text: n.text,
            mediaType: n.mediaType,
            mediaUrl: n.mediaUrl,
            timestamp: n.timestamp,
          })
          stored += 1
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to store ingested group message')
      }
    }
    return stored
  }

  /**
   * List messages for one group of the user's current connection, oldest-first
   * for natural chat rendering. `before`/`after` are ISO timestamps for paging.
   */
  async listMessages(
    userId: number,
    groupId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<GroupMessageDTO[]> {
    if (!groupId.endsWith('@g.us')) throw BadRequestError('ID de grupo inválido')
    const scope = await this.connectionService.getConnectionScope(userId)
    if (!scope) return []
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300)
    const where: Record<string, unknown> = { connectionScope: scope, groupId }
    if (opts.before) {
      const d = new Date(opts.before)
      if (!Number.isNaN(d.getTime())) where.timestamp = { [Op.lt]: d }
    }
    // Pull the newest `limit`, then return oldest-first.
    const rows = await GroupMessage.findAll({
      where,
      order: [['timestamp', 'DESC'], ['id', 'DESC']],
      limit,
    })
    return rows.reverse().map(toDTO)
  }

  /** Send a free-text message to a group and record the outbound row. */
  async sendText(userId: number, groupId: string, text: string): Promise<GroupMessageDTO> {
    const body = text?.trim()
    if (!body) throw BadRequestError('Mensagem vazia')
    return this.send(userId, groupId, { text: body, linkPreview: true })
  }

  /** Format a saved/hand-picked offer and send it to a group. */
  async sendOffer(
    userId: number,
    groupId: string,
    offerInput: unknown,
    opts: { sendImage?: boolean; template?: string | null } = {},
  ): Promise<GroupMessageDTO> {
    const parsed = OfferSchema.safeParse(offerInput)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const offer = parsed.data as CampaignOffer
    const caption = renderOfferMessage(offer, opts.template ?? null)
    const sendImage = opts.sendImage !== false && Boolean(offer.imageUrl)
    return this.send(userId, groupId, {
      text: caption,
      imageUrl: sendImage ? offer.imageUrl : undefined,
      linkPreview: !sendImage,
    })
  }

  /** Shared send path: dispatches via UAZAPI then stores the outbound row. */
  private async send(
    userId: number,
    groupId: string,
    params: { text: string; imageUrl?: string; linkPreview?: boolean },
  ): Promise<GroupMessageDTO> {
    if (!groupId.endsWith('@g.us')) throw BadRequestError('ID de grupo inválido')
    const { creds, scope } = await this.connectionService.requireConnectedContext(userId)

    let messageId: string | null = null
    if (params.imageUrl) {
      const res = await this.uazapi.sendMedia(creds, {
        number: groupId,
        type: 'image',
        file: params.imageUrl,
        text: params.text,
        async: false,
      })
      messageId = res.messageid || res.messageId || res.id || null
    } else {
      const res = await this.uazapi.sendText(creds, {
        number: groupId,
        text: params.text,
        async: false,
        linkPreview: params.linkPreview ?? true,
      })
      messageId = res.messageid || res.messageId || res.id || null
    }

    const row = await GroupMessage.create({
      connectionScope: scope,
      groupId,
      groupName: null,
      direction: 'out',
      messageId,
      sender: null,
      senderName: null,
      fromMe: true,
      text: params.text,
      mediaType: params.imageUrl ? 'image' : null,
      mediaUrl: params.imageUrl ?? null,
      timestamp: new Date(),
    })
    return toDTO(row)
  }
}
