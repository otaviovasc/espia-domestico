import { createHash, randomUUID } from 'node:crypto'
import { Op, QueryTypes } from 'sequelize'
import { injectable, inject } from 'tsyringe'
import { sequelize } from '@/database'
import { env } from '@/config/env'
import {
  dailyWindow,
  dailyItemTarget,
  dailyRequiredItems,
  type DailyAutomationConfig,
} from '@/config/dailyAutomation'
import { AppError } from '@/middleware/Error/AppError'
import { SmartAudience } from '@/database/models/SmartAudience'
import { Campaign, CAMPAIGN_STATUS_ENUM } from '@/database/models/Campaign'
import { SmartPlan, SMART_PLAN_STATUS } from '@/database/models/SmartPlan'
import { SmartCampaignService } from '@/services/SmartCampaignService'
import {
  DailyCollectionError,
  DailyProductCollector,
  DAILY_AUDIENCES,
  type DailyPayload,
} from '@/services/DailyProductCollector'
import { DailyAutomationAlerts } from '@/services/DailyAutomationAlerts'
import { DAILY_DISCOVERY_ROUND_SIZE, dailyDiscoveryKeywords } from '@/utils/dailyDiscovery'
import { dailyPlanCoverage } from '@/utils/dailyPlanCoverage'
import { logger } from '@/utils/logger'
import { normalizedMercadoLivreProductId, type OfferIdentityInput } from '@/utils/offerIdentity'
import { dailyExcludedProductIds, dailyOfferAliases, dailyProductConflicts } from '@/services/dailyNovelty'

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
  discovery_state?: { round?: number; pending?: DailyPayload[]; exhausted?: boolean; collected?: boolean; initialRounds?: Partial<Record<(typeof DAILY_AUDIENCES)[number], number>> }
  lease_token: string
}

export function dailyRequestId(userId: number, date: string): string {
  const hex = createHash('sha256').update(`daily-automation:v1:${userId}:${date}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

@injectable()
export class DailyAutomationService {
  private readonly abort = new AbortController()

  constructor(
    @inject(SmartCampaignService) private readonly smart: SmartCampaignService,
    @inject(DailyProductCollector) private readonly collector: DailyProductCollector,
    @inject(DailyAutomationAlerts, { isOptional: true }) private readonly alerts?: DailyAutomationAlerts,
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
    const saved = await sequelize.query<{ id: string }>(
      `UPDATE daily_automation_runs
      SET status=:status, last_error=:error, lease_token=NULL, lease_until=NULL,
          attempts=attempts + CASE WHEN :error IS NOT NULL AND :status IN ('RETRY','FAILED') THEN 1 ELSE 0 END,
          next_attempt_at=CASE WHEN :status IN ('ANALYZING','ANALYSIS_HOLD') THEN NOW()
            ELSE NOW() + INTERVAL '15 minutes' END, updated_at=NOW()
      WHERE id=:id AND lease_token=:token RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: { status, error, id: run.id, token: run.lease_token },
      },
    )
    if (saved.length && error) {
      try {
        await this.alerts?.enqueue(run.config, run.local_date, run.plan_uuid ? `${run.plan_uuid}:${error}` : `${run.id}:${status}:${error}`, error, detail)
      } catch {
        logger.warn({ dailyRunId: run.id, code: 'ALERT_PERSIST_FAILED' }, 'Daily checkpoint saved; alert persistence failed')
      }
    }
  }

  private async discoveryCheckpoint(run: DailyRun): Promise<void> {
    await this.requireLease(run)
    await sequelize.query(`UPDATE daily_automation_runs SET discovery_state=CAST(:state AS JSONB), updated_at=NOW() WHERE id=:id AND lease_token=:token`, {
      replacements: { id: run.id, token: run.lease_token, state: JSON.stringify(run.discovery_state) },
    })
  }

  private async replenish(run: DailyRun, plan: SmartPlan, audiences: SmartAudience[], coverage = dailyPlanCoverage(plan.items, run.config, run.local_date)): Promise<boolean> {
    // Round payloads are durable before append. Replaying an interrupted append uses
    // the same request ID and therefore cannot purchase the same analysis twice.
    const state = run.discovery_state ??= { round: 1 }
    const round = state.round ?? 1
    if (state.exhausted || this.windowExpired(run.config, run.local_date)) return false
    const pooled = (run.payloads ?? []).flatMap(p => Array.isArray(p.json.cards) ? p.json.cards : [])
    const ids = pooled.map(card => normalizedMercadoLivreProductId((card as { productId?: string }).productId)).filter((id): id is string => Boolean(id))
    const history = await this.exclusions(run.user_id, plan)
    const requests = DAILY_AUDIENCES.flatMap(slug => {
      if (!coverage.audiences.some(a => a.slug === slug && (a.missing > 0 || !a.completeSchedule))) return []
      const existing = (run.payloads ?? []).filter(p => p.targetAudienceSlug === slug).reduce((n, p) => n + (Array.isArray(p.json.cards) ? p.json.cards.length : 0), 0)
      const audience = audiences.find(a => a.slug === slug)!
      const keywords = dailyDiscoveryKeywords(slug, audience.profile.keywords, round + (state.initialRounds?.[slug] ?? 0))
      const limit = Math.min(DAILY_DISCOVERY_ROUND_SIZE, run.config.candidateLimit - existing)
      if (limit <= 0 || !keywords.length) return []
      return [{ slug, options: { limit, keywords, matchMode: 'any', matchStyle: 'word',
        excludeProductIds: [...new Set([...history, ...ids])], excludePolitical: true,
        quality: { minRating: run.config.minRating, minSoldCount: run.config.minSoldCount },
        minPrice: audience.policy.minPrice, maxPrice: audience.policy.maxPrice,
        commission: { minPercent: audience.policy.minCommissionPercent, minEstimatedBrl: audience.policy.minEstimatedCommission } } }]
    })
    if (!state.pending && !requests.length) { state.exhausted = true; await this.discoveryCheckpoint(run); return false }
    if (!state.collected) {
      state.pending ??= []
      await this.discoveryCheckpoint(run)
      const payloads = await this.collector.collect(requests.filter(r => !state.pending?.some(p => p.targetAudienceSlug === r.slug)), this.abort.signal, async payload => {
        state.pending = [...(state.pending ?? []).filter(p => p.targetAudienceSlug !== payload.targetAudienceSlug), await this.filterPayload(run, payload, plan)]
        await this.discoveryCheckpoint(run)
      })
      const remaining = payloads.filter(p => !state.pending?.some(old => old.targetAudienceSlug === p.targetAudienceSlug))
      state.pending = [...state.pending, ...await Promise.all(remaining.map(payload => this.filterPayload(run, payload, plan)))]
      state.collected = true
      await this.discoveryCheckpoint(run)
    }
    const pending = state.pending ?? []
    if (pending.some(p => Array.isArray(p.json.cards) && p.json.cards.length)) {
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
    if (!Array.isArray(payload.json.cards) || !payload.json.cards.length) return
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

  private async exclusions(userId: number, plan?: SmartPlan): Promise<string[]> {
    return dailyExcludedProductIds(userId, plan?.id, plan?.uuid)
  }

  private async filterPayload(run: DailyRun, payload: DailyPayload, plan?: SmartPlan): Promise<DailyPayload> {
    if (!Array.isArray(payload.json.cards)) return payload
    const offers = payload.json.cards.map(card => {
      const value = card as { productId?: string; commissionedUrl?: string; productUrl?: string } | null
      const url = value?.commissionedUrl || value?.productUrl
      return { source: 'mercadolivre', productId: typeof value?.productId === 'string' ? value.productId : undefined,
        affiliateUrl: typeof url === 'string' ? url : '' }
    })
    const conflicts = await dailyProductConflicts(run.user_id, plan?.id ?? null, plan?.uuid ?? null, offers)
    return { ...payload, json: { ...payload.json, cards: payload.json.cards.filter((_card, index) =>
      !dailyOfferAliases(offers[index]).some(identity => conflicts.has(identity))) } }
  }

  async tick(config: DailyAutomationConfig, now = new Date()): Promise<void> {
    if (this.abort.signal.aborted) return
    // Resume frozen preparation first, including the target morning after restart.
    const startupWindow = dailyWindow(config, now)
    const existing = await sequelize.query<{ config: DailyAutomationConfig; local_date: string }>(
      `SELECT config, local_date FROM daily_automation_runs WHERE user_id=:userId
       AND status IN ('COLLECTING','ANALYZING','ANALYSIS_HOLD','RETRY','REPLENISHING')
       ORDER BY local_date ASC LIMIT 1`,
      { replacements: { userId: config.userId }, type: QueryTypes.SELECT },
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
      SET lease_token=:token, lease_until=NOW() + INTERVAL '30 minutes', updated_at=NOW()
      WHERE user_id=:userId AND local_date=:date
        AND status IN ('COLLECTING', 'ANALYZING', 'ANALYSIS_HOLD', 'RETRY', 'REPLENISHING')
        AND (lease_until IS NULL OR lease_until<NOW()) AND next_attempt_at<=NOW()
      RETURNING *`,
      {
        replacements: { userId: config.userId, date: targetDate, token },
        type: QueryTypes.SELECT,
      },
    )
    const run = rows[0]
    if (!run) return
    try {
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
        await this.save(run, ownedPlan.status)
        return
      }
      if (this.windowExpired(run.config, run.local_date, now)) {
        if (ownedPlan && [SMART_PLAN_STATUS.ANALYZING, SMART_PLAN_STATUS.REVIEW].includes(ownedPlan.status))
          await this.smart.cancel(run.user_id, ownedPlan.uuid, ownedPlan.revision)
        await this.save(run, 'EXPIRED', 'WINDOW_CLOSED')
        return
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
      const missing = DAILY_AUDIENCES.filter(
        (slug) =>
          !run.payloads?.some(
            (payload) =>
              payload.targetAudienceSlug === slug &&
              Array.isArray(payload.json.cards) &&
              payload.json.cards.length,
          ),
      )
      if (missing.length) {
        const completedIds = (run.payloads ?? []).flatMap((payload) =>
          Array.isArray(payload.json.cards)
            ? payload.json.cards
                .map((card) =>
                  normalizedMercadoLivreProductId((card as { productId?: string }).productId),
                )
                .filter((id): id is string => Boolean(id))
            : [],
        )
        const excludeProductIds = [
          ...new Set([...(await this.exclusions(run.user_id)), ...completedIds]),
        ]
        if (excludeProductIds.length + run.config.candidateLimit * missing.length > 50_000) {
          await this.save(run, 'CONFIG_REQUIRED', 'HISTORY_LIMIT')
          return
        }
        const state = run.discovery_state ??= {}
        state.initialRounds ??= {}
        if (missing.some(slug => !dailyDiscoveryKeywords(slug, audiences.find(a => a.slug === slug)!.profile.keywords, state.initialRounds?.[slug] ?? 0).length)) {
          await this.save(run, 'REVIEW', 'DISCOVERY_KEYWORDS_EXHAUSTED')
          return
        }
        const payloads = await this.collector.collect(
          missing.map((slug) => {
            const audience = audiences.find((value) => value.slug === slug)!
            const policy = audience.policy
            return {
              slug,
              options: {
                limit: Math.min(DAILY_DISCOVERY_ROUND_SIZE, run.config.candidateLimit),
                keywords: dailyDiscoveryKeywords(slug, audience.profile.keywords, state.initialRounds?.[slug] ?? 0),
                matchMode: 'any',
                matchStyle: 'word',
                excludeProductIds,
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
          this.abort.signal,
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
                Array.isArray(payload.json.cards) &&
                payload.json.cards.length,
            ),
          )
        ) {
          if (run.config.planningDaysAhead === 1) {
            for (const slug of missing) {
              if (!run.payloads?.some(p => p.targetAudienceSlug === slug && Array.isArray(p.json.cards) && p.json.cards.length))
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
        const selected = plan.items.filter(item => item.state === 'SELECTED')
        const conflicts = await dailyProductConflicts(run.user_id, plan.id, plan.uuid,
          selected.flatMap(item => item.product ? [item.product as OfferIdentityInput] : []))
        const identities = new Set<string>()
        const effective = plan.items.filter(item => {
          if (item.state !== 'SELECTED' || !item.product) return true
          const aliases = dailyOfferAliases(item.product as OfferIdentityInput)
          if (aliases.some(identity => conflicts.has(identity) || identities.has(identity))) return false
          aliases.forEach(identity => identities.add(identity))
          return true
        })
        const coverage = dailyPlanCoverage(effective, run.config, run.local_date)
        for (const audience of coverage.audiences) {
          audience.required = Math.max(audience.required, selected.filter(item => item.audienceSlug === audience.slug).length)
          audience.missing = Math.max(0, audience.required - audience.selected)
        }
        coverage.ready = coverage.audiences.every(audience => !audience.missing && audience.completeSchedule)
        if (!coverage.ready) {
          if ((run.config.planningDaysAhead === 1 || effective.length < plan.items.length) && await this.replenish(run, plan, audiences, coverage)) return
          // Automatic approval always ships the qualified remainder of a short or late day.
          if (!run.config.autoApprove || !coverage.audiences.some(a => a.selected)) {
            await this.save(run, 'REVIEW', 'INSUFFICIENT_QUALIFIED_PRODUCTS', coverage.audiences.map(a => `${a.slug} selected=${a.selected} required=${a.required} missing=${a.missing}`).join('; '))
            return
          }
        }
        if (!run.config.autoApprove) {
          await this.save(run, 'REVIEW')
          return
        }
        await this.requireLease(run)
        await this.smart.approve(run.user_id, plan.uuid, plan.revision, { automatic: true })
        await this.save(run, 'SCHEDULED')
      } else if (plan.status === SMART_PLAN_STATUS.FAILED) {
        await this.save(run, 'ANALYSIS_HOLD', 'SMART_ANALYSIS_FAILED')
      } else {
        await this.save(run, plan.status)
      }
      logger.info(
        { dailyRunId: run.id, planUuid: plan.uuid, date: run.local_date },
        'Daily automation checkpoint',
      )
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
          (payload) => Array.isArray(payload.json.cards) && payload.json.cards.length,
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
      const status =
        code === 'AUTH_REQUIRED'
          ? 'AUTH_REQUIRED'
          : ['SESSION_PERSIST_FAILED', 'HISTORY_LIMIT'].includes(code)
            ? 'CONFIG_REQUIRED'
            : appError && appError.statusCode >= 400 && appError.statusCode < 500
              ? 'OPERATOR_ATTENTION'
              : run.attempts >= 2
                ? 'FAILED'
                : 'RETRY'
      await this.save(run, status, code)
      logger.warn(
        { dailyRunId: run.id, code },
        'Daily automation held; inspect daily_automation_runs',
      )
    }
  }
}
