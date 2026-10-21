import { randomUUID } from 'node:crypto'
import { inject, injectable } from 'tsyringe'
import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize'
import { UazapiClient } from '@/channels/uazapi/UazapiClient'
import { sequelize } from '@/database'
import type { CampaignGroup, CampaignOffer, CampaignSafety } from '@/database/models/Campaign'
import { SmartAudience, type SmartAudiencePolicy } from '@/database/models/SmartAudience'
import {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} from '@/database/models/ProductGroupDelivery'
import { SmartPlan, SMART_PLAN_STATUS } from '@/database/models/SmartPlan'
import { SmartSend, SMART_SEND_STATUS } from '@/database/models/SmartSend'
import { ConnectionService, type ConnectedContext } from '@/services/ConnectionService'
import { GroupService, type GroupDTO } from '@/services/GroupService'
import { SafeSender, type SendResult } from '@/services/SafeSender'
import { DEFAULT_TEMPLATE } from '@/utils/messageTemplate'
import { offerIdentityAliases } from '@/utils/offerIdentity'
import { logger } from '@/utils/logger'
import { explicitSmartStart, type SmartCampaignTiming } from '@/utils/smartCampaignTiming'
import { evaluateSmartProductEligibility } from '@/utils/smartProductEligibility'

const HARD_START_TIME = '09:00'
const HARD_END_TIME = '21:00'
const HARD_DAILY_CAP = 50
const HARD_MIN_GROUP_GAP_SECONDS = 12 * 60
const ACCOUNT_MIN_GAP_SECONDS = 20
const LEASE_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 30 * 1000
const GROUP_CACHE_MS = 60 * 1000
const DEFAULT_BATCH_SIZE = 25

type LocalParts = { date: string; time: string }
type PrepareResult =
  | { kind: 'ready'; claim: ProductGroupDelivery }
  | { kind: 'rescheduled' | 'skipped' | 'blocked'; reason: string }

interface ClaimedSend {
  send: SmartSend
  plan: SmartPlan
}

interface SenderOptions {
  now?: () => Date
  ownerId?: string
  batchSize?: number
}

export interface SmartCampaignSenderResult {
  claimed: number
  sent: number
  unknown: number
  skipped: number
  rescheduled: number
  blocked: number
}

const DEFAULT_POLICY: SmartAudiencePolicy = {
  dailyCap: HARD_DAILY_CAP,
  startTime: HARD_START_TIME,
  endTime: HARD_END_TIME,
  minGapSeconds: HARD_MIN_GROUP_GAP_SECONDS,
  maxGapSeconds: 16 * 60,
  maxStandouts: 3,
  freshnessHours: 24,
  timezone: 'America/Sao_Paulo',
  excludePolitical: false,
}

function validTimezone(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return value
  } catch {
    return fallback
  }
}

function numberWithin(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function laterTime(a: string, b: string): string {
  return a >= b ? a : b
}

function earlierTime(a: string, b: string): string {
  return a <= b ? a : b
}

export function resolveSmartSendPolicy(plan: SmartPlan, send: SmartSend): SmartAudiencePolicy {
  const settings = plan.settings as {
    audiences?: Record<string, Partial<SmartAudiencePolicy>>
    global?: SmartCampaignTiming
  }
  const raw =
    settings?.audiences?.[send.audienceSlug] ?? (plan.settings as Partial<SmartAudiencePolicy>)
  const timezone = validTimezone(raw?.timezone, validTimezone(send.timezone, plan.timezone))
  const startTime = explicitSmartStart(settings.global, send.localDate, laterTime(
    typeof raw?.startTime === 'string' && /^\d{2}:\d{2}$/.test(raw.startTime)
      ? raw.startTime
      : HARD_START_TIME,
    HARD_START_TIME,
  ))
  const endTime = earlierTime(
    typeof raw?.endTime === 'string' && /^\d{2}:\d{2}$/.test(raw.endTime)
      ? raw.endTime
      : HARD_END_TIME,
    HARD_END_TIME,
  )
  return {
    ...DEFAULT_POLICY,
    ...raw,
    timezone,
    startTime: startTime < endTime ? startTime : HARD_START_TIME,
    endTime: startTime < endTime ? endTime : HARD_END_TIME,
    dailyCap: Math.floor(numberWithin(raw?.dailyCap, HARD_DAILY_CAP, 1, HARD_DAILY_CAP)),
    minGapSeconds: Math.floor(
      numberWithin(
        raw?.minGapSeconds,
        HARD_MIN_GROUP_GAP_SECONDS,
        HARD_MIN_GROUP_GAP_SECONDS,
        3600,
      ),
    ),
    maxGapSeconds: Math.floor(
      numberWithin(raw?.maxGapSeconds, 16 * 60, HARD_MIN_GROUP_GAP_SECONDS, 3600),
    ),
    maxStandouts: Math.floor(numberWithin(raw?.maxStandouts, 3, 0, 10)),
    // Until offers can be refreshed automatically, never trust marketplace
    // evidence for longer than one day even if an older snapshot says so.
    freshnessHours: numberWithin(raw?.freshnessHours, 24, 1, 24),
  }
}

export function getSmartLocalParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}`,
  }
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const representedAsUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  )
  return representedAsUtc - date.getTime()
}

export function smartLocalDateTime(localDate: string, time: string, timezone: string): Date {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute)
  let result = new Date(naiveUtc - timezoneOffsetMs(new Date(naiveUtc), timezone))
  result = new Date(naiveUtc - timezoneOffsetMs(result, timezone))
  return result
}

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function sanitizeSmartMessageIntro(value?: string | null): string {
  if (!value) return ''
  return value
    .normalize('NFKC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 10 || code === 13 || code === 9 || (code >= 32 && code !== 127)
    })
    .join('')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[{}]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n')
    .slice(0, 220)
    .trim()
}

function templateWithIntro(intro?: string | null): string {
  const safe = sanitizeSmartMessageIntro(intro)
  return safe ? `${safe}\n\n${DEFAULT_TEMPLATE}` : DEFAULT_TEMPLATE
}

function isEvidenceFresh(observedAt: Date, now: Date, freshnessHours: number): boolean {
  const age = now.getTime() - observedAt.getTime()
  return age >= 0 && age <= freshnessHours * 60 * 60 * 1000
}

function deliveryKeys(send: SmartSend): { account: string; destination: string } {
  return {
    account: `delivery-account:${send.userId}:${send.connectionScope}`,
    destination: `delivery-destination:${send.userId}:${send.connectionScope}:${send.groupId}`,
  }
}

async function advisoryLock(transaction: Transaction, key: string): Promise<void> {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key },
    transaction,
    type: QueryTypes.SELECT,
  })
}

@injectable()
export class SmartCampaignSender {
  private processing = false
  private readonly ownerId: string
  private readonly now: () => Date
  private readonly batchSize: number
  private readonly groupCache = new Map<string, { group: GroupDTO; expiresAt: number }>()

  constructor(
    @inject(UazapiClient) private readonly uazapi: UazapiClient,
    @inject(ConnectionService) private readonly connectionService: ConnectionService,
    @inject(GroupService) private readonly groupService: GroupService,
    @inject('SmartCampaignSenderOptions', { isOptional: true }) options?: SenderOptions,
  ) {
    this.ownerId = options?.ownerId ?? `smart-sender:${process.pid}:${randomUUID()}`
    this.now = options?.now ?? (() => new Date())
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE
  }

  async processDue(): Promise<SmartCampaignSenderResult> {
    const result: SmartCampaignSenderResult = {
      claimed: 0,
      sent: 0,
      unknown: 0,
      skipped: 0,
      rescheduled: 0,
      blocked: 0,
    }
    if (this.processing) return result
    this.processing = true
    const touchedPlans = new Set<number>()
    try {
      await this.recoverExpiredSending(this.now())
      for (let index = 0; index < this.batchSize; index++) {
        const claimed = await this.claimNext(this.now())
        if (!claimed) break
        result.claimed++
        touchedPlans.add(claimed.plan.id)
        let outcome: 'sent' | 'unknown' | 'skipped' | 'rescheduled' | 'blocked' | null = null
        try {
          outcome = await this.processClaim(claimed)
          result[outcome]++
        } catch (error) {
          result.blocked++
          await this.releaseUnexpectedClaim(claimed.send, error)
          logger.error(
            { error, smartSendId: claimed.send.id, smartPlanId: claimed.plan.id },
            'Smart campaign send failed before provider confirmation',
          )
        }
        if (outcome === 'unknown') {
          // Stop this plan before another overdue row can be claimed. UNKNOWN
          // requires an operator decision and must never create a catch-up burst.
          // Let a database failure escape the loop: continuing would be unsafe.
          await this.completePlans(new Set([claimed.plan.id]))
        }
      }
      await this.completePlans(touchedPlans)
      return result
    } finally {
      this.processing = false
    }
  }

  private async claimNext(now: Date): Promise<ClaimedSend | null> {
    return sequelize.transaction(async (transaction) => {
      const rows = await sequelize.query<{ id: number }>(
        `SELECT ss.id
           FROM smart_sends ss
           JOIN smart_plans sp ON sp.id = ss.plan_id AND sp.user_id = ss.user_id
          WHERE ss.status = 'PENDING'
            AND ss.scheduled_at <= :now
            AND (ss.lease_expires_at IS NULL OR ss.lease_expires_at < :now)
            AND ss.attempts < ss.max_attempts
            AND sp.status = 'SCHEDULED'
            AND NOT EXISTS (
              SELECT 1 FROM smart_sends uncertain
               WHERE uncertain.plan_id = ss.plan_id AND uncertain.status IN ('UNKNOWN', 'FAILED')
            )
          ORDER BY ss.scheduled_at ASC, ss.id ASC
          FOR UPDATE OF ss SKIP LOCKED
          LIMIT 1`,
        { replacements: { now }, transaction, type: QueryTypes.SELECT },
      )
      if (!rows[0]) return null
      const expiresAt = new Date(now.getTime() + LEASE_MS)
      const [leased] = await SmartSend.update(
        { leaseOwner: this.ownerId, leaseExpiresAt: expiresAt, lastError: null },
        {
          where: { id: rows[0].id, status: SMART_SEND_STATUS.PENDING },
          transaction,
        },
      )
      if (leased !== 1) return null
      const send = await SmartSend.findByPk(rows[0].id, { transaction })
      if (!send) return null
      const plan = await SmartPlan.findOne({
        where: { id: send.planId, userId: send.userId, status: SMART_PLAN_STATUS.SCHEDULED },
        transaction,
      })
      return plan ? { send, plan } : null
    })
  }

  private async processClaim(
    claimed: ClaimedSend,
  ): Promise<'sent' | 'unknown' | 'skipped' | 'rescheduled' | 'blocked'> {
    const { send, plan } = claimed
    const policy = resolveSmartSendPolicy(plan, send)
    const now = this.now()
    const audienceState = await this.enforceCurrentAudience(plan, send, now)
    if (audienceState) return audienceState
    if (!isEvidenceFresh(send.evidenceObservedAt, now, policy.freshnessHours)) {
      await this.finishWithoutProvider(
        send,
        SMART_SEND_STATUS.SKIPPED,
        'Oferta expirada: atualize os dados e gere um novo plano.',
      )
      return 'skipped'
    }

    const windowResult = await this.enforceWindow(send, policy, now)
    if (windowResult) return windowResult
    await this.normalizeCatchupDate(send, policy, now)

    let context: ConnectedContext
    try {
      context = await this.connectionService.requireConnectedContext(send.userId)
    } catch (error) {
      await this.pauseForBlock(plan, send, `WhatsApp indisponível: ${this.errorMessage(error)}`)
      return 'blocked'
    }
    if (context.scope !== send.connectionScope) {
      await this.pauseForBlock(
        plan,
        send,
        'A conexão do WhatsApp mudou desde a aprovação. Revise e aprove o plano novamente.',
      )
      return 'blocked'
    }

    let group: GroupDTO
    try {
      group = await this.requireCurrentGroup(send)
    } catch (error) {
      await this.pauseForBlock(plan, send, `Grupo indisponível: ${this.errorMessage(error)}`)
      return 'blocked'
    }

    const prepared = await this.prepareDelivery(send, plan, policy, group, now)
    if (prepared.kind !== 'ready') return prepared.kind
    try {
      const currentContext = await this.connectionService.requireConnectedContext(send.userId)
      if (currentContext.scope !== send.connectionScope) {
        await this.abortPreparedDelivery(
          plan,
          send,
          prepared.claim,
          'A conexão mudou imediatamente antes do envio. Revise e aprove o plano novamente.',
        )
        return 'blocked'
      }
      context = currentContext
    } catch (error) {
      await this.abortPreparedDelivery(
        plan,
        send,
        prepared.claim,
        `A conexão ficou indisponível antes do envio: ${this.errorMessage(error)}`,
      )
      return 'blocked'
    }
    const finalAudienceState = await this.enforceCurrentAudience(plan, send, this.now(), prepared.claim)
    if (finalAudienceState) return finalAudienceState
    return this.callProvider(send, plan, context, group, prepared.claim)
  }

  private async requireCurrentGroup(send: SmartSend): Promise<GroupDTO> {
    const key = `${send.userId}\u0000${send.connectionScope}\u0000${send.groupId}`
    const cached = this.groupCache.get(key)
    if (cached && cached.expiresAt > this.now().getTime()) return cached.group
    const groups = await this.groupService.requireCurrentGroups(send.userId, [send.groupId])
    const group = groups.get(send.groupId)
    if (!group) throw new Error('O grupo não pertence mais à conexão atual.')
    this.groupCache.set(key, { group, expiresAt: this.now().getTime() + GROUP_CACHE_MS })
    return group
  }

  private async enforceCurrentAudience(
    plan: SmartPlan,
    send: SmartSend,
    now: Date,
    preparedClaim?: ProductGroupDelivery,
  ): Promise<'rescheduled' | 'blocked' | 'skipped' | null> {
    const audience = await SmartAudience.findOne({
      where: { userId: send.userId, slug: send.audienceSlug },
      attributes: ['enabled', 'destinations', 'policy'],
    })
    if (!audience || !audience.enabled) {
      if (preparedClaim) {
        await this.abortPreparedDelivery(plan, send, preparedClaim, 'Este público foi desativado antes do envio.')
        return 'blocked'
      }
      await this.reschedule(
        send,
        new Date(now.getTime() + 5 * 60 * 1000),
        send.localDate,
        'Este público está desativado. Ative-o para retomar apenas esta agenda.',
      )
      return 'rescheduled'
    }
    if (!audience.destinations.some((destination) => destination.groupId === send.groupId)) {
      const reason = 'O grupo não está mais vinculado a este público. Revise os destinos e aprove o plano novamente.'
      if (preparedClaim) await this.abortPreparedDelivery(plan, send, preparedClaim, reason)
      else await this.pauseForBlock(plan, send, reason)
      return 'blocked'
    }
    const eligibility = evaluateSmartProductEligibility(
      send.offer, resolveSmartSendPolicy(plan, send), audience.policy ?? {},
    )
    if (!eligibility.eligible) {
      const reason = `Produto excluído pelos filtros: ${eligibility.reasons.join('; ')}`
      if (preparedClaim) {
        await this.abortPreparedDelivery(plan, send, preparedClaim, reason)
        return 'blocked'
      }
      await this.finishWithoutProvider(send, SMART_SEND_STATUS.SKIPPED, reason)
      return 'skipped'
    }
    return null
  }

  private async normalizeCatchupDate(
    send: SmartSend,
    policy: SmartAudiencePolicy,
    now: Date,
  ): Promise<void> {
    const currentLocalDate = getSmartLocalParts(now, policy.timezone).date
    if (send.localDate === currentLocalDate) return
    const [updated] = await SmartSend.update(
      { localDate: currentLocalDate, scheduledAt: now },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
      },
    )
    if (updated !== 1) throw new Error('A tarefa mudou antes da correção do dia de envio.')
    send.localDate = currentLocalDate
    send.scheduledAt = now
  }

  private async enforceWindow(
    send: SmartSend,
    policy: SmartAudiencePolicy,
    now: Date,
  ): Promise<'rescheduled' | 'skipped' | null> {
    const local = getSmartLocalParts(now, policy.timezone)
    let next: Date | null = null
    let nextLocalDate = local.date
    if (local.time < policy.startTime) {
      next = smartLocalDateTime(local.date, policy.startTime, policy.timezone)
    } else if (local.time >= policy.endTime) {
      nextLocalDate = addLocalDays(local.date, 1)
      next = smartLocalDateTime(nextLocalDate, policy.startTime, policy.timezone)
    }
    if (!next) return null
    if (!isEvidenceFresh(send.evidenceObservedAt, next, policy.freshnessHours)) {
      await this.finishWithoutProvider(
        send,
        SMART_SEND_STATUS.SKIPPED,
        'A oferta venceria antes da próxima janela segura de envio.',
      )
      return 'skipped'
    }
    await this.reschedule(
      send,
      next,
      nextLocalDate,
      'Movido para a próxima janela segura (09:00–21:00).',
    )
    return 'rescheduled'
  }

  private async prepareDelivery(
    send: SmartSend,
    plan: SmartPlan,
    policy: SmartAudiencePolicy,
    group: GroupDTO,
    now: Date,
  ): Promise<PrepareResult> {
    return sequelize.transaction(async (transaction) => {
      const keys = deliveryKeys(send)
      await advisoryLock(transaction, keys.account)
      await advisoryLock(transaction, keys.destination)

      const freshSend = await SmartSend.findOne({
        where: { id: send.id, userId: send.userId, leaseOwner: this.ownerId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const freshPlan = await SmartPlan.findOne({
        where: { id: plan.id, userId: send.userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!freshSend || freshSend.status !== SMART_SEND_STATUS.PENDING) {
        return { kind: 'blocked', reason: 'A tarefa mudou de estado antes do envio.' }
      }
      if (!freshPlan || freshPlan.status !== SMART_PLAN_STATUS.SCHEDULED) {
        await this.releaseLeaseInTransaction(freshSend, transaction, 'O plano não está agendado.')
        return { kind: 'blocked', reason: 'O plano não está agendado.' }
      }

      const legacyRunning = await sequelize.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM campaigns c
            WHERE c.user_id = :userId
              AND (c.status = 'RUNNING' OR (c.status = 'SCHEDULED' AND c.scheduled_at <= :now))
              AND c.groups @> CAST(:group AS jsonb)
         ) AS exists`,
        {
          replacements: { userId: send.userId, now, group: JSON.stringify([{ id: send.groupId }]) },
          transaction,
          type: QueryTypes.SELECT,
        },
      )
      if (legacyRunning[0]?.exists) {
        const next = new Date(now.getTime() + policy.minGapSeconds * 1000)
        await this.rescheduleInTransaction(
          freshSend,
          next,
          getSmartLocalParts(next, policy.timezone).date,
          'Campanha manual ativa para este grupo; tentativa adiada.',
          transaction,
        )
        return { kind: 'rescheduled', reason: 'Campanha manual ativa.' }
      }

      const cadence = await this.lastDeliveryAt(send, transaction)
      const destinationReadyAt = cadence.destination
        ? new Date(cadence.destination.getTime() + policy.minGapSeconds * 1000)
        : null
      const accountReadyAt = cadence.account
        ? new Date(cadence.account.getTime() + ACCOUNT_MIN_GAP_SECONDS * 1000)
        : null
      const readyAt = [destinationReadyAt, accountReadyAt]
        .filter((value): value is Date => Boolean(value && value > now))
        .sort((a, b) => b.getTime() - a.getTime())[0]
      if (readyAt) {
        const localReady = getSmartLocalParts(readyAt, policy.timezone)
        const target =
          localReady.time >= policy.endTime
            ? smartLocalDateTime(
                addLocalDays(localReady.date, 1),
                policy.startTime,
                policy.timezone,
              )
            : readyAt
        const localDate = getSmartLocalParts(target, policy.timezone).date
        if (!isEvidenceFresh(send.evidenceObservedAt, target, policy.freshnessHours)) {
          await this.finishInTransaction(
            freshSend,
            SMART_SEND_STATUS.SKIPPED,
            'A oferta venceria antes do próximo intervalo seguro.',
            transaction,
          )
          return { kind: 'skipped', reason: 'Oferta expirada antes do intervalo seguro.' }
        }
        await this.rescheduleInTransaction(
          freshSend,
          target,
          localDate,
          'Intervalo de segurança compartilhado ainda ativo.',
          transaction,
        )
        return { kind: 'rescheduled', reason: 'Intervalo de segurança ativo.' }
      }

      const dailyCount = await this.dailyDeliveryCount(send, policy, now, transaction)
      if (dailyCount >= policy.dailyCap) {
        const tomorrow = addLocalDays(getSmartLocalParts(now, policy.timezone).date, 1)
        const next = smartLocalDateTime(tomorrow, policy.startTime, policy.timezone)
        if (!isEvidenceFresh(send.evidenceObservedAt, next, policy.freshnessHours)) {
          await this.finishInTransaction(
            freshSend,
            SMART_SEND_STATUS.SKIPPED,
            'Limite diário atingido e a oferta vencerá antes da próxima janela.',
            transaction,
          )
          return { kind: 'skipped', reason: 'Limite diário e oferta expirada.' }
        }
        await this.rescheduleInTransaction(
          freshSend,
          next,
          tomorrow,
          `Limite diário de ${policy.dailyCap} mensagens atingido.`,
          transaction,
        )
        return { kind: 'rescheduled', reason: 'Limite diário atingido.' }
      }

      const offer = freshSend.offer as CampaignOffer
      const aliases = offerIdentityAliases(offer)
      const existing = await ProductGroupDelivery.findOne({
        where: {
          userId: send.userId,
          connectionScope: send.connectionScope,
          groupId: send.groupId,
          planUuid: plan.uuid,
          offerIdentity: { [Op.in]: aliases },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (existing) {
        await this.finishInTransaction(
          freshSend,
          SMART_SEND_STATUS.SKIPPED,
          'Este produto já foi enviado ou possui confirmação pendente neste grupo.',
          transaction,
        )
        return { kind: 'skipped', reason: 'Produto já entregue ou incerto.' }
      }

      let delivery: ProductGroupDelivery
      try {
        delivery = await sequelize.transaction({ transaction }, async (savepoint) =>
          ProductGroupDelivery.create(
            {
              userId: send.userId,
              connectionScope: send.connectionScope,
              offerIdentity: send.offerIdentity,
              offerSource: offer.source?.trim().toLowerCase() || null,
              offerProductId: offer.productId?.trim() || null,
              offerUrl: offer.affiliateUrl.trim(),
              offerTitle: offer.title,
              groupId: send.groupId,
              groupName: group.name,
              campaignId: null,
              planUuid: plan.uuid,
              status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
              claimToken: randomUUID(),
              heartbeatAt: now,
            },
            { transaction: savepoint },
          ),
        )
      } catch (error) {
        if (!(error instanceof UniqueConstraintError)) throw error
        await this.finishInTransaction(
          freshSend,
          SMART_SEND_STATUS.SKIPPED,
          'Outro processo reservou este produto para o grupo.',
          transaction,
        )
        return { kind: 'skipped', reason: 'Produto reservado concorrentemente.' }
      }

      const [updated] = await SmartSend.update(
        {
          status: SMART_SEND_STATUS.SENDING,
          attempts: freshSend.attempts + 1,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          groupName: group.name,
        },
        {
          where: {
            id: freshSend.id,
            userId: freshSend.userId,
            leaseOwner: this.ownerId,
            status: SMART_SEND_STATUS.PENDING,
          },
          transaction,
        },
      )
      if (updated !== 1) throw new Error('A posse da tarefa mudou antes da reserva do envio.')
      return { kind: 'ready', claim: delivery }
    })
  }

  private async callProvider(
    send: SmartSend,
    plan: SmartPlan,
    context: ConnectedContext,
    group: GroupDTO,
    claim: ProductGroupDelivery,
  ): Promise<'sent' | 'unknown'> {
    const offer = send.offer as CampaignOffer
    const safety: CampaignSafety = {
      minDelaySeconds: 0,
      maxDelaySeconds: 0,
      shuffleGroups: false,
      shuffleOffers: false,
      maxPerHour: 0,
      warmupBatchSize: 0,
      warmupPauseFactor: 1,
    }
    const sender = new SafeSender(
      this.uazapi,
      context.creds,
      safety,
      templateWithIntro(send.messageIntro),
      true,
    )
    const heartbeat = setInterval(() => void this.heartbeat(send, claim), HEARTBEAT_MS)
    let result: SendResult
    try {
      const results = await sender.run([{ group: group as CampaignGroup, offer }])
      result = results[0] ?? {
        group: group as CampaignGroup,
        offer,
        success: false,
        error: 'O provedor não retornou um resultado.',
      }
    } catch (error) {
      result = {
        group: group as CampaignGroup,
        offer,
        success: false,
        error: this.errorMessage(error),
      }
    } finally {
      clearInterval(heartbeat)
    }

    const sentAt = this.now()
    if (result.success && result.messageId) {
      const settled = await sequelize.transaction(async (transaction) => {
        const [updated] = await SmartSend.update(
          {
            status: SMART_SEND_STATUS.SENT,
            providerMessageId: result.messageId,
            sentAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: null,
          },
          {
            where: {
              id: send.id,
              userId: send.userId,
              leaseOwner: this.ownerId,
              status: { [Op.in]: [SMART_SEND_STATUS.SENDING, SMART_SEND_STATUS.UNKNOWN] },
            },
            transaction,
          },
        )
        if (updated !== 1) {
          logger.warn({ smartSendId: send.id }, 'Late smart-send success was fenced')
          return false
        }
        await ProductGroupDelivery.update(
          {
            status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
            messageId: result.messageId,
            sentAt,
            heartbeatAt: sentAt,
          },
          { where: { id: claim.id, claimToken: claim.claimToken }, transaction },
        )
        return true
      })
      return settled ? 'sent' : 'unknown'
    }

    await SmartSend.update(
      {
        status: SMART_SEND_STATUS.UNKNOWN,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: `Resultado do provedor incerto; verifique o WhatsApp antes de decidir: ${result.error ?? 'sem confirmação'}`,
      },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.SENDING,
        },
      },
    )
    // Intentionally retain the ProductGroupDelivery SENDING row. It is the
    // durable duplicate-send barrier until an operator resolves UNKNOWN.
    return 'unknown'
  }

  private async heartbeat(send: SmartSend, claim: ProductGroupDelivery): Promise<void> {
    const now = this.now()
    await Promise.allSettled([
      SmartSend.update(
        { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        {
          where: {
            id: send.id,
            userId: send.userId,
            leaseOwner: this.ownerId,
            status: SMART_SEND_STATUS.SENDING,
          },
        },
      ),
      ProductGroupDelivery.update(
        { heartbeatAt: now },
        {
          where: {
            id: claim.id,
            claimToken: claim.claimToken,
            status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
          },
        },
      ),
    ])
  }

  private async recoverExpiredSending(now: Date): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      // Recovery and plan state change share one transaction. Otherwise a
      // second worker could claim the next PENDING row in the small window
      // between marking UNKNOWN and pausing the plan.
      await sequelize.query(
        `WITH recovered AS (
           UPDATE smart_sends
              SET status = 'UNKNOWN', lease_owner = NULL, lease_expires_at = NULL,
                  last_error = 'O processo perdeu a confirmação após iniciar o envio. Verifique o WhatsApp antes de reenviar.',
                  updated_at = :now
            WHERE status = 'SENDING' AND lease_expires_at < :now
            RETURNING plan_id
         )
         UPDATE smart_plans sp
            SET status = 'PAUSED', completed_at = NULL, updated_at = :now
           FROM (SELECT DISTINCT plan_id FROM recovered) affected
          WHERE sp.id = affected.plan_id AND sp.status = 'SCHEDULED'`,
        { replacements: { now }, transaction, type: QueryTypes.UPDATE },
      )
      await sequelize.query(
        `WITH exhausted AS (
           UPDATE smart_sends
              SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
                  last_error = 'Limite de tentativas verificadas pelo operador atingido.', updated_at = :now
            WHERE status = 'PENDING' AND attempts >= max_attempts
            RETURNING plan_id
         )
         UPDATE smart_plans sp
            SET status = 'PAUSED', completed_at = NULL, updated_at = :now
           FROM (SELECT DISTINCT plan_id FROM exhausted) affected
          WHERE sp.id = affected.plan_id AND sp.status IN ('SCHEDULED', 'PAUSED')`,
        { replacements: { now }, transaction, type: QueryTypes.UPDATE },
      )
      await sequelize.query(
        `UPDATE smart_plans sp
            SET status = 'PAUSED', completed_at = NULL, updated_at = :now
          WHERE sp.status = 'SCHEDULED'
            AND EXISTS (
              SELECT 1 FROM smart_sends attention
               WHERE attention.plan_id = sp.id AND attention.status IN ('UNKNOWN', 'FAILED')
            )`,
        { replacements: { now }, transaction, type: QueryTypes.UPDATE },
      )
    })
  }

  private async abortPreparedDelivery(
    plan: SmartPlan,
    send: SmartSend,
    claim: ProductGroupDelivery,
    reason: string,
  ): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      const [released] = await SmartSend.update(
        {
          status: SMART_SEND_STATUS.PENDING,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: reason,
        },
        {
          where: {
            id: send.id,
            userId: send.userId,
            leaseOwner: this.ownerId,
            status: SMART_SEND_STATUS.SENDING,
          },
          transaction,
        },
      )
      if (released !== 1) throw new Error('A tarefa perdeu sua posse antes do cancelamento seguro.')
      const deleted = await ProductGroupDelivery.destroy({
        where: {
          id: claim.id,
          claimToken: claim.claimToken,
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
        },
        transaction,
      })
      if (deleted !== 1) throw new Error('A reserva de entrega mudou antes do cancelamento seguro.')
      await SmartPlan.update(
        { status: SMART_PLAN_STATUS.PAUSED },
        {
          where: { id: plan.id, userId: send.userId, status: SMART_PLAN_STATUS.SCHEDULED },
          transaction,
        },
      )
    })
  }

  private async releaseUnexpectedClaim(send: SmartSend, error: unknown): Promise<void> {
    const now = this.now()
    await SmartSend.update(
      {
        scheduledAt: new Date(now.getTime() + 30 * 1000),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: `Falha interna antes do envio: ${this.errorMessage(error)}`,
      },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
      },
    )
  }

  private async lastDeliveryAt(
    send: SmartSend,
    transaction: Transaction,
  ): Promise<{ destination: Date | null; account: Date | null }> {
    const rows = await sequelize.query<{ destination_at: Date | null; account_at: Date | null }>(
      `WITH deliveries AS (
         SELECT cl.group_id, cl.sent_at AS happened_at
           FROM campaign_logs cl
           JOIN campaigns c ON c.id = cl.campaign_id AND c.user_id = :userId
          WHERE cl.success = true AND cl.connection_scope = :scope
         UNION ALL
         SELECT ss.group_id, COALESCE(ss.sent_at, ss.updated_at) AS happened_at
           FROM smart_sends ss
          WHERE ss.user_id = :userId AND ss.connection_scope = :scope
            AND ss.status IN ('SENDING', 'SENT', 'UNKNOWN') AND ss.id <> :sendId
         UNION ALL
         SELECT pgd.group_id, COALESCE(pgd.sent_at, pgd.heartbeat_at) AS happened_at
           FROM product_group_deliveries pgd
          WHERE pgd.user_id = :userId AND pgd.connection_scope = :scope
            AND pgd.status = 'SENDING' AND pgd.campaign_id IS NOT NULL
       )
       SELECT MAX(happened_at) FILTER (WHERE group_id = :groupId) AS destination_at,
              MAX(happened_at) AS account_at
         FROM deliveries`,
      {
        replacements: {
          userId: send.userId,
          scope: send.connectionScope,
          groupId: send.groupId,
          sendId: send.id,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    )
    const row = rows[0]
    return {
      destination: row?.destination_at ? new Date(row.destination_at) : null,
      account: row?.account_at ? new Date(row.account_at) : null,
    }
  }

  private async dailyDeliveryCount(
    send: SmartSend,
    policy: SmartAudiencePolicy,
    now: Date,
    transaction: Transaction,
  ): Promise<number> {
    const localDate = getSmartLocalParts(now, policy.timezone).date
    const dayStart = smartLocalDateTime(localDate, '00:00', policy.timezone)
    const dayEnd = smartLocalDateTime(addLocalDays(localDate, 1), '00:00', policy.timezone)
    const rows = await sequelize.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT 'legacy:' || cl.id::text AS event_id
           FROM campaign_logs cl
           JOIN campaigns c ON c.id = cl.campaign_id AND c.user_id = :userId
          WHERE cl.success = true AND cl.connection_scope = :scope AND cl.group_id = :groupId
            AND cl.sent_at >= :dayStart AND cl.sent_at < :dayEnd
         UNION ALL
         SELECT 'smart:' || ss.id::text AS event_id
           FROM smart_sends ss
          WHERE ss.user_id = :userId AND ss.connection_scope = :scope AND ss.group_id = :groupId
            AND (
              (ss.status = 'SENDING' AND ss.local_date = :localDate)
              OR
              (ss.status IN ('SENT', 'UNKNOWN')
                AND COALESCE(ss.sent_at, ss.updated_at) >= :dayStart
                AND COALESCE(ss.sent_at, ss.updated_at) < :dayEnd)
            )
         UNION ALL
         SELECT 'legacy-inflight:' || pgd.id::text AS event_id
           FROM product_group_deliveries pgd
          WHERE pgd.user_id = :userId AND pgd.connection_scope = :scope AND pgd.group_id = :groupId
            AND pgd.campaign_id IS NOT NULL AND pgd.status = 'SENDING'
            AND pgd.created_at >= :dayStart AND pgd.created_at < :dayEnd
       ) counted`,
      {
        replacements: {
          userId: send.userId,
          scope: send.connectionScope,
          groupId: send.groupId,
          localDate,
          dayStart,
          dayEnd,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    )
    return Number(rows[0]?.count ?? 0)
  }

  private async pauseForBlock(plan: SmartPlan, send: SmartSend, reason: string): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      await SmartPlan.update(
        { status: SMART_PLAN_STATUS.PAUSED },
        {
          where: { id: plan.id, userId: send.userId, status: SMART_PLAN_STATUS.SCHEDULED },
          transaction,
        },
      )
      await SmartSend.update(
        { leaseOwner: null, leaseExpiresAt: null, lastError: reason },
        {
          where: {
            id: send.id,
            userId: send.userId,
            leaseOwner: this.ownerId,
            status: SMART_SEND_STATUS.PENDING,
          },
          transaction,
        },
      )
    })
  }

  private async reschedule(
    send: SmartSend,
    scheduledAt: Date,
    localDate: string,
    reason: string,
  ): Promise<void> {
    await SmartSend.update(
      { scheduledAt, localDate, leaseOwner: null, leaseExpiresAt: null, lastError: reason },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
      },
    )
  }

  private async rescheduleInTransaction(
    send: SmartSend,
    scheduledAt: Date,
    localDate: string,
    reason: string,
    transaction: Transaction,
  ): Promise<void> {
    await SmartSend.update(
      { scheduledAt, localDate, leaseOwner: null, leaseExpiresAt: null, lastError: reason },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
        transaction,
      },
    )
  }

  private async finishWithoutProvider(
    send: SmartSend,
    status: SMART_SEND_STATUS,
    reason: string,
  ): Promise<void> {
    await SmartSend.update(
      { status, leaseOwner: null, leaseExpiresAt: null, lastError: reason },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
      },
    )
  }

  private async finishInTransaction(
    send: SmartSend,
    status: SMART_SEND_STATUS,
    reason: string,
    transaction: Transaction,
  ): Promise<void> {
    await SmartSend.update(
      { status, leaseOwner: null, leaseExpiresAt: null, lastError: reason },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
        transaction,
      },
    )
  }

  private async releaseLeaseInTransaction(
    send: SmartSend,
    transaction: Transaction,
    reason: string,
  ): Promise<void> {
    await SmartSend.update(
      { leaseOwner: null, leaseExpiresAt: null, lastError: reason },
      {
        where: {
          id: send.id,
          userId: send.userId,
          leaseOwner: this.ownerId,
          status: SMART_SEND_STATUS.PENDING,
        },
        transaction,
      },
    )
  }

  private async completePlans(planIds: Set<number>): Promise<void> {
    const completionCandidates = await sequelize.query<{ id: number }>(
      `SELECT sp.id
         FROM smart_plans sp
        WHERE sp.status = 'SCHEDULED'
          AND NOT EXISTS (
            SELECT 1 FROM smart_sends ss
             WHERE ss.plan_id = sp.id AND ss.status IN ('PENDING', 'SENDING')
          )
        LIMIT 100`,
      { type: QueryTypes.SELECT },
    )
    for (const candidate of completionCandidates) planIds.add(candidate.id)
    for (const planId of planIds) {
      const counts = (await SmartSend.findAll({
        where: { planId },
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true,
      })) as unknown as Array<{ status: SMART_SEND_STATUS; count: string }>
      const progress = Object.fromEntries(
        counts.map((row) => [row.status.toLowerCase(), Number(row.count)]),
      )
      const active = (progress.pending ?? 0) + (progress.sending ?? 0)
      const unknown = progress.unknown ?? 0
      const failed = progress.failed ?? 0
      await SmartPlan.update(
        failed > 0
          ? { status: SMART_PLAN_STATUS.PAUSED, completedAt: null, progress }
          : unknown > 0
            ? { status: SMART_PLAN_STATUS.PAUSED, completedAt: null, progress }
            : active === 0
              ? { status: SMART_PLAN_STATUS.COMPLETED, completedAt: this.now(), progress }
              : { progress },
        { where: { id: planId, status: SMART_PLAN_STATUS.SCHEDULED } },
      )
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'erro desconhecido'
  }
}
