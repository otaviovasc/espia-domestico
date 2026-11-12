import { createHash, randomUUID } from 'node:crypto'
import { Op, QueryTypes } from 'sequelize'
import { injectable, inject } from 'tsyringe'
import { sequelize } from '@/database'
import { env } from '@/config/env'
import {
  dailyWindow,
  dailyItemTarget,
  dailyRequiredItems,
  dailyCandidateTarget,
  dailyRemainingCapacity,
  type DailyAutomationConfig,
} from '@/config/dailyAutomation'
import { AppError } from '@/middleware/Error/AppError'
import { SmartAudience } from '@/database/models/SmartAudience'
import { Campaign, CAMPAIGN_STATUS_ENUM } from '@/database/models/Campaign'
import { SmartPlan, SMART_PLAN_STATUS } from '@/database/models/SmartPlan'
import { SmartCampaignService, smartZonedInstant, isEvidenceFresh } from '@/services/SmartCampaignService'
import {
  DailyCollectionError,
  DailyProductCollector,
  DAILY_AUDIENCES,
  type DailyPayload,
  type DailyCollectionRequest,
} from '@/services/DailyProductCollector'
import { SavedProduct } from '@/database/models/SavedProduct'
import { OfferSchema, type OfferInput } from '@/dtos/campaign'
import { MlLoginRecovery } from '@/services/MlLoginRecovery'
import { DailyAutomationAlerts } from '@/services/DailyAutomationAlerts'
import { DAILY_DISCOVERY_ROUND_SIZE, dailyDiscoveryPage } from '@/utils/dailyDiscovery'
import { dailyPlanCoverage } from '@/utils/dailyPlanCoverage'
import { logger } from '@/utils/logger'
import { dailyCollectionObservation, dailyCollectionSummary, type DailyCollectionMetrics } from '@/utils/dailyObservability'
import { normalizedMercadoLivreProductId, type OfferIdentityInput } from '@/utils/offerIdentity'
import { dailyExcludedProductIds, dailyOfferAliases, dailySelectionAliases, dailyProductConflicts, dailyRepeatCooldown, type DailyRepeatPolicy } from '@/services/dailyNovelty'

interface DailyRun {
  id: string
  user_id: number
  local_date: string
  request_id: string
  config: DailyAutomationConfig
  status: string
  payloads: DailyPayload[] | null
  plan_uuid: string | null
  attempts: number
  discovery_state?: { round?: number; pending?: DailyPayload[]; exhausted?: boolean; collected?: boolean; initialRounds?: Partial<Record<(typeof DAILY_AUDIENCES)[number], number>>; repeatSelected?: number; offline?: boolean; collectionMetrics?: DailyCollectionMetrics; collectionSummary?: ReturnType<typeof dailyCollectionSummary> }
  approval_attempts: number
  approval_revision: number | null
  last_error: string | null
  updated_at: Date
  lease_token: string
}

export function dailyRequestId(userId: number, date: string): string {
  const hex = createHash('sha256').update(`daily-automation:v1:${userId}:${date}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function payloadOffers(payload: DailyPayload): unknown[] {
  return Array.isArray(payload.json.cards) ? payload.json.cards : Array.isArray(payload.json.offers) ? payload.json.offers : []
}

const APPROVAL_RECOVERABLE_CODES = [
  'SMART_PLAN_REVISION_CONFLICT', 'SMART_CONNECTION_CHANGED', 'SMART_BINDINGS_CHANGED',
  'DAILY_NOVELTY_CONFLICT', 'DAILY_INVENTORY_SHORTAGE', 'CONFLICT', 'LATE_ANALYSIS',
  'INSUFFICIENT_QUALIFIED_PRODUCTS', 'PREPARATION_DEADLINE_MISSED',
]
const CLAIMABLE_RUN = `((status IN ('COLLECTING','ANALYZING','ANALYSIS_HOLD','RETRY','REPLENISHING','AUTH_REQUIRED')
  OR (config->>'autoApprove'='true' AND approval_attempts<256 AND
    ((status='REVIEW' AND (last_error IS NULL OR last_error IN (:approvalCodes)))
      OR (status='OPERATOR_ATTENTION' AND last_error IN (:approvalCodes)))))
  OR (config->>'autoApprove'='true' AND status IN ('REVIEW','OPERATOR_ATTENTION') AND EXISTS (
    SELECT 1 FROM smart_plans p WHERE p.user_id=daily_automation_runs.user_id
      AND p.input->>'requestId'=daily_automation_runs.request_id::text
      AND p.status IN ('SCHEDULED','PAUSED','COMPLETED','CANCELLED'))))`

@injectable()
export class DailyAutomationService {
  private readonly abort = new AbortController()

  constructor(
    @inject(SmartCampaignService) private readonly smart: SmartCampaignService,
    @inject(DailyProductCollector) private readonly collector: DailyProductCollector,
    @inject(DailyAutomationAlerts, { isOptional: true }) private readonly alerts?: DailyAutomationAlerts,
    @inject(MlLoginRecovery, { isOptional: true }) private readonly login?: MlLoginRecovery,
  ) {}

  stop(): void {
    this.abort.abort()
  }

  private windowExpired(config: DailyAutomationConfig, date: string, now = new Date()): boolean {
    const local = dailyWindow(config, now).date
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now)
    return local > date || (local === date && time >= config.endTime)
  }

  private async save(run: DailyRun, status: string, error: string | null = null, detail = ''): Promise<void> {
    let state = run.discovery_state ?? {}
    let summaryLog: ReturnType<typeof dailyCollectionSummary> | undefined
    if (['SCHEDULED', 'REVIEW', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'AUTH_REQUIRED', 'CONFIG_REQUIRED'].includes(status)) {
      const plan = run.plan_uuid ? await SmartPlan.findOne({ where: { uuid: run.plan_uuid, userId: run.user_id } }) : null
      const metrics = state.collectionMetrics ?? { observations: {} }
      const summary = dailyCollectionSummary(metrics, plan?.items ?? [], run.config.repeatCooldownDays)
      if (!metrics.summaryLogged) summaryLog = summary
      state = { ...state, collectionSummary: summary, collectionMetrics: { ...metrics, summaryLogged: true } }
    }
    const saved = await sequelize.query<{ id: string }>(
      `UPDATE daily_automation_runs
      SET status=:status, last_error=:error, discovery_state=CAST(:discoveryState AS JSONB), lease_token=NULL, lease_until=NULL,
          attempts=attempts + CASE WHEN :error IS NOT NULL AND :status IN ('RETRY','FAILED') THEN 1 ELSE 0 END,
          next_attempt_at=CASE WHEN :status IN ('ANALYZING','ANALYSIS_HOLD') THEN NOW()
            ELSE NOW() + INTERVAL '15 minutes' END, updated_at=NOW()
      WHERE id=:id AND lease_token=:token RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: { status, error, discoveryState: JSON.stringify(state), id: run.id, token: run.lease_token },
      },
    )
    if (saved.length) {
      run.discovery_state = state
      if (summaryLog) logger.info(
        { dailyRunId: run.id, planUuid: run.plan_uuid, date: run.local_date, status, ...summaryLog },
        'Daily collection summary',
      )
      if (run.status !== status || run.last_error !== error) logger.info(
        { dailyRunId: run.id, planUuid: run.plan_uuid, date: run.local_date, previousStatus: run.status, status, code: error },
        'Daily automation checkpoint',
      )
    }
    if (saved.length && error) {
      try {
        await this.alerts?.enqueue(run.config, run.local_date, run.plan_uuid ? `${run.plan_uuid}:${error}` : `${run.id}:${status}:${error}`, error, detail)
      } catch {
        logger.warn({ dailyRunId: run.id, code: 'ALERT_PERSIST_FAILED' }, 'Daily checkpoint saved; alert persistence failed')
      }
    }
  }

  /** Leave thirty minutes for analysis/approval before the first target slot. */
  private collectionDeadline(run: DailyRun): number {
    return smartZonedInstant(run.local_date, run.config.startTime, run.config.timezone).getTime() - 30 * 60_000
  }

  private async collect(run: DailyRun, requests: DailyCollectionRequest[], checkpoint?: (payload: DailyPayload) => Promise<void>): Promise<DailyPayload[]> {
    const remaining = this.collectionDeadline(run) - Date.now()
    if (remaining <= 0 && (run.attempts > 0 || run.last_error === 'AUTH_REQUIRED')) throw new DailyCollectionError('COLLECTION_TIMEOUT')
    // A final live attempt is permitted for a late/startup run; once it fails,
    // collectionBackoff switches durably to inventory, without further browsing.
    const signal = remaining > 0 ? AbortSignal.any([this.abort.signal, AbortSignal.timeout(remaining)]) : this.abort.signal
    try {
      return await this.collector.collect(requests, signal, checkpoint, this.login ? page => this.login!.recover(page, run.config) : undefined)
    } catch (error) {
      if (!this.abort.signal.aborted && signal.aborted) throw new DailyCollectionError('COLLECTION_TIMEOUT')
      throw error
    }
  }

  private async collectionBackoff(run: DailyRun, code: string): Promise<void> {
    const remaining = this.collectionDeadline(run) - Date.now()
    const offline = remaining <= 0
    if (offline) {
      run.discovery_state = { ...run.discovery_state, offline: true, exhausted: true }
      await this.discoveryCheckpoint(run)
    }
    const seconds = offline ? 0 : Math.min(900, 60 * 2 ** Math.min(4, run.attempts), Math.max(1, Math.ceil(remaining / 1000)))
    await this.requireLease(run)
    const rows = await sequelize.query<{ id: string }>(`UPDATE daily_automation_runs SET status='RETRY',last_error=:code,
      attempts=attempts+1,lease_token=NULL,lease_until=NULL,next_attempt_at=NOW() + :seconds * INTERVAL '1 second',updated_at=NOW()
      WHERE id=:id AND lease_token=:token RETURNING id`, {
      replacements: { id: run.id, token: run.lease_token, code, seconds }, type: QueryTypes.SELECT,
    })
    if (rows.length) await this.alerts?.enqueue(run.config, run.local_date, offline ? `${run.id}:offline` : `${run.id}:${code}`, offline ? 'DAILY_SESSION_FALLBACK' : code).catch(() => {
      logger.warn({ dailyRunId: run.id, code: 'ALERT_PERSIST_FAILED' }, 'Daily collection retry saved; alert persistence failed')
    })
  }

  /** Stored observations only: never renew timestamps or generate affiliate links. */
  private async offlineInventory(run: DailyRun, audiences: SmartAudience[]): Promise<void> {
    await this.requireLease(run)
    const [saved, plans] = await Promise.all([
      SavedProduct.findAll({ where: { userId: run.user_id }, attributes: ['offer'], order: [['updatedAt', 'DESC']], limit: 1000 }),
      SmartPlan.findAll({ where: { userId: run.user_id }, attributes: ['input', 'items'], order: [['createdAt', 'DESC']], limit: 20 }),
    ])
    const stored = [...saved.map(row => row.offer), ...plans.flatMap(plan => [
      ...((plan.input as { offers?: OfferInput[] }).offers ?? []),
      ...plan.items.filter(item => (item.state === 'SELECTED' || item.state === 'RESERVE')).map(item => item.product),
    ])]
    const firstSlot = new Date(Math.max(Date.now(), smartZonedInstant(run.local_date, run.config.startTime, run.config.timezone).getTime()))
    const payloads = [...(run.payloads ?? [])]
    for (const audience of audiences) {
      const existing = payloads.filter(p => p.targetAudienceSlug === audience.slug).flatMap(payloadOffers)
      const identities = new Set(existing.flatMap(card => dailyOfferAliases(card as OfferIdentityInput)))
      const offers: OfferInput[] = []
      for (const value of stored) {
        const parsed = OfferSchema.safeParse(value)
        if (!parsed.success) continue
        const offer = parsed.data
        if (offer.source?.trim().toLowerCase() !== 'mercadolivre' || offer.commissioned !== true || !offer.commissionedUrlStatus
          || !isEvidenceFresh(offer.extensionEvidence?.extractedAt, firstSlot, Math.min(24, audience.policy.freshnessHours))) continue
        const aliases = dailyOfferAliases(offer)
        if (aliases.some(alias => identities.has(alias))) continue
        aliases.forEach(alias => identities.add(alias))
        offers.push(offer)
      }
      const filtered = await this.filterPayload(run, { name: `offline-${audience.slug}.json`, targetAudienceSlug: audience.slug as DailyPayload['targetAudienceSlug'], json: { offers } })
      const cards = payloadOffers(filtered).sort((a, b) => Number(Boolean((a as { repeatFallback?: boolean }).repeatFallback)) - Number(Boolean((b as { repeatFallback?: boolean }).repeatFallback)))
        .slice(0, Math.max(0, run.config.candidateLimit - existing.length))
      if (cards.length) payloads.push({ ...filtered, json: { offers: cards } })
    }
    await this.requireLease(run)
    run.payloads = payloads
    await sequelize.query(`UPDATE daily_automation_runs SET payloads=CAST(:payloads AS JSONB),updated_at=NOW() WHERE id=:id AND lease_token=:token`, {
      replacements: { id: run.id, token: run.lease_token, payloads: JSON.stringify(payloads) },
    })
    await this.alerts?.enqueue(run.config, run.local_date, `${run.id}:offline`, 'DAILY_SESSION_FALLBACK').catch(() => {
      logger.warn({ dailyRunId: run.id, code: 'ALERT_PERSIST_FAILED' }, 'Daily offline inventory saved; alert persistence failed')
    })
    if (!payloads.some(payload => payloadOffers(payload).length)) throw new AppError('No eligible offline inventory', 409, 'DAILY_OFFLINE_INVENTORY_EMPTY')
  }

  private async approveCheckpoint(run: DailyRun, plan: SmartPlan): Promise<void> {
    if ((plan.settings.dailyAutomation as { operatorHold?: boolean } | undefined)?.operatorHold) {
      await this.save(run, 'OPERATOR_ATTENTION', 'DAILY_OPERATOR_HOLD')
      return
    }
    if (run.approval_attempts >= 256) {
      await this.save(run, 'OPERATOR_ATTENTION', 'DAILY_APPROVAL_RETRY_LIMIT')
      return
    }
    await this.requireLease(run)
    await sequelize.query(`UPDATE daily_automation_runs SET approval_attempts=approval_attempts+1,
      approval_revision=:revision WHERE id=:id AND lease_token=:token`, {
      replacements: { id: run.id, token: run.lease_token, revision: plan.revision },
    })
    run.approval_attempts++
    run.approval_revision = plan.revision
    await this.smart.approve(run.user_id, plan.uuid, plan.revision, { automatic: true })
    await plan.reload()
    run.discovery_state = { ...run.discovery_state, repeatSelected: plan.items.filter(item => item.state === 'SELECTED' && item.repeatFallback).length }
    await this.discoveryCheckpoint(run)
    await this.save(run, plan.status)
  }

  private async approvalBackoff(run: DailyRun, code: string, counted: boolean): Promise<void> {
    if (!counted) {
      await sequelize.query('UPDATE daily_automation_runs SET approval_attempts=approval_attempts+1 WHERE id=:id AND lease_token=:token', { replacements: { id: run.id, token: run.lease_token } })
      run.approval_attempts++
    }
    if (run.approval_attempts >= 256) {
      await this.save(run, 'OPERATOR_ATTENTION', 'DAILY_APPROVAL_RETRY_LIMIT')
      return
    }
    const seconds = Math.min(900, 30 * 2 ** Math.min(5, Math.max(0, run.approval_attempts - 1)))
    await sequelize.query(`UPDATE daily_automation_runs SET status='OPERATOR_ATTENTION',last_error=:code,
      lease_token=NULL,lease_until=NULL,next_attempt_at=NOW() + :seconds * INTERVAL '1 second',updated_at=NOW()
      WHERE id=:id AND lease_token=:token`, { replacements: { id: run.id, token: run.lease_token, code, seconds } })
    await this.alerts?.enqueue(run.config, run.local_date, `${run.id}:${code}`, 'AUTO_APPROVAL_STALLED').catch(() => {
      logger.warn({ dailyRunId: run.id, code: 'ALERT_PERSIST_FAILED' }, 'Daily approval retry saved; alert persistence failed')
    })
  }

  private async discoveryCheckpoint(run: DailyRun): Promise<void> {
    await this.requireLease(run)
    await sequelize.query(`UPDATE daily_automation_runs SET discovery_state=CAST(:state AS JSONB), updated_at=NOW() WHERE id=:id AND lease_token=:token`, {
      replacements: { id: run.id, token: run.lease_token, state: JSON.stringify(run.discovery_state) },
    })
  }

  private async collectObserved(run: DailyRun, requests: DailyCollectionRequest[],
    checkpoint: (payload: DailyPayload) => Promise<void>): Promise<DailyPayload[]> {
    const state = run.discovery_state ??= {}
    const metrics = state.collectionMetrics ??= { observations: {} }
    const startedAt = performance.now()
    try {
      return await this.collect(run, requests, checkpoint)
    } finally {
      // Include failed attempts and browser setup/teardown in total collection time.
      metrics.durationMs = (metrics.durationMs ?? 0) + Math.round(performance.now() - startedAt)
      state.collectionSummary = dailyCollectionSummary(metrics, [], run.config.repeatCooldownDays)
      if (!this.abort.signal.aborted) await this.discoveryCheckpoint(run)
    }
  }

  private async inventoryWarning(run: DailyRun, payload: DailyPayload): Promise<void> {
    // Assess the audience's accumulated pool, not the size of one refill. This
    // warns about an actual raw-candidate deficit; qualification has its own
    // plan/readiness alerts. Headroom is a collection target, not a daily need.
    const pooled = [...(run.payloads ?? []), ...(run.discovery_state?.pending ?? []), payload]
      .filter(value => value.targetAudienceSlug === payload.targetAudienceSlug)
      .flatMap(payloadOffers)
    const fresh = new Set(pooled
      .filter(card => !(card as { repeatFallback?: boolean }).repeatFallback)
      .map(card => normalizedMercadoLivreProductId((card as { productId?: string }).productId)).filter(Boolean)).size
    const required = dailyRequiredItems(run.config)
    if (fresh >= required) return
    try {
      await this.alerts?.enqueueInventoryLow(run.config, run.local_date, `${run.id}:${payload.targetAudienceSlug}`,
        payload.targetAudienceSlug, fresh, required)
    } catch {
      logger.warn({ dailyRunId: run.id, code: 'ALERT_PERSIST_FAILED' }, 'Daily inventory warning persistence failed')
    }
  }

  /** Coverage after removing selected items that repeat history or another audience's selection. */
  private async noveltyCoverage(run: DailyRun, plan: SmartPlan, audiences: SmartAudience[]) {
    const selected = plan.items.filter(item => item.state === 'SELECTED')
    const histories = new Map(await Promise.all(audiences.map(async audience => [audience.slug,
      await dailyProductConflicts(run.user_id, plan.id, plan.uuid,
        selected.filter(item => item.audienceSlug === audience.slug).flatMap(item => item.product ? [item.product as OfferIdentityInput] : []),
        undefined, { ...run.config, groupIds: audience.destinations.map(d => d.groupId) })] as const)))
    const fallbackReady = (plan.settings.dailyAutomation as { repeatFallbackReady?: boolean } | undefined)?.repeatFallbackReady
    const identities = new Set<string>()
    const effective = plan.items.filter(item => {
      if (item.state !== 'SELECTED' || !item.product) return true
      const aliases = dailySelectionAliases(item.product as OfferIdentityInput)
      const history = histories.get(String(item.audienceSlug))!
      if (aliases.some(identity => history.has(identity) || (!fallbackReady && history.repeats.has(identity)) || identities.has(identity))) return false
      aliases.forEach(identity => identities.add(identity))
      return true
    })
    const coverage = dailyPlanCoverage(effective, run.config, run.local_date)
    for (const audience of coverage.audiences) {
      audience.required = Math.max(audience.required, selected.filter(item => item.audienceSlug === audience.slug).length)
      audience.missing = Math.max(0, audience.required - audience.selected)
    }
    coverage.ready = coverage.audiences.every(audience => !audience.missing && audience.completeSchedule)
    return { coverage, noveltyShortage: effective.length < plan.items.length }
  }

  private async replenish(run: DailyRun, plan: SmartPlan, audiences: SmartAudience[], coverage = dailyPlanCoverage(plan.items, run.config, run.local_date)): Promise<boolean> {
    // Round payloads are durable before append. Replaying an interrupted append uses
    // the same request ID and therefore cannot purchase the same analysis twice.
    const state = run.discovery_state ??= { round: 1 }
    const round = state.round ?? 1
    const retainedPending = state.offline && state.pending?.some(payload => payloadOffers(payload).length)
    if ((state.exhausted && !retainedPending) || this.windowExpired(run.config, run.local_date)) return false
    if (state.offline) {
      if (!retainedPending) return false
      state.collected = true // Append the durable partial round without another browser.
    }
    const pooled = (run.payloads ?? []).flatMap(p => payloadOffers(p))
    const ids = pooled.map(card => normalizedMercadoLivreProductId((card as { productId?: string }).productId)).filter((id): id is string => Boolean(id))
    const histories = new Map(await Promise.all(audiences.map(async audience => [audience.slug, await this.exclusions(run.user_id, run.config, audience.destinations.map(d => d.groupId), plan)] as const)))
    const requests = DAILY_AUDIENCES.flatMap(slug => {
      if (!coverage.audiences.some(a => a.slug === slug && (a.missing > 0 || !a.completeSchedule || (dailyRepeatCooldown(run.config) && a.selected < dailyItemTarget(run.config))))) return []
      const existing = (run.payloads ?? []).filter(p => p.targetAudienceSlug === slug).reduce((n, p) => n + (payloadOffers(p).length), 0)
      const audience = audiences.find(a => a.slug === slug)!
      const keywords = dailyDiscoveryPage(slug, audience.profile.keywords, round + (state.initialRounds?.[slug] ?? 0), run.local_date)
      const limit = Math.min(DAILY_DISCOVERY_ROUND_SIZE, run.config.candidateLimit - existing)
      if (limit <= 0 || !keywords) return []
      return [{ slug, options: { limit, keywords, matchMode: 'any', matchStyle: 'word',
        excludeProductIds: [...new Set([...(histories.get(slug) ?? []), ...ids])], excludePolitical: true,
        quality: { minRating: run.config.minRating, minSoldCount: run.config.minSoldCount },
        minPrice: audience.policy.minPrice, maxPrice: audience.policy.maxPrice,
        commission: { minPercent: audience.policy.minCommissionPercent, minEstimatedBrl: audience.policy.minEstimatedCommission } } }]
    })
    if (!state.pending && !requests.length) { state.exhausted = true; await this.discoveryCheckpoint(run); return false }
    if (requests.some(request => request.options.excludeProductIds.length + request.options.limit > 50_000))
      throw new DailyCollectionError('HISTORY_LIMIT')
    if (!state.collected) {
      state.pending ??= []
      await this.discoveryCheckpoint(run)
      const payloads = await this.collectObserved(run, requests.filter(r => !state.pending?.some(p => p.targetAudienceSlug === r.slug)), async payload => {
        const filtered = await this.filterPayload(run, payload, plan)
        state.pending = [...(state.pending ?? []).filter(p => p.targetAudienceSlug !== payload.targetAudienceSlug), filtered]
        await this.discoveryCheckpoint(run)
        await this.inventoryWarning(run, filtered)
      })
      const remaining = payloads.filter(p => !state.pending?.some(old => old.targetAudienceSlug === p.targetAudienceSlug))
      state.pending = [...state.pending, ...await Promise.all(remaining.map(payload => this.filterPayload(run, payload, plan)))]
      state.collected = true
      await this.discoveryCheckpoint(run)
      for (const payload of state.pending.filter(p => payloads.some(next => next.targetAudienceSlug === p.targetAudienceSlug)))
        await this.inventoryWarning(run, payload)
    }
    const pending = state.pending ?? []
    if (pending.some(p => payloadOffers(p).length)) {
      await this.requireLease(run)
      await this.smart.appendDailyProducts(run.user_id, plan.uuid, plan.revision, pending, dailyRequestId(run.user_id, `${run.request_id}:round:${round}`))
      // Keep the original extraction timestamps and audience provenance unchanged.
      run.payloads = [...(run.payloads ?? []).filter(p => !pending.some(next => next.name === p.name && next.targetAudienceSlug === p.targetAudienceSlug && JSON.stringify(next.json) === JSON.stringify(p.json))), ...pending]
      await sequelize.query(`UPDATE daily_automation_runs SET payloads=CAST(:payloads AS JSONB) WHERE id=:id AND lease_token=:token`, {
        replacements: { id: run.id, token: run.lease_token, payloads: JSON.stringify(run.payloads) },
      })
    }
    state.round = round + 1
    delete state.pending
    delete state.collected
    // Even empty discovery advances its finite keyword inventory, never the same
    // zero-result query forever. Exhaustion becomes an explicit held preview.
    await this.discoveryCheckpoint(run)
    await this.save(run, pending.length ? 'ANALYZING' : 'REPLENISHING')
    return true
  }

  private async checkpointPayload(run: DailyRun, payload: DailyPayload): Promise<void> {
    payload = await this.filterPayload(run, payload)
    await this.discoveryCheckpoint(run)
    if (!payloadOffers(payload).length) {
      await this.requireLease(run)
      await this.inventoryWarning(run, payload)
      return
    }
    await this.requireLease(run)
    const payloads = [
      ...(run.payloads ?? []).filter(
        (value) => value.targetAudienceSlug !== payload.targetAudienceSlug,
      ),
      payload,
    ]
    const complete = DAILY_AUDIENCES.every((slug) =>
      payloads.some((value) => value.targetAudienceSlug === slug),
    )
    await sequelize.query(
      `UPDATE daily_automation_runs SET payloads=CAST(:payloads AS JSONB),
      attempts=CASE WHEN :complete THEN 0 ELSE attempts END, updated_at=NOW() WHERE id=:id AND lease_token=:token`,
      {
        replacements: {
          id: run.id,
          token: run.lease_token,
          payloads: JSON.stringify(payloads),
          complete,
        },
      },
    )
    run.payloads = payloads
    if (complete) run.attempts = 0
    await this.inventoryWarning(run, payload)
  }

  private async checkpointPlan(run: DailyRun, plan: SmartPlan): Promise<void> {
    await sequelize.query(
      `UPDATE daily_automation_runs SET plan_uuid=:uuid,
      attempts=CASE WHEN plan_uuid IS NULL THEN 0 ELSE attempts END, updated_at=NOW() WHERE id=:id AND lease_token=:token`,
      {
        replacements: { uuid: plan.uuid, id: run.id, token: run.lease_token },
      },
    )
    if (!run.plan_uuid) run.attempts = 0
    run.plan_uuid = plan.uuid
  }

  private async requireLease(run: DailyRun): Promise<void> {
    if (this.abort.signal.aborted) throw new DailyCollectionError('STOPPED')
    const rows = await sequelize.query<{ id: string }>(
      `UPDATE daily_automation_runs
      SET lease_until=NOW() + INTERVAL '30 minutes'
      WHERE id=:id AND lease_token=:token AND lease_until>NOW() RETURNING id`,
      {
        replacements: { id: run.id, token: run.lease_token },
        type: QueryTypes.SELECT,
      },
    )
    if (!rows.length) throw new DailyCollectionError('STOPPED')
  }

  private async exclusions(userId: number, config: DailyRepeatPolicy = {}, groupIds: string[] = [], plan?: SmartPlan): Promise<string[]> {
    return dailyExcludedProductIds(userId, plan?.id, plan?.uuid, { ...config, groupIds })
  }

  private async filterPayload(run: DailyRun, payload: DailyPayload, plan?: SmartPlan): Promise<DailyPayload> {
    const state = run.discovery_state ??= {}
    const metrics = state.collectionMetrics ??= { observations: {} }
    const key = `${plan ? 'replenish' : 'initial'}:${plan ? state.round ?? 1 : state.initialRounds?.[payload.targetAudienceSlug] ?? 0}:${payload.targetAudienceSlug}`
    metrics.observations[key] = dailyCollectionObservation(payload)
    if (!payloadOffers(payload).length) return payload
    const offers = payloadOffers(payload).map(card => {
      const value = card as { productId?: string; title?: string; affiliateUrl?: string; commissionedUrl?: string; productUrl?: string } | null
      const url = value?.affiliateUrl || value?.commissionedUrl || value?.productUrl
      return { source: 'mercadolivre', productId: typeof value?.productId === 'string' ? value.productId : undefined,
        title: typeof value?.title === 'string' ? value.title : undefined,
        affiliateUrl: typeof url === 'string' ? url : '' }
    })
    const audience = await SmartAudience.findOne({ where: { userId: run.user_id, slug: payload.targetAudienceSlug } })
    const conflicts = await dailyProductConflicts(run.user_id, plan?.id ?? null, plan?.uuid ?? null, offers,
      undefined, { ...run.config, groupIds: audience?.destinations.map(d => d.groupId) })
    const cards = payloadOffers(payload).flatMap((card, index) => {
      const aliases = dailyOfferAliases(offers[index])
      if (aliases.some(identity => conflicts.has(identity))) {
        const code = aliases.some(identity => conflicts.cooldowns?.has(identity)) ? 'cooldown' : 'novelty'
        metrics.observations[key].rejectedByReason[code]++
        return []
      }
      return [{ ...(card as Record<string, unknown>), repeatFallback: aliases.some(identity => conflicts.repeats.has(identity)) }]
    })
    state.collectionSummary = dailyCollectionSummary(metrics, plan?.items ?? [], run.config.repeatCooldownDays)
    return { ...payload, json: { ...payload.json, [Array.isArray(payload.json.cards) ? 'cards' : 'offers']: cards } }
  }

  async tick(config: DailyAutomationConfig, now = new Date()): Promise<void> {
    if (this.abort.signal.aborted) return
    // Resume frozen preparation first, including the target morning after restart.
    const startupWindow = dailyWindow(config, now)
    const existing = await sequelize.query<{ config: DailyAutomationConfig; local_date: string }>(
      `SELECT config, local_date FROM daily_automation_runs WHERE user_id=:userId
       AND ${CLAIMABLE_RUN} AND next_attempt_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW())
       ORDER BY (local_date<CAST(:today AS DATE)),local_date ASC LIMIT 1`,
      { replacements: { userId: config.userId, today: startupWindow.date, approvalCodes: APPROVAL_RECOVERABLE_CODES }, type: QueryTypes.SELECT },
    )
    config = existing[0]?.config ?? config
    const window = dailyWindow(config, now)
    const targetDate = existing[0]?.local_date ?? startupWindow.targetDate
    if (!existing.length && !window.due) return
    await sequelize.query(
      `INSERT INTO daily_automation_runs (user_id, local_date, request_id, config)
      VALUES (:userId, :date, :requestId, CAST(:config AS JSONB)) ON CONFLICT (user_id, local_date) DO NOTHING`,
      {
        replacements: {
          userId: config.userId,
          date: targetDate,
          requestId: dailyRequestId(config.userId, targetDate),
          config: JSON.stringify(config),
        },
      },
    )
    const token = randomUUID()
    const rows = await sequelize.query<DailyRun>(
      `UPDATE daily_automation_runs
      SET lease_token=:token, lease_until=NOW() + INTERVAL '30 minutes'
      WHERE user_id=:userId AND local_date=:date
        AND ${CLAIMABLE_RUN}
        AND (lease_until IS NULL OR lease_until<NOW()) AND next_attempt_at<=NOW()
      RETURNING *`,
      {
        replacements: { userId: config.userId, date: targetDate, token, approvalCodes: APPROVAL_RECOVERABLE_CODES },
        type: QueryTypes.SELECT,
      },
    )
    const run = rows[0]
    if (!run) return
    const claimedApprovalAttempts = run.approval_attempts
    try {
      const ownedPlan = await SmartPlan.findOne({
        where: { userId: run.user_id, 'input.requestId': run.request_id },
      })
      if (
        ownedPlan &&
        [
          SMART_PLAN_STATUS.SCHEDULED,
          SMART_PLAN_STATUS.PAUSED,
          SMART_PLAN_STATUS.COMPLETED,
          SMART_PLAN_STATUS.CANCELLED,
        ].includes(ownedPlan.status)
      ) {
        await this.checkpointPlan(run, ownedPlan)
        run.discovery_state = { ...run.discovery_state, repeatSelected: ownedPlan.items.filter(item => item.state === 'SELECTED' && item.repeatFallback).length }
        await this.discoveryCheckpoint(run)
        await this.save(run, ownedPlan.status)
        return
      }
      if (!env.AI_ENABLED) {
        await this.save(run, 'CONFIG_REQUIRED', 'AI_DISABLED')
        return
      }
      // Retire only automation-owned, unapproved plans from earlier dates. A
      // concurrent operator change wins; never refetch its revision to cancel it.
      const previous = await sequelize.query<{ uuid: string; revision: number; config: DailyAutomationConfig; local_date: string }>(
        `SELECT p.uuid, p.revision, r.config, r.local_date FROM smart_plans p
        JOIN daily_automation_runs r ON p.user_id=r.user_id AND p.input->>'requestId'=r.request_id::text
        WHERE r.user_id=:userId AND r.local_date < :date
          AND p.status IN ('ANALYZING','REVIEW') LIMIT 20`,
        {
          replacements: { userId: run.user_id, date: run.local_date },
          type: QueryTypes.SELECT,
        },
      )
      for (const plan of previous) {
        if (!this.windowExpired(plan.config, plan.local_date, now)) continue
        try {
          await this.smart.cancel(run.user_id, plan.uuid, plan.revision)
        } catch (error) {
          if (!(error instanceof AppError) || error.statusCode !== 409) throw error
          logger.info(
            { dailyRunId: run.id, planUuid: plan.uuid },
            'Daily cleanup deferred after a concurrent plan change',
          )
        }
      }
      if (this.windowExpired(run.config, run.local_date, now)) {
        if (ownedPlan && [SMART_PLAN_STATUS.ANALYZING, SMART_PLAN_STATUS.REVIEW].includes(ownedPlan.status))
          await this.smart.cancel(run.user_id, ownedPlan.uuid, ownedPlan.revision)
        await this.save(run, 'EXPIRED', 'WINDOW_CLOSED')
        return
      }
      if (ownedPlan?.status === SMART_PLAN_STATUS.REVIEW && run.config.autoApprove &&
        (ownedPlan.settings.dailyAutomation as { operatorHold?: boolean } | undefined)?.operatorHold) {
        await this.save(run, 'OPERATOR_ATTENTION', 'DAILY_OPERATOR_HOLD')
        return
      }
      if (ownedPlan?.status === SMART_PLAN_STATUS.REVIEW && run.config.autoApprove &&
        (['REVIEW', 'OPERATOR_ATTENTION'].includes(run.status) || run.approval_attempts > 0)) {
        if (run.approval_revision === null && ownedPlan.updatedAt.getTime() > new Date(run.updated_at).getTime()) {
          await this.save(run, 'OPERATOR_ATTENTION', 'DAILY_OPERATOR_HOLD')
          return
        }
      }
      if (
        !ownedPlan &&
        (await SmartPlan.count({
          where: {
            userId: run.user_id,
            status: {
              [Op.in]: [
                SMART_PLAN_STATUS.ANALYZING,
                SMART_PLAN_STATUS.REVIEW,
                SMART_PLAN_STATUS.SCHEDULED,
                SMART_PLAN_STATUS.PAUSED,
              ],
            },
          },
        })) >= 2
      ) {
        await this.save(run, 'OPERATOR_ATTENTION', 'ACTIVE_PLAN_LIMIT')
        return
      }
      const audiences = await SmartAudience.findAll({
        where: { userId: run.user_id, slug: [...DAILY_AUDIENCES] },
      })
      if (
        audiences.length !== 2 ||
        audiences.some(
          (audience) =>
            !audience.enabled ||
            !audience.destinations.length ||
            audience.policy.timezone !== run.config.timezone ||
            !audience.profile.keywords.length,
        )
      ) {
        await this.save(run, 'CONFIG_REQUIRED', 'AUDIENCE_CONFIGURATION')
        return
      }
      const groups = audiences.flatMap((audience) =>
        audience.destinations.map((destination) => destination.groupId),
      )
      if (new Set(groups).size !== groups.length) {
        await this.save(run, 'CONFIG_REQUIRED', 'AUDIENCE_GROUP_OVERLAP')
        return
      }
      const legacy = await Campaign.findAll({
        where: {
          userId: run.user_id,
          status: { [Op.in]: [CAMPAIGN_STATUS_ENUM.SCHEDULED, CAMPAIGN_STATUS_ENUM.RUNNING] },
        },
        attributes: ['groups'],
      })
      if (legacy.some((campaign) => campaign.groups.some((group) => groups.includes(group.id)))) {
        await this.save(run, 'OPERATOR_ATTENTION', 'SMART_MANUAL_CAMPAIGN_CONFLICT')
        return
      }
      if (run.discovery_state?.offline && !ownedPlan) await this.offlineInventory(run, audiences)
      const missing = ownedPlan || run.discovery_state?.offline ? [] : DAILY_AUDIENCES.filter(
        (slug) =>
          !run.payloads?.some(
            (payload) =>
              payload.targetAudienceSlug === slug &&
              payloadOffers(payload).length,
          ),
      )
      if (missing.length) {
        const completedIds = (run.payloads ?? []).flatMap((payload) =>
          payloadOffers(payload)
                .map((card) =>
                  normalizedMercadoLivreProductId((card as { productId?: string }).productId),
                )
                .filter((id): id is string => Boolean(id)),
        )
        const histories = new Map(await Promise.all(audiences.map(async audience => [audience.slug,
          [...new Set([...(await this.exclusions(run.user_id, run.config, audience.destinations.map(d => d.groupId))), ...completedIds])]] as const)))
        const excludeProductIds = [...histories.values()].flat()
        if (excludeProductIds.length + run.config.candidateLimit * missing.length > 50_000) {
          await this.save(run, 'CONFIG_REQUIRED', 'HISTORY_LIMIT')
          return
        }
        const state = run.discovery_state ??= {}
        state.initialRounds ??= {}
        const discoverable = missing.filter(slug => dailyDiscoveryPage(slug, audiences.find(a => a.slug === slug)!.profile.keywords, state.initialRounds?.[slug] ?? 0, run.local_date))
        if (!discoverable.length) {
          await this.save(run, 'REVIEW', 'DISCOVERY_KEYWORDS_EXHAUSTED')
          return
        }
        const payloads = await this.collectObserved(
          run, discoverable.map((slug) => {
            const audience = audiences.find((value) => value.slug === slug)!
            const policy = audience.policy
            return {
              slug,
              options: {
                limit: dailyCandidateTarget(run.config),
                keywords: dailyDiscoveryPage(slug, audience.profile.keywords, state.initialRounds?.[slug] ?? 0, run.local_date),
                matchMode: 'any',
                matchStyle: 'word',
                excludeProductIds: histories.get(slug)!,
                quality: { minRating: run.config.minRating, minSoldCount: run.config.minSoldCount },
                excludePolitical: true,
                minPrice: policy.minPrice,
                maxPrice: policy.maxPrice,
                commission: {
                  minPercent: policy.minCommissionPercent,
                  minEstimatedBrl: policy.minEstimatedCommission,
                },
              },
            }
          }),
          (payload) => this.checkpointPayload(run, payload),
        )
        await this.requireLease(run)
        for (const payload of payloads) await this.checkpointPayload(run, payload)
        // An incomplete audience stays held; never silently schedule just one niche.
        if (
          !DAILY_AUDIENCES.every((slug) =>
            run.payloads?.some(
              (payload) =>
                payload.targetAudienceSlug === slug &&
                payloadOffers(payload).length,
            ),
          )
        ) {
          if (run.config.planningDaysAhead === 1) {
            for (const slug of discoverable) {
              if (!run.payloads?.some(p => p.targetAudienceSlug === slug && payloadOffers(p).length))
                state.initialRounds[slug] = (state.initialRounds[slug] ?? 0) + 1
            }
            await this.discoveryCheckpoint(run)
            await this.save(run, 'COLLECTING')
            return
          }
          throw new DailyCollectionError('COLLECTION_INCOMPLETE')
        }
      }
      await this.requireLease(run)
      if (this.windowExpired(run.config, run.local_date)) {
        await this.save(run, 'EXPIRED', 'WINDOW_CLOSED')
        return
      }
      // Recover the crash window after plan creation but before checkpointing its UUID.
      let plan = await SmartPlan.findOne({
        where: { userId: run.user_id, 'input.requestId': run.request_id },
      })
      if (!plan) {
        const created = await this.smart.createPlan(
          run.user_id,
          {
            requestId: run.request_id,
            date: run.local_date,
            days: 1,
            audienceSlugs: [...DAILY_AUDIENCES],
            payloads: run.payloads!,
            campaignStartTime: run.config.startTime,
            settings: {
              startTime: run.config.startTime,
              endTime: run.config.endTime,
              dailyCap: dailyItemTarget(run.config),
              minGapSeconds: run.config.minIntervalMinutes * 60,
              maxGapSeconds: run.config.maxIntervalMinutes * 60,
              spreadAcrossWindow: true,
              windowEndBufferSeconds: 120,
              excludePolitical: true,
              maxStandouts: run.config.maxStandouts,
              dailySelection: {
                maxPerType: run.config.maxPerType ?? 2,
                minRating: run.config.minRating,
                minSoldCount: run.config.minSoldCount,
                minFitScore: run.config.minFitScore,
                minCommercialScore: run.config.minCommercialScore,
              },
            },
          },
          {
            runId: run.id,
            localDate: run.local_date,
            minimumItems: dailyRequiredItems(run.config),
            repeatCooldownDays: run.config.repeatCooldownDays ?? 0,
            startTime: run.config.startTime,
            endTime: run.config.endTime,
          },
        )
        plan = await SmartPlan.findOne({ where: { uuid: created.id, userId: run.user_id } })
        if (!plan) throw new Error('Plan checkpoint unavailable')
      }
      await this.checkpointPlan(run, plan)
      if (plan.status === SMART_PLAN_STATUS.ANALYZING) {
        await this.save(run, 'ANALYZING')
      } else if (plan.status === SMART_PLAN_STATUS.REVIEW) {
        const { coverage, noveltyShortage } = await this.noveltyCoverage(run, plan, audiences)
        const repeatShortage = dailyRepeatCooldown(run.config) && coverage.audiences.some(a => a.selected < dailyItemTarget(run.config))
        if (!coverage.ready || repeatShortage) {
          if (!plan.settings.dailyAutomation || !(plan.settings.dailyAutomation as { repeatFallbackReady?: boolean }).repeatFallbackReady) {
            if ((run.config.planningDaysAhead === 1 || noveltyShortage || dailyRepeatCooldown(run.config)) && await this.replenish(run, plan, audiences, coverage)) return
            if (dailyRepeatCooldown(run.config)) {
              await this.requireLease(run)
              await this.smart.enableDailyRepeatFallback(run.user_id, plan.uuid, plan.revision)
              await this.save(run, 'ANALYZING')
              return
            }
          }
          // Automatic approval always ships the qualified remainder of a short or late day.
          if (!run.config.autoApprove || !plan.items.some(item => item.state === 'SELECTED')) {
            await this.save(run, 'REVIEW', 'INSUFFICIENT_QUALIFIED_PRODUCTS', coverage.audiences.map(a => `${a.slug} selected=${a.selected} required=${a.required} missing=${a.missing}`).join('; '))
            return
          }
        }
        if (!run.config.autoApprove) {
          await this.save(run, 'REVIEW')
          return
        }
        await this.requireLease(run)
        try {
          await this.approveCheckpoint(run, plan)
        } catch (error) {
          if (!(error instanceof AppError) || !['DAILY_NOVELTY_CONFLICT', 'DAILY_INVENTORY_SHORTAGE'].includes(error.code ?? '')) throw error
          await plan.reload()
          if (plan.status !== SMART_PLAN_STATUS.REVIEW) throw error
          if (await this.replenish(run, plan, audiences, (await this.noveltyCoverage(run, plan, audiences)).coverage)) return
          throw error
        }
      } else if (plan.status === SMART_PLAN_STATUS.FAILED) {
        await this.save(run, 'ANALYSIS_HOLD', 'SMART_ANALYSIS_FAILED')
      } else {
        await this.save(run, plan.status)
      }
    } catch (error) {
      if (error instanceof DailyCollectionError && error.code === 'STOPPED') {
        await sequelize
          .query(
            `UPDATE daily_automation_runs SET lease_token=NULL, lease_until=NULL, next_attempt_at=NOW(), updated_at=NOW() WHERE id=:id AND lease_token=:token`,
            {
              replacements: { id: run.id, token: run.lease_token },
            },
          )
          .catch(() => undefined)
        return
      }
      const appError = error instanceof AppError ? error : null
      const code =
        error instanceof DailyCollectionError
          ? error.code
          : appError
            ? appError.code?.replace(/[^A-Z0-9_]/gi, '').slice(0, 64) ||
              `HTTP_${appError.statusCode}`
            : 'PIPELINE_FAILED'
      if (run.config.autoApprove && run.plan_uuid && APPROVAL_RECOVERABLE_CODES.includes(code) &&
        !this.windowExpired(run.config, run.local_date) &&
        (code !== 'LATE_ANALYSIS' || dailyRemainingCapacity(run.config, new Date(), run.local_date) > 0)) {
        await this.approvalBackoff(run, code, run.approval_attempts > claimedApprovalAttempts)
        return
      }
      if (code === 'LATE_ANALYSIS') {
        const plan = await SmartPlan.findOne({
          where: { userId: run.user_id, 'input.requestId': run.request_id },
        })
        try {
          if (plan && [SMART_PLAN_STATUS.ANALYZING, SMART_PLAN_STATUS.REVIEW].includes(plan.status))
            await this.smart.cancel(run.user_id, plan.uuid, plan.revision)
          await this.save(
            run,
            plan?.status === SMART_PLAN_STATUS.SCHEDULED ? 'SCHEDULED' : 'EXPIRED',
            'LATE_ANALYSIS',
          )
        } catch {
          await this.save(run, 'OPERATOR_ATTENTION', 'DAILY_RETIREMENT_CONFLICT')
        }
        return
      }
      // Keep completed observations when persistence fails; repair the private
      // session configuration before rearming, without paying to recollect.
      if (
        error instanceof DailyCollectionError &&
        error.code === 'SESSION_PERSIST_FAILED' &&
        !run.plan_uuid &&
        error.payloads?.length === 2 &&
        error.payloads.every(
          (payload) => payloadOffers(payload).length,
        )
      ) {
        await sequelize.query(
          `UPDATE daily_automation_runs SET payloads=CAST(:payloads AS JSONB), updated_at=NOW() WHERE id=:id AND lease_token=:token`,
          {
            replacements: {
              id: run.id,
              token: run.lease_token,
              payloads: JSON.stringify(error.payloads),
            },
          },
        )
      }
      if (error instanceof DailyCollectionError && ['AUTH_REQUIRED', 'COLLECTION_FAILED', 'COLLECTION_INCOMPLETE', 'COLLECTION_TIMEOUT'].includes(code)) {
        await this.collectionBackoff(run, code)
        logger.warn({ dailyRunId: run.id, code, step: error.step }, 'Daily collection deferred with backoff')
        return
      }
      const status =
        ['SESSION_PERSIST_FAILED', 'HISTORY_LIMIT'].includes(code)
          ? 'CONFIG_REQUIRED'
          : appError && appError.statusCode >= 400 && appError.statusCode < 500
            ? 'OPERATOR_ATTENTION'
            : run.attempts >= 2 ? 'FAILED' : 'RETRY'
      await this.save(run, status, code)
      logger.warn(
        { dailyRunId: run.id, code },
        'Daily automation held; inspect daily_automation_runs',
      )
    }
  }
}
