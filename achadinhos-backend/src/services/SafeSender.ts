import { UazapiClient, UazapiInstanceCredentials } from '@/channels/uazapi/UazapiClient'
import { CampaignOffer, CampaignGroup, CampaignSafety } from '@/database/models/Campaign'
import { renderOfferMessage } from '@/utils/messageTemplate'
import { logger } from '@/utils/logger'

export interface SendTask {
  group: CampaignGroup
  offer: CampaignOffer
}

export interface SendResult {
  group: CampaignGroup
  offer: CampaignOffer
  success: boolean
  messageId?: string
  error?: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Uniform random integer in [min, max]. */
function jitter(minSeconds: number, maxSeconds: number): number {
  const min = Math.min(minSeconds, maxSeconds)
  const max = Math.max(minSeconds, maxSeconds)
  return Math.round((min + Math.random() * (max - min)) * 1000)
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffle<T>(input: T[]): T[] {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Expand offers × groups into a flat task list. Order is offer-major so each
 * group receives offer 1, then offer 2, etc. Groups are optionally shuffled to
 * avoid always hitting the same group first.
 */
export function buildTasks(
  offers: CampaignOffer[],
  groups: CampaignGroup[],
  safety: CampaignSafety,
): SendTask[] {
  const orderedGroups = safety.shuffleGroups ? shuffle(groups) : groups
  const tasks: SendTask[] = []
  for (const offer of offers) {
    for (const group of orderedGroups) {
      tasks.push({ group, offer })
    }
  }
  return tasks
}

/**
 * SafeSender paces the delivery of offer messages to WhatsApp groups so the
 * sending number is less likely to be flagged for spam.
 *
 * Controls applied:
 * - Randomized jitter delay between every message (min..max seconds).
 * - Per-hour cap: once maxPerHour messages have gone out inside the current
 *   rolling hour, wait until the window frees up.
 * - Warmup ramp: after every warmupBatchSize messages, take a longer pause
 *   (maxDelaySeconds × warmupPauseFactor).
 * - Group shuffle (applied in buildTasks).
 *
 * Each send goes through UAZAPI with a group JID (…@g.us) as the target and
 * uses async:true so it enters the instance's own send queue.
 */
export class SafeSender {
  private sentTimestamps: number[] = []

  constructor(
    private readonly uazapi: UazapiClient,
    private readonly creds: UazapiInstanceCredentials,
    private readonly safety: CampaignSafety,
    private readonly messageTemplate?: string | null,
    private readonly sendImages: boolean = true,
  ) {}

  /** Enforce the per-hour cap before sending the next message. */
  private async enforceHourlyCap(): Promise<void> {
    if (!this.safety.maxPerHour || this.safety.maxPerHour <= 0) return
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    this.sentTimestamps = this.sentTimestamps.filter((t) => t > oneHourAgo)
    if (this.sentTimestamps.length >= this.safety.maxPerHour) {
      const oldest = this.sentTimestamps[0]
      const waitMs = oldest + 60 * 60 * 1000 - now
      if (waitMs > 0) {
        logger.info({ waitMs }, 'Hourly cap reached — pausing broadcast')
        await sleep(waitMs)
      }
      const after = Date.now() - 60 * 60 * 1000
      this.sentTimestamps = this.sentTimestamps.filter((t) => t > after)
    }
  }

  private async sendOne(task: SendTask): Promise<SendResult> {
    const target = task.group.id // JID @g.us
    const caption = renderOfferMessage(task.offer, this.messageTemplate)
    try {
      // Decide whether to send as media. UAZAPI accepts a media send and
      // returns a message id even when it later fails to fetch an unreachable
      // image — a silent non-delivery. So we validate the image URL first and
      // fall back to a text message (which always delivers) when it is not a
      // usable public image. When the campaign disables images, always text.
      const usableImage = this.sendImages
        ? await this.resolveUsableImageUrl(task.offer.imageUrl)
        : null

      let res
      if (usableImage) {
        res = await this.uazapi.sendMedia(this.creds, {
          number: target,
          type: 'image',
          file: usableImage,
          text: caption,
          async: false,
        })
      } else {
        res = await this.uazapi.sendText(this.creds, {
          number: target,
          text: caption,
          async: false,
          linkPreview: true,
        })
      }

      const messageId = res.messageid || res.messageId || res.id
      // UAZAPI returns 200 even for some non-deliveries; require a message id
      // and a non-failed status to count it as sent.
      const status = String(res.status ?? '').toLowerCase()
      const failedStatus = status === 'failed' || status === 'error' || status === 'expired'
      if (!messageId || failedStatus) {
        return {
          group: task.group,
          offer: task.offer,
          success: false,
          error: `Envio não confirmado pela UAZAPI (status: ${res.status ?? 'sem id'})`,
        }
      }
      return { group: task.group, offer: task.offer, success: true, messageId }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido'
      return { group: task.group, offer: task.offer, success: false, error: message }
    }
  }

  /**
   * Return a public image URL only if it looks reachable and is an image.
   * Data URLs pass through. A HEAD request guards against placeholder/broken
   * URLs that would make UAZAPI silently drop the media. On any doubt we
   * return null so the caller sends text instead.
   */
  private async resolveUsableImageUrl(imageUrl?: string): Promise<string | null> {
    if (!imageUrl) return null
    if (imageUrl.startsWith('data:image/')) return imageUrl

    let url: URL
    try {
      url = new URL(imageUrl)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

    try {
      const { default: axios } = await import('axios')
      const head = await axios.head(imageUrl, {
        timeout: 6000,
        maxRedirects: 3,
        validateStatus: (s) => s < 400,
      })
      const contentType = String(head.headers['content-type'] ?? '').toLowerCase()
      if (contentType.startsWith('image/')) return imageUrl
      return null
    } catch {
      // Not reachable / not an image → fall back to text.
      return null
    }
  }

  /**
   * Run all tasks with pacing. onResult is called after each send so the caller
   * can persist progress incrementally.
   */
  async run(
    tasks: SendTask[],
    onResult?: (result: SendResult, index: number, total: number) => Promise<void> | void,
    shouldAbort?: () => Promise<boolean> | boolean,
  ): Promise<SendResult[]> {
    const results: SendResult[] = []
    let sinceWarmupPause = 0

    for (let i = 0; i < tasks.length; i++) {
      if (shouldAbort && (await shouldAbort())) {
        logger.info({ sent: results.length, total: tasks.length }, 'Broadcast aborted')
        break
      }

      await this.enforceHourlyCap()

      const result = await this.sendOne(tasks[i])
      results.push(result)
      this.sentTimestamps.push(Date.now())
      if (onResult) await onResult(result, i, tasks.length)

      const isLast = i === tasks.length - 1
      if (isLast) break

      // Warmup ramp pause.
      sinceWarmupPause++
      if (
        this.safety.warmupBatchSize > 0 &&
        sinceWarmupPause >= this.safety.warmupBatchSize
      ) {
        sinceWarmupPause = 0
        const pauseMs = this.safety.maxDelaySeconds * this.safety.warmupPauseFactor * 1000
        logger.debug({ pauseMs }, 'Warmup pause')
        await sleep(pauseMs)
      } else {
        await sleep(jitter(this.safety.minDelaySeconds, this.safety.maxDelaySeconds))
      }
    }

    return results
  }
}
