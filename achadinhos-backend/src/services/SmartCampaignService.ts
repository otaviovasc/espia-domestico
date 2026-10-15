import { createHash, randomUUID } from 'node:crypto'
import { CreationAttributes, Op, QueryTypes, Transaction } from 'sequelize'
import { injectable, inject } from 'tsyringe'
import { sequelize } from '@/database'
import { Campaign, CAMPAIGN_STATUS_ENUM } from '@/database/models/Campaign'
import { CampaignLog } from '@/database/models/CampaignLog'
import { ClassificationProfileRecord } from '@/database/models/ClassificationProfile'
import {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} from '@/database/models/ProductGroupDelivery'
import { SmartAudience, type SmartAudiencePolicy } from '@/database/models/SmartAudience'
import { SMART_PLAN_STATUS, SmartPlan } from '@/database/models/SmartPlan'
import { SMART_SEND_STATUS, SmartSend } from '@/database/models/SmartSend'
import type { OfferInput } from '@/dtos/campaign'
import type {
  CreateSmartPlanInput,
  SmartPlanItem,
  UpdateSmartAudienceInput,
  UpdateSmartPlanInput,
} from '@/dtos/smartCampaign'
import { SmartPlanItemSchema, SmartAudiencePolicySchema } from '@/dtos/smartCampaign'
import { ClassificationProfileIdSchema } from '@/dtos/classificationProfile'
import type {
  NicheIntelligenceOverrides,
  NicheSlug,
  SmartProductAnalysis,
} from '@/dtos/smartIntelligence'
import { NicheSlugSchema } from '@/dtos/smartIntelligence'
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '@/middleware/Error/AppError'
import { ConnectionService } from '@/services/ConnectionService'
import { GroupService } from '@/services/GroupService'
import { NICHE_PRESETS } from '@/services/nichePresets'
import { OfferImportService } from '@/services/OfferImportService'
import { SavedProductService } from '@/services/SavedProductService'
import { SmartCampaignIntelligence } from '@/services/SmartCampaignIntelligence'
import { User } from '@/database/models/User'
import { offerIdentity, offerIdentityAliases } from '@/utils/offerIdentity'
import { logger } from '@/utils/logger'
import { recordSmartOperation } from '@/utils/smartOperationAudit'
import { env } from '@/config/env'

const MIN_SMART_FIT = 70

const NICHE_CUES: Record<NicheSlug, RegExp> = {
  domestica: /\b(cozinha|panela|air ?fryer|airfryer|liquidificador|aspirador|limpeza|organizador|edredom|cama|banho|skincare|maquiagem|secador|chapinha|bolsa|necessaire)\b/i,
  masculino: /\b(barbeador|barba|furadeira|parafusadeira|ferramenta|halter|muscula[cç][aã]o|smartwatch|carteira|masculin[oa]|automotivo|carro|mult[ií]metro)\b/i,
  natal: /\b(natal|natalin[oa]|guirlanda|pisca.?pisca|pres[eé]pio|panetone|papai noel|[aá]rvore de natal|enfeite|amigo secreto)\b/i,
  pesca: /\b(pesca|molinete|carretilha|anz[oó]is?|isca artificial|vara de pesca|multifilamento|chumbada|passagu[aá])\b/i,
  pet: /\b(pet|c[aã]o|cachorro|gato|ra[cç][aã]o|comedouro|bebedouro|coleira|peitoral|arranhador|tapete higi[eê]nico|areia para gato)\b/i,
}

function likelyAudienceSlugs(offer: OfferInput, allowed: NicheSlug[]): NicheSlug[] {
  const text = `${offer.title} ${offer.description ?? ''}`.slice(0, 1_000)
  const matched = allowed.filter((slug) => NICHE_CUES[slug].test(text))
  // Broad/general merchandise has little lexical signal. Keep all audiences so the
  // classifier decides; only prune clearly unrelated niches for strong cues.
  return matched.length ? matched : allowed
}

const DEFAULT_POLICY: SmartAudiencePolicy = {
  dailyCap: 50,
  startTime: '09:00',
  endTime: '21:00',
  minGapSeconds: 720,
  maxGapSeconds: 960,
  maxStandouts: 3,
  freshnessHours: 24,
  timezone: 'America/Sao_Paulo',
  minCommissionPercent: 0,
  minEstimatedCommission: 0,
}

const VERIFIED_ATTRIBUTION = new Set([
  'generated_from_page_state',
  'generated',
  'generated_from_clipboard',
  'generated_from_copy_event',
  'present_on_card',
])

const RESERVED_SEND_STATUSES = [
  SMART_SEND_STATUS.PENDING,
  SMART_SEND_STATUS.SENDING,
  SMART_SEND_STATUS.SENT,
  SMART_SEND_STATUS.UNKNOWN,
]

interface AudienceConfigSnapshot {
  description?: string
  instructions?: string
  keywords?: string[]
  negativeKeywords?: string[]
}

interface PlanInputPayload {
  requestId?: string
  requestFingerprint?: string
  offers: OfferInput[]
  observedAt: Array<string | null>
  source: string
  totalSeen: number
  errors: Array<Record<string, unknown>>
  duplicateCount: number
  offerAudienceSlugs?: Array<NicheSlug[] | null>
  analysisResults?: Record<string, SmartProductAnalysis>
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return parsed.toISOString().slice(0, 10)
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function zonedParts(date: Date, timezone: string) {
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
  const value = (name: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === name)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

/** Convert a local campaign wall-clock time to its persisted UTC instant. */
export function smartZonedInstant(localDate: string, time: string, timezone: string): Date {
  if (!validDate(localDate)) throw BadRequestError('Data local inválida')
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let pass = 0; pass < 3; pass++) {
    const actual = zonedParts(new Date(guess), timezone)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
    guess += wantedAsUtc - actualAsUtc
  }
  return new Date(guess)
}

export function getSmartLocalDate(date: Date, timezone = DEFAULT_POLICY.timezone): string {
  const parts = zonedParts(date, timezone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function isEvidenceFresh(
  observedAt: Date | string | null | undefined,
  sendAt: Date,
  freshnessHours = DEFAULT_POLICY.freshnessHours,
): boolean {
  if (!observedAt) return false
  const observed = new Date(observedAt)
  if (Number.isNaN(observed.getTime()) || observed.getTime() > sendAt.getTime() + 5 * 60_000) {
    return false
  }
  return sendAt.getTime() - observed.getTime() <= freshnessHours * 3_600_000
}

export function smartUnknownResolutionAvailableAt(
  updatedAt: Date,
  leaseExpiresAt: Date | null | undefined,
  ledgerHeartbeats: Date[] = [],
): Date {
  return new Date(
    Math.max(
      updatedAt.getTime() + 5 * 60_000,
      leaseExpiresAt?.getTime() ?? 0,
      ...ledgerHeartbeats.map((heartbeat) => heartbeat.getTime() + 5 * 60_000),
    ),
  )
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}

function deterministicFraction(key: string): number {
  const value = createHash('sha256').update(key).digest().readUInt32BE(0)
  return value / 0xffffffff
}

/** Generate fixed, reviewable intervals while guaranteeing the configured end time. */
export function buildSmartSchedule(
  date: string,
  count: number,
  policy: SmartAudiencePolicy,
  seed: string,
  earliest?: Date,
): Date[] {
  if (count <= 0) return []
  const start = smartZonedInstant(date, policy.startTime, policy.timezone)
  const end = smartZonedInstant(date, policy.endTime, policy.timezone)
  let cursor = Math.max(start.getTime(), earliest?.getTime() ?? start.getTime())
  if (cursor > start.getTime()) {
    cursor = Math.ceil(cursor / 60_000) * 60_000
  }
  // The worker treats endTime as exclusive, so no approved slot may equal it.
  const availableSeconds = Math.floor((end.getTime() - cursor - 1) / 1000)
  const capacity = Math.max(0, Math.floor(availableSeconds / policy.minGapSeconds) + 1)
  if (count > capacity) {
    throw ConflictError(
      `A janela ${policy.startTime}–${policy.endTime} comporta ${capacity} envio(s) com o intervalo mínimo configurado.`,
    )
  }
  if (count === 1) return [new Date(cursor)]
  const feasibleMax = Math.min(policy.maxGapSeconds, Math.floor(availableSeconds / (count - 1)))
  const slots = [new Date(cursor)]
  for (let index = 1; index < count; index++) {
    const remainingGaps = count - index
    const remainingSeconds = Math.floor((end.getTime() - cursor) / 1000)
    const maximumNow = Math.min(
      feasibleMax,
      remainingSeconds - remainingGaps * policy.minGapSeconds,
    )
    const range = Math.max(0, maximumNow - policy.minGapSeconds)
    const gap =
      policy.minGapSeconds + Math.floor(deterministicFraction(`${seed}:${index}`) * (range + 1))
    cursor += gap * 1000
    slots.push(new Date(cursor))
  }
  return slots
}

function commissionRate(offer: OfferInput): number {
  if (typeof offer.commissionRate === 'number') return offer.commissionRate
  const parsed = Number(
    String(offer.commissionPercent ?? '')
      .replace('%', '')
      .replace(',', '.'),
  )
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0
}

function discount(offer: OfferInput): number {
  if (typeof offer.discountPercent === 'number') return offer.discountPercent
  if (!offer.originalPrice || offer.originalPrice <= offer.discountedPrice) return 0
  return Math.min(100, Math.max(0, (1 - offer.discountedPrice / offer.originalPrice) * 100))
}

function categoryForScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  return 'D'
}

function observedAtFor(offer: OfferInput): string | null {
  const value = offer.extensionEvidence?.extractedAt
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function hasCommissionEvidence(offer: OfferInput): boolean {
  if (typeof offer.extensionEvidence?.commission?.percent === 'number') return true
  if (typeof offer.commissionRate === 'number' && offer.commissionRate > 0) return true
  return /^\d+(?:[.,]\d+)?\s*%?$/.test(offer.commissionPercent?.trim() ?? '')
}

function isVerifiedOffer(offer: OfferInput): boolean {
  return (
    offer.commissioned === true &&
    typeof offer.commissionedUrlStatus === 'string' &&
    VERIFIED_ATTRIBUTION.has(offer.commissionedUrlStatus)
  )
}

function profileInput(preset: (typeof NICHE_PRESETS)[number]) {
  return {
    name: preset.name,
    nicheDescription: preset.description,
    relevanceInstructions: preset.instructions,
    weights: { relevance: 60, discount: 25, commission: 15 },
    discountCap: 50,
    commissionCap: 20,
    thresholds: {
      aScore: 75,
      aRelevance: 75,
      aDiscount: 15,
      aCommission: 10,
      bScore: 55,
      bRelevance: 50,
      cScore: 35,
      dRelevance: 25,
    },
  }
}

function audienceSnapshot(
  audiences: SmartAudience[],
): Partial<Record<NicheSlug, AudienceConfigSnapshot>> {
  return Object.fromEntries(
    audiences.map((audience) => [
      audience.slug,
      {
        description: audience.description,
        instructions: audience.profile.instructions,
        keywords: audience.profile.keywords,
        negativeKeywords: audience.profile.negativeKeywords,
      },
    ]),
  ) as Partial<Record<NicheSlug, AudienceConfigSnapshot>>
}

function serializeAudience(audience: SmartAudience) {
  const policy = audience.policy
  return {
    id: audience.id,
    slug: audience.slug,
    name: audience.name,
    description: audience.description,
    active: audience.enabled,
    enabled: audience.enabled,
    profileId: audience.classificationProfileId,
    classificationProfileId: audience.classificationProfileId,
    destinationGroupIds: audience.destinations.map((destination) => destination.groupId),
    destinations: audience.destinations,
    dailyCap: policy.dailyCap,
    startTime: policy.startTime,
    endTime: policy.endTime,
    minIntervalMinutes: policy.minGapSeconds / 60,
    maxIntervalMinutes: policy.maxGapSeconds / 60,
    minCommissionPercent: policy.minCommissionPercent,
    minEstimatedCommission: policy.minEstimatedCommission,
    maxStandoutMessages: policy.maxStandouts,
    profile: audience.profile,
    policy,
    createdAt: audience.createdAt,
    updatedAt: audience.updatedAt,
  }
}

function serializePlan(plan: SmartPlan, sends?: SmartSend[]) {
  const input = plan.input as unknown as PlanInputPayload
  const summary = sends
    ? Object.fromEntries(
        Object.values(SMART_SEND_STATUS).map((status) => [
          status,
          sends.filter((send) => send.status === status).length,
        ]),
      )
    : undefined
  return {
    id: plan.uuid,
    uuid: plan.uuid,
    status: plan.status,
    revision: plan.revision,
    startDate: plan.startDate,
    date: plan.startDate,
    days: plan.days,
    timezone: plan.timezone,
    audienceSlugs: plan.audienceSlugs,
    audiences: plan.audienceSlugs,
    settings: plan.settings,
    progress: plan.progress,
    items: plan.items,
    warnings: plan.warnings,
    inputSummary: {
      totalSeen: input.totalSeen,
      imported: input.offers?.length ?? 0,
      invalid: input.errors?.length ?? 0,
      duplicates: input.duplicateCount ?? 0,
      source: input.source,
    },
    sendSummary: summary,
    sends: sends?.map((send) => ({
      id: send.uuid,
      audienceSlug: send.audienceSlug,
      groupId: send.groupId,
      groupName: send.groupName,
      status: send.status,
      scheduledAt: send.scheduledAt,
      sentAt: send.sentAt,
      attempts: send.attempts,
      lastError: send.lastError,
      offerTitle: send.offer.title,
      unknownSince: send.status === SMART_SEND_STATUS.UNKNOWN ? send.updatedAt : undefined,
      resolutionAvailableAt:
        send.status === SMART_SEND_STATUS.UNKNOWN
          ? new Date(
              Math.max(send.updatedAt.getTime() + 5 * 60_000, send.leaseExpiresAt?.getTime() ?? 0),
            )
          : undefined,
    })),
    approvedAt: plan.approvedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}

@injectable()
export class SmartCampaignService {
  constructor(
    @inject(OfferImportService) private readonly imports: OfferImportService,
    @inject(SavedProductService) private readonly savedProducts: SavedProductService,
    @inject(SmartCampaignIntelligence) private readonly intelligence: SmartCampaignIntelligence,
    @inject(GroupService) private readonly groups: GroupService,
    @inject(ConnectionService) private readonly connections: ConnectionService,
  ) {}

  private async ensureAudiences(userId: number): Promise<SmartAudience[]> {
    const audiences = await sequelize.transaction(async (transaction) => {
      // A user-row lock makes lazy first-use seeding idempotent even when the UI
      // opens multiple Smart Campaign requests concurrently.
      const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
      if (!user) throw NotFoundError('Usuário não encontrado')
      const existing = await SmartAudience.findAll({ where: { userId }, transaction })
      const bySlug = new Map(existing.map((audience) => [audience.slug, audience]))
      const existingProfiles = await ClassificationProfileRecord.findAll({
        where: { userId },
        order: [['id', 'ASC']],
        transaction,
      })
      for (const preset of NICHE_PRESETS) {
        if (bySlug.has(preset.slug)) continue
        let classificationProfileId: string
        if (preset.slug === 'domestica') {
          classificationProfileId = 'default'
        } else {
          let profile = existingProfiles.find(
            (item) => item.name.localeCompare(preset.name, 'pt-BR', { sensitivity: 'base' }) === 0,
          )
          if (!profile) {
            profile = await ClassificationProfileRecord.create(
              { userId, ...profileInput(preset) },
              { transaction },
            )
            existingProfiles.push(profile)
          }
          classificationProfileId = String(profile.id)
        }
        const created = await SmartAudience.create(
          {
            userId,
            slug: preset.slug,
            name: preset.name,
            description: preset.description,
            enabled: preset.slug === 'domestica' || preset.slug === 'masculino',
            classificationProfileId,
            profile: {
              instructions: preset.instructions,
              keywords: [...preset.keywords],
              negativeKeywords: [...preset.negativeKeywords],
            },
            destinations: [],
            policy: { ...DEFAULT_POLICY },
          },
          { transaction },
        )
        bySlug.set(created.slug, created)
      }
      return [...bySlug.values()]
    })
    return audiences.sort(
      (left, right) =>
        NICHE_PRESETS.findIndex((item) => item.slug === left.slug) -
        NICHE_PRESETS.findIndex((item) => item.slug === right.slug),
    )
  }

  async listAudiences(userId: number) {
    return (await this.ensureAudiences(userId)).map(serializeAudience)
  }

  private async audienceRows(userId: number, slugs: string[]): Promise<SmartAudience[]> {
    await this.ensureAudiences(userId)
    const unique = [...new Set(slugs)]
    const audiences = await SmartAudience.findAll({ where: { userId, slug: unique } })
    if (audiences.length !== unique.length)
      throw BadRequestError('Um ou mais públicos são inválidos')
    const bySlug = new Map(audiences.map((audience) => [audience.slug, audience]))
    return unique.map((slug) => bySlug.get(slug)!)
  }

  async updateAudience(userId: number, slug: string, input: UpdateSmartAudienceInput) {
    const audience = (await this.audienceRows(userId, [slug]))[0]
    const requestedProfileId = input.classificationProfileId ?? input.profileId
    if (requestedProfileId !== undefined && requestedProfileId !== null) {
      const parsedId = ClassificationProfileIdSchema.parse(requestedProfileId)
      if (parsedId !== 'default') {
        const owned = await ClassificationProfileRecord.findOne({
          where: { id: Number(parsedId), userId },
        })
        if (!owned) throw NotFoundError('Perfil de classificação não encontrado')
      }
    }
    let destinations = input.destinations
    if (input.destinationGroupIds) {
      const currentNames = new Map(
        audience.destinations.map((item) => [item.groupId, item.groupName]),
      )
      destinations = input.destinationGroupIds.map((groupId) => ({
        groupId,
        groupName: currentNames.get(groupId) ?? groupId,
      }))
    }
    if (destinations) {
      const verified = await this.groups.requireCurrentGroups(
        userId,
        destinations.map((item) => item.groupId),
      )
      destinations = [...new Set(destinations.map(({ groupId }) => groupId))].map((groupId) => ({
        groupId,
        groupName: verified.get(groupId)!.name,
      }))
    }
    const flatPolicy = {
      ...(input.dailyCap === undefined ? {} : { dailyCap: input.dailyCap }),
      ...(input.startTime === undefined ? {} : { startTime: input.startTime }),
      ...(input.endTime === undefined ? {} : { endTime: input.endTime }),
      ...(input.minIntervalMinutes === undefined
        ? {}
        : { minGapSeconds: input.minIntervalMinutes * 60 }),
      ...(input.maxIntervalMinutes === undefined
        ? {}
        : { maxGapSeconds: input.maxIntervalMinutes * 60 }),
      ...(input.maxStandoutMessages === undefined
        ? {}
        : { maxStandouts: input.maxStandoutMessages }),
      ...(input.minCommissionPercent === undefined
        ? {}
        : { minCommissionPercent: input.minCommissionPercent ?? undefined }),
      ...(input.minEstimatedCommission === undefined
        ? {}
        : { minEstimatedCommission: input.minEstimatedCommission ?? undefined }),
    }
    const policy = SmartAudiencePolicySchema.parse({
      ...audience.policy,
      ...(input.policy ?? {}),
      ...flatPolicy,
    })
    if (policy.startTime >= policy.endTime || policy.minGapSeconds > policy.maxGapSeconds) {
      throw BadRequestError('Política de horário ou intervalo inválida')
    }
    audience.enabled = input.enabled ?? input.active ?? audience.enabled
    audience.description = input.description ?? audience.description
    audience.classificationProfileId =
      input.classificationProfileId ?? input.profileId ?? audience.classificationProfileId
    audience.profile = { ...audience.profile, ...(input.profile ?? {}) }
    audience.policy = policy
    if (destinations) audience.destinations = destinations
    await audience.save()
    await recordSmartOperation(userId, 'SMART_AUDIENCE_UPDATED', {
      audienceId: audience.id,
      slug,
      enabled: audience.enabled,
      groupIds: audience.destinations.map((target) => target.groupId),
      policy: audience.policy,
    })
    return serializeAudience(audience)
  }

  aiStatus() {
    return {
      enabled: env.AI_ENABLED,
      configured: Boolean(env.OPENROUTER_KEY),
      model: env.SMART_CLASSIFICATION_MODEL,
      limits: {
        dailyCostUsd: env.AI_DAILY_COST_LIMIT_USD,
        globalDailyCostUsd: env.AI_GLOBAL_DAILY_COST_LIMIT_USD,
        requestCostUsd: env.AI_REQUEST_COST_LIMIT_USD,
        dailyRequests: env.AI_DAILY_REQUEST_LIMIT,
        batchSize: 4,
      },
    }
  }

  async keywordPacks(userId: number, date: string, audienceSlugs?: string[], requestId?: string) {
    const audiences = await this.audienceRows(
      userId,
      audienceSlugs?.length
        ? audienceSlugs
        : (await this.ensureAudiences(userId))
            .filter((item) => item.enabled)
            .map((item) => item.slug),
    )
    const slugs = audiences.map((item) => item.slug as NicheSlug)
    const packs = await this.intelligence.keywordPacks(
      date,
      slugs,
      audienceSnapshot(audiences),
      [],
      { userId, operationId: requestId },
    )
    return {
      date,
      packs: packs.map((pack) => {
        const audience = audiences.find((item) => item.slug === pack.slug)!
        const batches: string[][] = []
        for (let index = 0; index < pack.keywords.length; index += 20) {
          batches.push(pack.keywords.slice(index, index + 20))
        }
        return {
          audienceSlug: pack.slug,
          slug: pack.slug,
          name: audience.name,
          keywords: pack.keywords,
          reason: pack.reason,
          mode: 'ANY' as const,
          minCommissionPercent: audience.policy.minCommissionPercent,
          minEstimatedCommission: audience.policy.minEstimatedCommission,
          batches,
        }
      }),
    }
  }

  async createPlan(userId: number, input: CreateSmartPlanInput) {
    const audiences = await this.audienceRows(userId, input.audienceSlugs)
    if (audiences.some((audience) => !audience.enabled)) {
      throw BadRequestError('Ative todos os públicos escolhidos antes de criar o plano')
    }
    if (
      audiences.some(
        (audience) => input.date < getSmartLocalDate(new Date(), audience.policy.timezone),
      )
    ) {
      throw BadRequestError('A data inicial do plano não pode estar no passado')
    }
    const parsed = input.payloads
      ? this.imports.parsePayloads(input.payloads)
      : this.imports.parse(input.rawJson)
    if (!parsed.offers.length) throw BadRequestError('A importação não contém produtos válidos')
    if (parsed.offers.length > 500) {
      throw BadRequestError('Planos inteligentes aceitam no máximo 500 produtos por análise')
    }
    const selectedSlugs = new Set(input.audienceSlugs)
    const offerAudienceSlugs = parsed.offers.map((offer, index) => {
      const origin = parsed.provenance?.[index]
      if (!origin?.targetAudienceSlugs?.length) return null
      const slugs = origin.targetAudienceSlugs.map((slug) => NicheSlugSchema.parse(slug) as NicheSlug)
      if (slugs.some((slug) => !selectedSlugs.has(slug))) {
        throw BadRequestError('O público de cada arquivo precisa estar incluído na seleção do plano')
      }
      // File audience is a weak prior, not a forced destination. Include strong
      // lexical evidence from another selected niche; AI still scores the candidate.
      return [...new Set<NicheSlug>([...slugs, ...likelyAudienceSlugs(offer, input.audienceSlugs as NicheSlug[])])].sort()
    })
    const observedAt = parsed.offers.map(observedAtFor)
    const settings = {
      audiences: Object.fromEntries(
        audiences.map((audience) => [
          audience.slug,
          SmartAudiencePolicySchema.parse({
            ...audience.policy,
            ...(input.settings ?? {}),
            timezone: audience.policy.timezone,
          }),
        ]),
      ),
      global: { timezone: audiences[0]?.policy.timezone ?? DEFAULT_POLICY.timezone },
      audienceProfiles: audienceSnapshot(audiences),
    }
    const plan = await sequelize.transaction(async (transaction) => {
      await this.advisoryLock(transaction, `smart-analysis-budget:${userId}`)
      // Fingerprint only normalized client-controlled analysis inputs. A retry
      // remains idempotent if an audience is edited after the first request;
      // the original plan already contains the frozen policy/profile snapshot.
      const requestFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            date: input.date,
            days: input.days,
            audienceSlugs: input.audienceSlugs,
            offers: parsed.offers,
            offerAudienceSlugs,
            settings: input.settings ?? {},
          }),
        )
        .digest('hex')
      const existing = await sequelize.query<{ id: number }>(
        "SELECT id FROM smart_plans WHERE user_id=:userId AND input->>'requestId'=:requestId LIMIT 1",
        {
          replacements: { userId, requestId: input.requestId },
          type: QueryTypes.SELECT,
          transaction,
        },
      )
      if (existing[0]) {
        const previous = (await SmartPlan.findByPk(existing[0].id, { transaction }))!
        if (
          (previous.input as unknown as PlanInputPayload).requestFingerprint !== requestFingerprint
        ) {
          throw ConflictError('Esta identificação de análise já foi usada com outros dados')
        }
        return previous
      }
      const activePlans = await SmartPlan.count({
        where: {
          userId,
          status: {
            [Op.in]: [
              SMART_PLAN_STATUS.ANALYZING,
              SMART_PLAN_STATUS.REVIEW,
              SMART_PLAN_STATUS.SCHEDULED,
              SMART_PLAN_STATUS.PAUSED,
            ],
          },
        },
        transaction,
      })
      if (activePlans >= 2) {
        throw ConflictError('Conclua ou cancele um plano inteligente antes de criar outro')
      }
      const recentPlans = await SmartPlan.findAll({
        attributes: ['input'],
        where: { userId, createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60_000) } },
        transaction,
      })
      const recentItems = recentPlans.reduce(
        (total, recent) =>
          total + ((recent.input as unknown as PlanInputPayload).offers?.length ?? 0),
        0,
      )
      if (recentItems + parsed.offers.length > 2_000) {
        throw new AppError(
          'O limite de 2.000 produtos analisados em 24 horas foi atingido',
          429,
          'SMART_DAILY_ANALYSIS_LIMIT',
        )
      }
      const created = await SmartPlan.create(
        {
          userId,
          status: SMART_PLAN_STATUS.ANALYZING,
          startDate: input.date,
          days: input.days,
          timezone: audiences[0]?.policy.timezone ?? DEFAULT_POLICY.timezone,
          audienceSlugs: audiences.map((audience) => audience.slug),
          input: {
            requestId: input.requestId,
            requestFingerprint,
            offers: parsed.offers,
            observedAt,
            source: parsed.source,
            totalSeen: parsed.totalSeen,
            errors: parsed.errors,
            duplicateCount: parsed.duplicateCount ?? 0,
            offerAudienceSlugs,
            analysisResults: {},
          },
          items: [],
          settings,
          progress: { phase: 'QUEUED', completed: 0, total: parsed.offers.length },
          warnings: observedAt.some((value) => !value)
            ? ['Produtos sem extractedAt ficam fora do agendamento automático.']
            : [],
        },
        { transaction },
      )
      await recordSmartOperation(
        userId,
        'SMART_PLAN_CREATED',
        {
          planId: created.id,
          planUuid: created.uuid,
          requestId: input.requestId,
          audienceSlugs: created.audienceSlugs,
          productCount: parsed.offers.length,
        },
        transaction,
      )
      return created
    })
    return serializePlan(plan)
  }

  async listPlans(userId: number) {
    const plans = await SmartPlan.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 100,
    })
    return plans.map((plan) => serializePlan(plan))
  }

  private async requirePlan(userId: number, uuid: string, transaction?: Transaction) {
    const plan = await SmartPlan.findOne({
      where: { uuid, userId },
      transaction,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    })
    if (!plan) throw NotFoundError('Plano inteligente não encontrado')
    return plan
  }

  async getPlan(userId: number, uuid: string) {
    const plan = await this.requirePlan(userId, uuid)
    const sends = await SmartSend.findAll({
      where: { userId, planId: plan.id },
      order: [['scheduledAt', 'ASC']],
    })
    return serializePlan(plan, sends)
  }

  private async claimAnalysisPlan(planId?: number): Promise<SmartPlan | null> {
    return sequelize.transaction(async (transaction) => {
      const where = planId
        ? { id: planId, status: SMART_PLAN_STATUS.ANALYZING }
        : { status: SMART_PLAN_STATUS.ANALYZING }
      const plan = await SmartPlan.findOne({
        where,
        order: [['createdAt', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      })
      if (!plan) return null
      const progress = plan.progress as { leaseUntil?: string; phase?: string }
      if (
        progress.phase === 'PROCESSING' &&
        progress.leaseUntil &&
        new Date(progress.leaseUntil) > new Date()
      ) {
        return null
      }
      plan.progress = {
        ...progress,
        phase: 'PROCESSING',
        workerToken: randomUUID(),
        leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      }
      await plan.save({ transaction })
      return plan
    })
  }

  private async persistAnalysisChunk(
    planId: number,
    workerToken: string,
    analyses: Record<string, SmartProductAnalysis>,
    total: number,
  ): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      const plan = await SmartPlan.findByPk(planId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const progress = plan?.progress as { workerToken?: string } | undefined
      if (
        !plan ||
        plan.status !== SMART_PLAN_STATUS.ANALYZING ||
        progress?.workerToken !== workerToken
      ) {
        throw ConflictError('A análise foi interrompida ou assumida por outro worker')
      }
      const input = plan.input as unknown as PlanInputPayload
      plan.input = { ...input, analysisResults: analyses } as unknown as Record<string, unknown>
      plan.progress = {
        ...plan.progress,
        phase: 'PROCESSING',
        workerToken,
        completed: Object.keys(analyses).length,
        total,
        leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      }
      await plan.save({ transaction })
    })
  }

  /**
   * Fence every paid batch with the durable plan lease. Renewing immediately
   * before the provider call prevents an expired/stale worker from spending
   * after cancellation or after another worker has taken ownership.
   */
  private async renewAnalysisLease(planId: number, workerToken: string): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      const plan = await SmartPlan.findByPk(planId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const progress = plan?.progress as
        | {
            workerToken?: string
            phase?: string
            leaseUntil?: string
          }
        | undefined
      const leaseUntil = progress?.leaseUntil ? new Date(progress.leaseUntil) : null
      if (
        !plan ||
        plan.status !== SMART_PLAN_STATUS.ANALYZING ||
        progress?.phase !== 'PROCESSING' ||
        progress.workerToken !== workerToken ||
        !leaseUntil ||
        Number.isNaN(leaseUntil.getTime()) ||
        leaseUntil <= new Date()
      ) {
        throw ConflictError('A análise foi interrompida ou assumida por outro worker')
      }
      plan.progress = {
        ...plan.progress,
        leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      }
      await plan.save({ transaction })
    })
  }

  /** Worker entry point. Each completed AI chunk is persisted so retry only runs missing chunks. */
  async processPendingAnalysis(planId?: number): Promise<boolean> {
    const plan = await this.claimAnalysisPlan(planId)
    if (!plan) return false
    const workerToken = String((plan.progress as { workerToken?: string }).workerToken)
    try {
      const input = plan.input as unknown as PlanInputPayload
      const analyses: Record<string, SmartProductAnalysis> = { ...(input.analysisResults ?? {}) }
      const missing = input.offers
        .map((_, index) => index)
        .filter((index) => !analyses[String(index)])
      const audiences = await this.audienceRows(plan.userId, plan.audienceSlugs)
      const planSettings = plan.settings as {
        audienceProfiles?: NicheIntelligenceOverrides
      }
      const frozenProfiles = planSettings.audienceProfiles
      if (
        !frozenProfiles ||
        plan.audienceSlugs.some(
          (slug) => !Object.prototype.hasOwnProperty.call(frozenProfiles, slug),
        )
      ) {
        throw new AppError(
          'O plano não contém o snapshot dos critérios de análise; crie uma nova análise.',
          409,
          'SMART_ANALYSIS_SNAPSHOT_MISSING',
        )
      }
      // Explicitly assigned files are analyzed only for their group. Unassigned
      // pasted/mixed files are analyzed across every group the operator selected.
      const scopedIndexes = new Map<string, { slugs: NicheSlug[]; indexes: number[] }>()
      for (const index of missing) {
        const scopedSlugs = input.offerAudienceSlugs?.[index]?.length
        ? input.offerAudienceSlugs[index]!
          : likelyAudienceSlugs(input.offers[index], plan.audienceSlugs as NicheSlug[])
        const key = [...scopedSlugs].sort().join(',')
        const scoped = scopedIndexes.get(key) ?? { slugs: [...scopedSlugs], indexes: [] }
        scoped.indexes.push(index)
        scopedIndexes.set(key, scoped)
      }
      // Keep calls bounded and persist each completed chunk for safe resumption.
      for (const scoped of scopedIndexes.values()) {
        for (let offset = 0; offset < scoped.indexes.length; offset += 4) {
          await this.renewAnalysisLease(plan.id, workerToken)
          const indexes = scoped.indexes.slice(offset, offset + 4)
          const chunk = indexes.map((index) => input.offers[index])
          const results = await this.intelligence.analyze(
            chunk,
            scoped.slugs,
            plan.startDate,
            frozenProfiles,
            [],
            { userId: plan.userId, operationId: plan.uuid },
          )
          results.forEach((analysis, localIndex) => {
            analyses[String(indexes[localIndex])] = { ...analysis, index: indexes[localIndex] }
          })
          await this.persistAnalysisChunk(plan.id, workerToken, analyses, input.offers.length)
        }
      }
      const catalogOffers = await this.saveCatalog(plan.userId, input.offers, analyses, audiences)
      const items = await this.buildItems(
        plan,
        catalogOffers,
        input.observedAt,
        analyses,
        audiences,
        workerToken,
      )
      await sequelize.transaction(async (transaction) => {
        const current = await SmartPlan.findByPk(plan.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        const progress = current?.progress as { workerToken?: string } | undefined
        if (
          !current ||
          current.status !== SMART_PLAN_STATUS.ANALYZING ||
          progress?.workerToken !== workerToken
        ) {
          throw ConflictError('A análise foi interrompida antes da conclusão')
        }
        const latestInput = current.input as unknown as PlanInputPayload
        current.input = {
          ...latestInput,
          offers: catalogOffers,
          analysisResults: analyses,
        } as unknown as Record<string, unknown>
        current.items = items
        current.status = SMART_PLAN_STATUS.REVIEW
        current.revision += 1
        current.progress = {
          phase: 'COMPLETE',
          completed: input.offers.length,
          total: input.offers.length,
        }
        await current.save({ transaction })
      })
      return true
    } catch (error) {
      const errorCategory = error instanceof AppError && typeof error.details?.category === 'string'
        ? error.details.category
        : error instanceof AppError
          ? error.code ?? 'application_error'
          : 'unexpected_error'
      const safeFailureMessage = errorCategory === 'structured_output'
        ? 'A IA não devolveu uma análise válida nesta tentativa. Os resultados já salvos foram preservados; tente novamente.'
        : errorCategory === 'no_matching_endpoint'
          ? 'O provedor não encontrou um modelo compatível com a análise. Revise a configuração da IA e tente novamente.'
          : errorCategory === 'rate_limit'
            ? 'O provedor de IA está temporariamente ocupado. Aguarde um pouco e tente novamente.'
            : errorCategory === 'timeout'
              ? 'A análise excedeu o tempo limite. Os resultados já salvos foram preservados; tente novamente.'
              : 'Não foi possível concluir a análise. Os resultados já salvos foram preservados; tente novamente.'
      await sequelize.transaction(async (transaction) => {
        const current = await SmartPlan.findByPk(plan.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
        const progress = current?.progress as { workerToken?: string } | undefined
        if (
          current &&
          current.status === SMART_PLAN_STATUS.ANALYZING &&
          progress?.workerToken === workerToken
        ) {
          current.status = SMART_PLAN_STATUS.FAILED
          current.progress = {
            ...current.progress,
            phase: 'FAILED',
            error: safeFailureMessage,
          }
          await current.save({ transaction })
        }
      })
      logger.error(
        {
          errorName: error instanceof Error ? error.name : 'Error',
          errorCode: error instanceof AppError ? error.code : 'SMART_ANALYSIS_FAILED',
          errorCategory,
          errorCause: error instanceof AppError && typeof error.details?.cause === 'string'
            ? error.details.cause.slice(0, 100)
            : undefined,
          providerStatus: error instanceof AppError && typeof error.details?.providerStatus === 'number'
            ? error.details.providerStatus
            : undefined,
          analysisModel: env.SMART_CLASSIFICATION_MODEL,
          planId: plan.id,
          userId: plan.userId,
        },
        'smart campaign analysis failed',
      )
      return true
    }
  }

  private commercialScore(
    offer: OfferInput,
    fit: number,
    seasonal: number,
    observedAt: string | null,
  ) {
    const offerDiscount = discount(offer)
    const rate = commissionRate(offer)
    const estimated = (offer.discountedPrice * rate) / 100
    const offerValue = Math.min(100, (offerDiscount / 50) * 100)
    const rateScore = Math.min(100, (rate / 20) * 100)
    const payoutScore = Math.min(100, (Math.log1p(estimated) / Math.log1p(100)) * 100)
    const commissionOpportunity = 0.55 * rateScore + 0.45 * payoutScore
    const ageHours = observedAt
      ? Math.max(0, (Date.now() - new Date(observedAt).getTime()) / 3_600_000)
      : 999
    const freshness = Math.max(0, 100 - ageHours * (100 / DEFAULT_POLICY.freshnessHours))
    const assortment = 75
    const total =
      0.4 * fit +
      0.2 * offerValue +
      0.15 * commissionOpportunity +
      0.1 * seasonal +
      0.1 * freshness +
      0.05 * assortment
    return {
      total: Math.round(total * 10) / 10,
      estimatedCommission: Math.round(estimated * 100) / 100,
      components: {
        audienceFit: fit,
        offerValue: Math.round(offerValue),
        commissionOpportunity: Math.round(commissionOpportunity),
        seasonalFit: seasonal,
        freshness: Math.round(freshness),
        assortmentContribution: assortment,
      },
      freshnessHours: ageHours,
    }
  }

  private async buildItems(
    plan: SmartPlan,
    offers: OfferInput[],
    observations: Array<string | null>,
    analyses: Record<string, SmartProductAnalysis>,
    audiences: SmartAudience[],
    workerToken: string,
  ): Promise<SmartPlanItem[]> {
    const items: SmartPlanItem[] = []
    const settings = plan.settings as {
      audiences: Record<string, SmartAudiencePolicy>
      audienceProfiles?: NicheIntelligenceOverrides
    }
    const allowedRoutes = new Map<number, Set<string>>()
    offers.forEach((offer, index) => {
      const ranked = [...(analyses[String(index)]?.fits ?? [])].sort(
        (left, right) => right.score - left.score,
      )
      const primary = ranked[0]
      const allowed = new Set<string>()
      if (primary && primary.score >= MIN_SMART_FIT) allowed.add(primary.slug)
      const secondary = ranked.find(
        (fit, fitIndex) =>
          fitIndex > 0 && fit.score >= 85 && primary && primary.score - fit.score <= 10,
      )
      if (secondary) allowed.add(secondary.slug)
      const natalFit = ranked.find((fit) => fit.slug === 'natal')
      if (
        allowed.has('natal') &&
        natalFit &&
        natalFit.seasonalScore < 60 &&
        !/(natal|presente|guirlanda|enfeite|decora|embalagem|pisca)/i.test(
          `${offer.title} ${natalFit.category} ${natalFit.reason}`,
        )
      ) {
        allowed.delete('natal')
      }
      allowedRoutes.set(index, allowed)
    })
    const globallySelected = new Set<string>()
    const globalCategoryCounts = new Map<string, number>()
    const globalDailyCap = 50
    const globalDailyCounts = new Map<string, number>()
    for (const audience of audiences) {
      const policy = settings.audiences[audience.slug]
      const candidates: SmartPlanItem[] = []
      offers.forEach((offer, index) => {
        const analysis = analyses[String(index)]
        const fit = analysis?.fits.find((entry) => entry.slug === audience.slug)
        if (!fit) return
        const scored = this.commercialScore(
          offer,
          fit.score,
          fit.seasonalScore,
          observations[index],
        )
        const warnings = [...(analysis.warnings ?? [])]
        const rate = commissionRate(offer)
        const hardReasons: string[] = []
        if (!isVerifiedOffer(offer)) hardReasons.push('Atribuição afiliada não verificada')
        if (!hasCommissionEvidence(offer)) hardReasons.push('Comissão não informada na coleta')
        if (!observations[index]) hardReasons.push('Horário de observação ausente')
        if (
          observations[index] &&
          !isEvidenceFresh(
            observations[index],
            smartZonedInstant(plan.startDate, policy.startTime, policy.timezone),
            policy.freshnessHours,
          )
        ) {
          hardReasons.push('Evidência da oferta está antiga; atualize o produto')
        }
        if (rate < (policy.minCommissionPercent ?? 0)) hardReasons.push('Comissão abaixo do mínimo')
        if (scored.estimatedCommission < (policy.minEstimatedCommission ?? 0))
          hardReasons.push('Comissão estimada abaixo do mínimo')
        if (fit.score < MIN_SMART_FIT) hardReasons.push('Baixa afinidade com o público')
        if (!allowedRoutes.get(index)?.has(audience.slug)) {
          hardReasons.push('Priorizado para outro público para evitar repetição')
        }
        candidates.push(
          SmartPlanItemSchema.parse({
            id: `${index}:${audience.slug}`,
            audienceSlug: audience.slug,
            date: plan.startDate,
            state: hardReasons.length ? 'REJECTED' : 'RESERVE',
            product: offer,
            score: scored.total,
            fitScore: fit.score,
            estimatedCommission: scored.estimatedCommission,
            freshnessHours: scored.freshnessHours,
            reason: hardReasons.length ? hardReasons.join('; ') : fit.reason,
            category: fit.category,
            warnings,
            standout: false,
            observedAt: observations[index] ?? new Date(0).toISOString(),
            scores: scored.components,
          }),
        )
      })
      const eligible = candidates
        .filter((item) => item.state !== 'REJECTED')
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      const capacity = Math.min(
        policy.dailyCap,
        Math.floor(
          ((minutes(policy.endTime) - minutes(policy.startTime)) * 60) / policy.minGapSeconds,
        ) + 1,
      )
      const selected: SmartPlanItem[] = []
      for (let dayOffset = 0; dayOffset < plan.days; dayOffset++) {
        const date = addDays(plan.startDate, dayOffset)
        const maximum = capacity
        const categoryLimit = Math.max(1, Math.ceil(maximum * 0.25))
        const chosen: SmartPlanItem[] = []
        const dayCandidates = eligible.filter((item) => !globallySelected.has(item.id))
        // Evenly distribute this audience's best remaining offers across the selected dates.
        const remainingDays = plan.days - dayOffset
        const audienceTarget = Math.ceil(
          Math.min(eligible.length - selected.length, capacity * remainingDays) / remainingDays,
        )
        for (const item of dayCandidates) {
          const scheduledToday = selected.filter((entry) => entry.date === date).length
          if (chosen.length >= Math.min(maximum, audienceTarget - scheduledToday)) break
          const alreadyOnDate = globalDailyCounts.get(date) ?? 0
          if (alreadyOnDate >= globalDailyCap) break
          if (chosen.length >= maximum) break
          const category = item.category ?? 'outros'
          const count = globalCategoryCounts.get(`${date}:${category}`) ?? 0
          if (count >= categoryLimit) continue
          const sendAt = smartZonedInstant(date, policy.startTime, policy.timezone)
          if (!isEvidenceFresh(item.observedAt, sendAt, policy.freshnessHours)) continue
          chosen.push(item)
          globalCategoryCounts.set(`${date}:${category}`, count + 1)
        }
        const slots = buildSmartSchedule(
          date,
          chosen.length,
          policy,
          `${plan.uuid}:${audience.slug}:${date}`,
        )
        chosen.forEach((item, index) => {
          item.state = 'SELECTED'
          item.date = date
          item.scheduledAt = slots[index].toISOString()
          selected.push(item)
          globallySelected.add(item.id)
          globalDailyCounts.set(date, (globalDailyCounts.get(date) ?? 0) + 1)
        })
      }
      const standoutsByDate = new Map<string, SmartPlanItem[]>()
      for (const item of selected) {
        const list = standoutsByDate.get(item.date) ?? []
        list.push(item)
        standoutsByDate.set(item.date, list)
      }
      for (const dayItems of standoutsByDate.values()) {
        const standoutItems = dayItems
          .filter((item) => (item.fitScore ?? 0) >= 75 && item.score >= 70)
          .slice(0, policy.maxStandouts)
        await Promise.all(
          standoutItems.map(async (item) => {
            await this.renewAnalysisLease(plan.id, workerToken)
            try {
              item.customMessage =
                (await this.intelligence.standoutCopy(
                  item.product,
                  audience.slug as NicheSlug,
                  {
                    [audience.slug]: settings.audienceProfiles?.[audience.slug as NicheSlug],
                  },
                  { userId: plan.userId, operationId: `${plan.uuid}:copy:${item.id}` },
                )) || null
              item.standout = Boolean(item.customMessage)
            } catch {
              item.warnings.push(
                'Não foi possível gerar a mensagem especial; será usado o modelo padrão.',
              )
            }
          }),
        )
      }
      items.push(...candidates)
    }
    return items
  }

  private async saveCatalog(
    userId: number,
    offers: OfferInput[],
    analyses: Record<string, SmartProductAnalysis>,
    audiences: SmartAudience[],
  ): Promise<OfferInput[]> {
    // Persist one classification per audience. Existing catalog identity deduplication
    // keeps the same product row while adding profile-specific ratings.
    const catalogOffers = offers.map((offer) => ({ ...offer }))
    for (const audience of audiences) {
      if (!audience.classificationProfileId) continue
      const classified = catalogOffers.map((offer, index) => {
        const fit = analyses[String(index)]?.fits.find((entry) => entry.slug === audience.slug)
        const relevanceScore = fit?.score ?? 0
        return {
          ...offer,
          category: categoryForScore(relevanceScore),
          relevanceScore,
          discountPercent: discount(offer),
          commissionRate: commissionRate(offer),
          classificationProfileId: audience.classificationProfileId!,
          classificationProfileName: audience.name,
        }
      })
      const result = await this.savedProducts.save(userId, classified)
      const savedRows = Array.isArray(result as unknown)
        ? (result as unknown as Array<{ id?: number }>)
        : result.saved
      savedRows.forEach((product, index) => {
        if (product.id)
          catalogOffers[index] = { ...catalogOffers[index], savedProductId: product.id }
      })
    }
    return catalogOffers
  }

  async retryAnalysis(userId: number, uuid: string, revision?: number, requestId?: string) {
    if (revision === undefined)
      throw BadRequestError('Informe a revisão atual para repetir a análise')
    const plan = await sequelize.transaction(async (transaction) => {
      await this.advisoryLock(transaction, `smart-analysis-budget:${userId}`)
      const found = await this.requirePlan(userId, uuid, transaction)
      if (found.revision !== revision) throw ConflictError('O plano foi alterado; atualize a tela')
      if (found.status !== SMART_PLAN_STATUS.FAILED)
        throw ConflictError('Apenas análises com falha podem ser tentadas novamente')
      if ((found.progress as { phase?: string }).phase !== 'FAILED') {
        throw ConflictError(
          'Esta falha ocorreu após a análise; crie um novo plano para tentar novamente',
        )
      }
      if (await SmartSend.count({ where: { userId, planId: found.id }, transaction })) {
        throw ConflictError('Planos que já criaram envios não podem repetir a análise')
      }
      const activePlans = await SmartPlan.count({
        where: {
          userId,
          id: { [Op.ne]: found.id },
          status: {
            [Op.in]: [
              SMART_PLAN_STATUS.ANALYZING,
              SMART_PLAN_STATUS.REVIEW,
              SMART_PLAN_STATUS.SCHEDULED,
              SMART_PLAN_STATUS.PAUSED,
            ],
          },
        },
        transaction,
      })
      if (activePlans >= 2)
        throw ConflictError('Conclua ou cancele um plano antes de repetir a análise')
      found.status = SMART_PLAN_STATUS.ANALYZING
      found.revision += 1
      found.progress = { ...found.progress, phase: 'QUEUED' }
      await found.save({ transaction })
      await recordSmartOperation(
        userId,
        'SMART_PLAN_ANALYSIS_RETRIED',
        {
          planId: found.id,
          planUuid: found.uuid,
          revision: found.revision,
          ...(requestId ? { requestId } : {}),
        },
        transaction,
      )
      return found
    })
    return serializePlan(plan)
  }

  async updatePlan(userId: number, uuid: string, input: UpdateSmartPlanInput) {
    return sequelize.transaction(async (transaction) => {
      const plan = await this.requirePlan(userId, uuid, transaction)
      if (plan.status !== SMART_PLAN_STATUS.REVIEW)
        throw ConflictError('Somente planos em revisão podem ser editados')
      if (plan.revision !== input.revision)
        throw ConflictError('O plano foi alterado; atualize a tela')
      const updates = new Map(input.items.map((item) => [item.id, item]))
      const start = plan.startDate
      const end = addDays(start, plan.days - 1)
      const items = (plan.items as SmartPlanItem[]).map((item) => {
        const patch = updates.get(item.id)
        if (!patch) return item
        const next = { ...item, ...patch }
        if (!plan.audienceSlugs.includes(next.audienceSlug))
          throw BadRequestError('Público fora deste plano')
        if (next.date < start || next.date > end) throw BadRequestError('Data fora deste plano')
        if (next.state === 'SELECTED') {
          const settings = plan.settings as { audiences: Record<string, SmartAudiencePolicy> }
          const policy = settings.audiences[next.audienceSlug]
          const gateFailures: string[] = []
          const rate = commissionRate(next.product)
          const estimated = (next.product.discountedPrice * rate) / 100
          if (!isVerifiedOffer(next.product))
            gateFailures.push('atribuição afiliada não verificada')
          if (!hasCommissionEvidence(next.product)) gateFailures.push('comissão não informada')
          if (!next.observedAt || new Date(next.observedAt).getTime() <= 0)
            gateFailures.push('observação ausente')
          if ((next.fitScore ?? 0) < MIN_SMART_FIT) gateFailures.push('afinidade insuficiente')
          if (rate < (policy?.minCommissionPercent ?? 0))
            gateFailures.push('comissão abaixo do mínimo')
          if (estimated < (policy?.minEstimatedCommission ?? 0))
            gateFailures.push('retorno estimado abaixo do mínimo')
          if (gateFailures.length) {
            throw BadRequestError(`O item não pode ser selecionado: ${gateFailures.join(', ')}`)
          }
        }
        if (patch.scheduledAt === null) delete next.scheduledAt
        return SmartPlanItemSchema.parse(next)
      })
      const known = new Set((plan.items as SmartPlanItem[]).map((item) => item.id))
      if ([...updates.keys()].some((id) => !known.has(id)))
        throw BadRequestError('Item do plano não encontrado')
      plan.items = items
      plan.revision += 1
      await plan.save({ transaction })
      return serializePlan(plan)
    })
  }

  private async advisoryLock(transaction: Transaction, key: string): Promise<void> {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key },
      type: QueryTypes.SELECT,
      transaction,
    })
  }

  async approve(userId: number, uuid: string, revision?: number) {
    if (revision === undefined)
      throw BadRequestError('Informe a revisão atual para aprovar o plano')
    const audiences = await this.ensureAudiences(userId)
    const selectedAudiences = new Map(audiences.map((audience) => [audience.slug, audience]))
    const planPreview = await this.requirePlan(userId, uuid)
    if (planPreview.status === SMART_PLAN_STATUS.SCHEDULED) return this.getPlan(userId, uuid)
    if (planPreview.status !== SMART_PLAN_STATUS.REVIEW)
      throw ConflictError('O plano ainda não está pronto para aprovação')
    const usedSlugs = [
      ...new Set(
        (planPreview.items as SmartPlanItem[])
          .filter((item) => item.state === 'SELECTED')
          .map((item) => item.audienceSlug),
      ),
    ]
    const bindings = usedSlugs
      .map((slug) => selectedAudiences.get(slug))
      .filter((value): value is SmartAudience => Boolean(value))
    if (bindings.some((audience) => !audience.enabled || !audience.destinations.length)) {
      throw BadRequestError(
        'Todo público selecionado precisa estar ativo e vinculado a ao menos um grupo',
      )
    }
    const requestedGroups = [
      ...new Set(bindings.flatMap((audience) => audience.destinations.map((item) => item.groupId))),
    ]
    const destinationOwners = new Map<string, string>()
    for (const audience of bindings) {
      for (const destination of audience.destinations) {
        const owner = destinationOwners.get(destination.groupId)
        if (owner && owner !== audience.slug) {
          throw BadRequestError('O mesmo grupo não pode receber dois públicos no mesmo plano')
        }
        destinationOwners.set(destination.groupId, audience.slug)
      }
    }
    const [currentGroups, connectionScope] = await Promise.all([
      this.groups.requireCurrentGroups(userId, requestedGroups),
      this.connections.getConnectionScope(userId),
    ])
    if (!connectionScope) throw BadRequestError('Conecte o WhatsApp antes de aprovar o plano')

    await sequelize.transaction(async (transaction) => {
      await this.advisoryLock(transaction, `delivery-account:${userId}:${connectionScope}`)
      const plan = await this.requirePlan(userId, uuid, transaction)
      if (plan.status === SMART_PLAN_STATUS.SCHEDULED) return
      if (plan.status !== SMART_PLAN_STATUS.REVIEW)
        throw ConflictError('O plano não está mais em revisão')
      if (plan.revision !== revision) throw ConflictError('O plano foi alterado; atualize a tela')
      const freshScope = await this.connections.getConnectionScope(userId)
      if (freshScope !== connectionScope)
        throw ConflictError('A conexão mudou durante a aprovação; tente novamente')
      const freshBindings = await SmartAudience.findAll({
        where: { userId, slug: usedSlugs },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (
        freshBindings.length !== usedSlugs.length ||
        freshBindings.some((audience) => !audience.enabled || !audience.destinations.length)
      ) {
        throw ConflictError('Os vínculos de público mudaram; revise o plano')
      }
      for (const audience of freshBindings) selectedAudiences.set(audience.slug, audience)
      const freshGroupIds = [
        ...new Set(
          freshBindings.flatMap((audience) => audience.destinations.map((item) => item.groupId)),
        ),
      ].sort()
      if (freshGroupIds.join('\0') !== [...requestedGroups].sort().join('\0')) {
        throw ConflictError('Os grupos vinculados mudaram; revise o plano')
      }
      for (const groupId of [...requestedGroups].sort()) {
        await this.advisoryLock(
          transaction,
          `delivery-destination:${userId}:${connectionScope}:${groupId}`,
        )
      }
      const activeLegacy = await Campaign.findAll({
        where: {
          userId,
          status: { [Op.in]: [CAMPAIGN_STATUS_ENUM.SCHEDULED, CAMPAIGN_STATUS_ENUM.RUNNING] },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const conflicting = activeLegacy.filter((campaign) =>
        campaign.groups.some((group) => requestedGroups.includes(group.id)),
      )
      if (conflicting.length) {
        throw ConflictError(
          `Pause as campanhas manuais ativas: ${conflicting.map((item) => item.name).join(', ')}`,
        )
      }
      const settings = plan.settings as { audiences: Record<string, SmartAudiencePolicy> }
      const selected = (plan.items as SmartPlanItem[]).filter((item) => item.state === 'SELECTED')
      if (!selected.length) throw BadRequestError('Selecione ao menos um produto antes de aprovar')
      const today = getSmartLocalDate(new Date(), plan.timezone)
      if (selected.some((item) => item.date < today)) {
        throw BadRequestError('O plano contém produtos em datas passadas; mova-os antes de aprovar')
      }
      const rows: CreationAttributes<SmartSend>[] = []
      const selectedByDate = new Map<string, number>()
      for (const item of selected) {
        selectedByDate.set(item.date, (selectedByDate.get(item.date) ?? 0) + 1)
      }
      if ([...selectedByDate.values()].some((count) => count > 50)) {
        throw BadRequestError('A campanha não pode enviar mais de 50 produtos no total por dia')
      }
      for (const slug of usedSlugs) {
        const audience = selectedAudiences.get(slug)!
        const policy = settings.audiences[slug] ?? audience.policy
        for (const date of [
          ...new Set(
            selected.filter((item) => item.audienceSlug === slug).map((item) => item.date),
          ),
        ]) {
          const dayItems = selected
            .filter((item) => item.audienceSlug === slug && item.date === date)
            .sort((left, right) => right.score - left.score)
          let earliest: Date | undefined
          if (date === getSmartLocalDate(new Date(), policy.timezone)) {
            earliest = new Date(Date.now() + policy.minGapSeconds * 1000)
          }
          const slots = buildSmartSchedule(
            date,
            dayItems.length,
            policy,
            `${plan.uuid}:${slug}:${date}:approved`,
            earliest,
          )
          dayItems.forEach((item, index) => {
            item.scheduledAt = slots[index].toISOString()
          })
        }
        const standoutByDate = new Map<string, number>()
        for (const item of selected.filter((entry) => entry.audienceSlug === slug)) {
          const rate = commissionRate(item.product)
          const estimatedCommission = (item.product.discountedPrice * rate) / 100
          if (
            !isVerifiedOffer(item.product) ||
            !hasCommissionEvidence(item.product) ||
            (item.fitScore ?? 0) < MIN_SMART_FIT ||
            rate < (policy.minCommissionPercent ?? 0) ||
            estimatedCommission < (policy.minEstimatedCommission ?? 0)
          ) {
            throw BadRequestError(
              `O item "${item.product.title}" não atende aos critérios automáticos`,
            )
          }
          if (item.standout) {
            const count = (standoutByDate.get(item.date) ?? 0) + 1
            if (count > policy.maxStandouts)
              throw BadRequestError('O plano excede o limite de mensagens especiais')
            standoutByDate.set(item.date, count)
          }
          const observedAt = new Date(item.observedAt)
          if (
            !item.scheduledAt ||
            !isEvidenceFresh(observedAt, new Date(item.scheduledAt), policy.freshnessHours)
          ) {
            throw ConflictError(
              `Atualize a evidência de oferta antes de agendar "${item.product.title}"`,
            )
          }
          for (const destination of audience.destinations) {
            const actual = currentGroups.get(destination.groupId)!
            rows.push({
              userId,
              planId: plan.id,
              audienceSlug: slug,
              groupId: actual.id,
              groupName: actual.name,
              connectionScope,
              savedProductId: item.product.savedProductId ?? item.savedProductId ?? null,
              offerIdentity: offerIdentity(item.product),
              offer: item.product,
              messageIntro: item.standout ? item.customMessage?.trim() || null : null,
              scheduledAt: new Date(item.scheduledAt),
              localDate: item.date,
              timezone: policy.timezone,
              evidenceObservedAt: observedAt,
              status: SMART_SEND_STATUS.PENDING,
            })
          }
        }
      }
      for (const groupId of requestedGroups) {
        const groupRows = rows.filter((row) => row.groupId === groupId)
        for (const date of [...new Set(groupRows.map((row) => row.localDate))]) {
          const datedRows = groupRows.filter((item) => item.localDate === date)
          const policies = datedRows.map(
            (item) => settings.audiences[item.audienceSlug] ?? DEFAULT_POLICY,
          )
          const policy = policies.reduce((strictest, candidate) =>
            candidate.dailyCap < strictest.dailyCap ? candidate : strictest,
          )
          const reserved = await SmartSend.count({
            where: {
              userId,
              connectionScope,
              groupId,
              localDate: date,
              status: { [Op.in]: RESERVED_SEND_STATUSES },
            },
            transaction,
          })
          const legacy = await CampaignLog.count({
            where: {
              groupId,
              connectionScope,
              success: true,
              sentAt: {
                [Op.gte]: smartZonedInstant(date, '00:00', policy.timezone),
                [Op.lt]: smartZonedInstant(addDays(date, 1), '00:00', policy.timezone),
              },
            },
            include: [
              {
                model: Campaign,
                as: 'campaign',
                required: true,
                where: { userId },
                attributes: [],
              },
            ],
            transaction,
          })
          const incoming = datedRows.length
          if (reserved + legacy + incoming > policy.dailyCap) {
            throw ConflictError(
              `O grupo ${currentGroups.get(groupId)?.name ?? groupId} excederia o limite de ${policy.dailyCap} envios em ${date}`,
            )
          }
        }
      }
      const aliasesByPair = new Map<string, Set<string>>()
      for (const row of rows) {
        const key = row.groupId
        const aliases = aliasesByPair.get(key) ?? new Set<string>()
        for (const alias of offerIdentityAliases(row.offer)) aliases.add(alias)
        aliasesByPair.set(key, aliases)
      }
      const identities = [...new Set([...aliasesByPair.values()].flatMap((set) => [...set]))]
      if (identities.length) {
        const delivered = await ProductGroupDelivery.findAll({
          where: { userId, connectionScope, groupId: requestedGroups, offerIdentity: identities },
          transaction,
        })
        if (delivered.some((entry) => aliasesByPair.get(entry.groupId)?.has(entry.offerIdentity))) {
          throw ConflictError(
            'Um produto selecionado já foi enviado ou está reservado para este grupo',
          )
        }
      }
      await SmartSend.bulkCreate(rows, { transaction })
      // Nested item scheduling changed in memory; assign fresh objects so
      // Sequelize reliably marks the JSONB snapshot dirty.
      plan.items = (plan.items as Record<string, unknown>[]).map((item) => ({ ...item }))
      plan.status = SMART_PLAN_STATUS.SCHEDULED
      plan.approvedAt = new Date()
      plan.revision += 1
      await plan.save({ transaction })
      await recordSmartOperation(
        userId,
        'SMART_PLAN_APPROVED',
        {
          planId: plan.id,
          planUuid: plan.uuid,
          revision: plan.revision,
          groupIds: requestedGroups,
          sendCount: rows.length,
        },
        transaction,
      )
    })
    return this.getPlan(userId, uuid)
  }

  async pause(userId: number, uuid: string, revision?: number) {
    return this.changeScheduledStatus(userId, uuid, SMART_PLAN_STATUS.PAUSED, revision)
  }

  async resume(userId: number, uuid: string, revision?: number) {
    return this.changeScheduledStatus(userId, uuid, SMART_PLAN_STATUS.SCHEDULED, revision)
  }

  private async changeScheduledStatus(
    userId: number,
    uuid: string,
    next: SMART_PLAN_STATUS,
    revision?: number,
  ) {
    if (revision === undefined)
      throw BadRequestError('Informe a revisão atual para alterar o plano')
    const plan = await sequelize.transaction(async (transaction) => {
      const found = await this.requirePlan(userId, uuid, transaction)
      const expected =
        next === SMART_PLAN_STATUS.PAUSED ? SMART_PLAN_STATUS.SCHEDULED : SMART_PLAN_STATUS.PAUSED
      if (found.status === next) return found
      if (found.status !== expected) throw ConflictError('O plano não pode mudar para este estado')
      if (found.revision !== revision) throw ConflictError('O plano foi alterado; atualize a tela')
      if (next === SMART_PLAN_STATUS.SCHEDULED) {
        const attentionRequired = await SmartSend.count({
          where: {
            userId,
            planId: found.id,
            status: { [Op.in]: [SMART_SEND_STATUS.FAILED, SMART_SEND_STATUS.UNKNOWN] },
          },
          transaction,
        })
        if (attentionRequired) {
          throw ConflictError('Resolva os envios incertos ou cancele este plano antes de continuar')
        }
      }
      found.status = next
      found.revision += 1
      await found.save({ transaction })
      await recordSmartOperation(
        userId,
        next === SMART_PLAN_STATUS.PAUSED ? 'SMART_PLAN_PAUSED' : 'SMART_PLAN_RESUMED',
        { planId: found.id, planUuid: found.uuid, revision: found.revision },
        transaction,
      )
      return found
    })
    return this.getPlan(userId, plan.uuid)
  }

  async cancel(userId: number, uuid: string, revision?: number) {
    if (revision === undefined)
      throw BadRequestError('Informe a revisão atual para cancelar o plano')
    const plan = await sequelize.transaction(async (transaction) => {
      const found = await this.requirePlan(userId, uuid, transaction)
      if (found.status === SMART_PLAN_STATUS.CANCELLED) return found
      if ([SMART_PLAN_STATUS.COMPLETED, SMART_PLAN_STATUS.CANCELLED].includes(found.status)) {
        throw ConflictError('O plano já foi encerrado')
      }
      if (found.revision !== revision) throw ConflictError('O plano foi alterado; atualize a tela')
      await SmartSend.update(
        { status: SMART_SEND_STATUS.SKIPPED, lastError: 'Plano cancelado pelo operador' },
        { where: { userId, planId: found.id, status: SMART_SEND_STATUS.PENDING }, transaction },
      )
      found.status = SMART_PLAN_STATUS.CANCELLED
      found.completedAt = new Date()
      found.revision += 1
      await found.save({ transaction })
      await recordSmartOperation(
        userId,
        'SMART_PLAN_CANCELLED',
        {
          planId: found.id,
          planUuid: found.uuid,
          revision: found.revision,
        },
        transaction,
      )
      return found
    })
    return this.getPlan(userId, plan.uuid)
  }

  async resolveUnknown(userId: number, sendUuid: string, resolution: 'sent' | 'retry' | 'skip') {
    return sequelize.transaction(async (transaction) => {
      const candidate = await SmartSend.findOne({ where: { uuid: sendUuid, userId }, transaction })
      if (!candidate) throw NotFoundError('Envio inteligente não encontrado')
      await this.advisoryLock(
        transaction,
        `delivery-account:${userId}:${candidate.connectionScope}`,
      )
      await this.advisoryLock(
        transaction,
        `delivery-destination:${userId}:${candidate.connectionScope}:${candidate.groupId}`,
      )
      const send = await SmartSend.findOne({
        where: { uuid: sendUuid, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!send) throw NotFoundError('Envio inteligente não encontrado')
      if (send.status !== SMART_SEND_STATUS.UNKNOWN)
        throw ConflictError('Apenas envios incertos podem ser resolvidos')
      const plan = await SmartPlan.findOne({
        where: { id: send.planId, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!plan) throw NotFoundError('Plano inteligente não encontrado')
      const settings = plan.settings as { audiences?: Record<string, SmartAudiencePolicy> }
      const policy = settings.audiences?.[send.audienceSlug] ?? DEFAULT_POLICY
      const aliases = offerIdentityAliases(send.offer)
      const ledgerWhere = {
        userId,
        connectionScope: send.connectionScope,
        groupId: send.groupId,
        offerIdentity: { [Op.in]: aliases },
        campaignId: null,
        status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
      }
      const pendingLedger = await ProductGroupDelivery.findAll({
        where: ledgerWhere,
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      const resolutionAvailableAt = smartUnknownResolutionAvailableAt(
        send.updatedAt,
        send.leaseExpiresAt,
        pendingLedger.map((entry) => entry.heartbeatAt),
      )
      if (resolutionAvailableAt > new Date()) {
        throw new AppError(
          'Aguarde cinco minutos antes de resolver um envio incerto',
          409,
          'SMART_UNKNOWN_COOLDOWN',
          { resolutionAvailableAt: resolutionAvailableAt.toISOString() },
        )
      }
      if (resolution === 'sent') {
        send.status = SMART_SEND_STATUS.SENT
        send.sentAt = send.sentAt ?? new Date()
        const [updated] = await ProductGroupDelivery.update(
          {
            status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
            sentAt: send.sentAt,
            messageId: send.providerMessageId,
          },
          { where: ledgerWhere, transaction },
        )
        if (!updated) {
          await ProductGroupDelivery.create(
            {
              userId,
              connectionScope: send.connectionScope,
              offerIdentity: send.offerIdentity,
              offerSource: send.offer.source ?? null,
              offerProductId: send.offer.productId ?? null,
              offerUrl: send.offer.affiliateUrl,
              offerTitle: send.offer.title,
              groupId: send.groupId,
              groupName: send.groupName,
              campaignId: null,
              status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
              messageId: send.providerMessageId,
              sentAt: send.sentAt,
            },
            { transaction },
          )
        }
      } else if (resolution === 'retry') {
        if (plan.status === SMART_PLAN_STATUS.CANCELLED) {
          throw ConflictError('Um plano cancelado não pode ser reenviado')
        }
        if (send.attempts >= send.maxAttempts) {
          throw ConflictError('O envio atingiu o limite de tentativas')
        }
        const next = new Date(Date.now() + Math.max(300, policy.minGapSeconds) * 1000)
        if (!isEvidenceFresh(send.evidenceObservedAt, next, policy.freshnessHours)) {
          throw ConflictError(
            'A oferta expirou; importe dados atualizados antes de tentar novamente',
          )
        }
        await ProductGroupDelivery.destroy({ where: ledgerWhere, transaction })
        send.status = SMART_SEND_STATUS.PENDING
        send.scheduledAt = next
        send.localDate = getSmartLocalDate(next, policy.timezone)
        send.providerMessageId = null
      } else {
        // "skip" means do not retry an uncertain provider call. Conservatively
        // settle the no-repeat ledger as sent so another campaign cannot duplicate it.
        send.status = SMART_SEND_STATUS.SKIPPED
        await ProductGroupDelivery.update(
          { status: PRODUCT_GROUP_DELIVERY_STATUS.SENT, sentAt: new Date() },
          { where: ledgerWhere, transaction },
        )
      }
      send.leaseOwner = null
      send.leaseExpiresAt = null
      send.lastError =
        resolution === 'retry' ? null : `Resultado incerto resolvido pelo operador: ${resolution}`
      await send.save({ transaction })
      if (plan.status !== SMART_PLAN_STATUS.CANCELLED) {
        const unknown = await SmartSend.count({
          where: { planId: plan.id, status: SMART_SEND_STATUS.UNKNOWN },
          transaction,
        })
        const active = await SmartSend.count({
          where: {
            planId: plan.id,
            status: { [Op.in]: [SMART_SEND_STATUS.PENDING, SMART_SEND_STATUS.SENDING] },
          },
          transaction,
        })
        const failed = await SmartSend.count({
          where: { planId: plan.id, status: SMART_SEND_STATUS.FAILED },
          transaction,
        })
        if (unknown > 0 || failed > 0) {
          plan.status = SMART_PLAN_STATUS.PAUSED
          plan.completedAt = null
        } else if (active > 0) {
          plan.status = SMART_PLAN_STATUS.SCHEDULED
          plan.completedAt = null
        } else {
          plan.status = SMART_PLAN_STATUS.COMPLETED
          plan.completedAt = new Date()
        }
        plan.revision += 1
        await plan.save({ transaction })
      }
      await recordSmartOperation(
        userId,
        'SMART_SEND_UNKNOWN_RESOLVED',
        {
          sendId: send.id,
          sendUuid,
          planId: plan.id,
          resolution,
          fromStatus: SMART_SEND_STATUS.UNKNOWN,
          toStatus: send.status,
        },
        transaction,
      )
      return {
        id: send.uuid,
        status: send.status,
        scheduledAt: send.scheduledAt,
        sentAt: send.sentAt,
      }
    })
  }
}
