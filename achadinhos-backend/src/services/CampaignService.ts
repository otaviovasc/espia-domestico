import { injectable, inject } from 'tsyringe'
import { Op, UniqueConstraintError } from 'sequelize'
import { randomUUID } from 'node:crypto'
import {
  Campaign,
  CAMPAIGN_STATUS_ENUM,
  CampaignOffer,
  CampaignGroup,
} from '@/database/models/Campaign'
import { CampaignLog } from '@/database/models/CampaignLog'
import { SavedProduct } from '@/database/models/SavedProduct'
import {
  ProductGroupDelivery,
  PRODUCT_GROUP_DELIVERY_STATUS,
} from '@/database/models/ProductGroupDelivery'
import { UazapiClient } from '@/channels/uazapi/UazapiClient'
import { ConnectionService, ConnectedContext } from '@/services/ConnectionService'
import { GroupService } from '@/services/GroupService'
import { SafeSender, SendResult, SendTask, buildTasks, computeStallMs } from '@/services/SafeSender'
import { CreateCampaignInput } from '@/dtos/campaign'
import { BadRequestError, NotFoundError } from '@/middleware/Error/AppError'
import { logger } from '@/utils/logger'
import {
  offerIdentity,
  offerIdentityAliases,
  offerResultKey,
  normalizedOfferSource,
} from '@/utils/offerIdentity'
import { sequelize } from '@/database'

export const DELIVERY_CLAIM_RECOVERY_MS = 5 * 60 * 1000
const configuredHeartbeatMs = Number(process.env.DELIVERY_CLAIM_HEARTBEAT_MS)
export const DELIVERY_CLAIM_HEARTBEAT_MS =
  Number.isFinite(configuredHeartbeatMs) && configuredHeartbeatMs >= 10
    ? configuredHeartbeatMs
    : 15_000

/**
 * A RUNNING campaign updates its heartbeat every CAMPAIGN_HEARTBEAT_MS while a
 * live process owns it (even during inter-message delays and hourly-cap
 * pauses). The stall threshold — how long silence means the process died — is
 * computed per campaign from its pacing via computeStallMs (SafeSender), so a
 * long-interval campaign is never wrongly flagged as dead.
 */
export const CAMPAIGN_HEARTBEAT_MS = 15_000

type CheckOfferInput = {
  savedProductId?: number
  source?: string
  productId?: string
  affiliateUrl: string
}

function sameOffer(candidate: CheckOfferInput, offer: CheckOfferInput): boolean {
  if (offer.savedProductId && candidate.savedProductId) {
    return candidate.savedProductId === offer.savedProductId
  }
  const productId = offer.productId?.trim()
  if (!productId) return candidate.affiliateUrl === offer.affiliateUrl.trim()
  if (candidate.productId?.trim() !== productId) return false
  return (
    !offer.source || normalizedOfferSource(candidate.source) === normalizedOfferSource(offer.source)
  )
}

function comparableOffer(offer: CampaignOffer): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(offer)
        .filter(
          ([key, value]) =>
            key !== 'savedProductId' && key !== 'classificationProfileName' && value !== undefined,
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

export interface OfferGroupStatus {
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

export interface OfferSendStatus {
  alreadySent: boolean
  sentCount: number
  lastSentAt: string | null
  sampleGroup: string | null
  inActiveCampaign: boolean
  activeCampaignNames: string[]
  groups: OfferGroupStatus[]
  sentGroupIds: string[]
  sendingGroupIds: string[]
  eligibleGroupIds: string[]
}

export interface ResolveDeliveryClaimInput {
  savedProductId?: number
  offer?: CheckOfferInput
  groupId: string
  resolution: 'sent' | 'retry'
}

@injectable()
export class CampaignService {
  constructor(
    @inject(UazapiClient) private uazapi: UazapiClient,
    @inject(ConnectionService) private connectionService: ConnectionService,
    @inject(GroupService) private groupService: GroupService,
  ) {}

  async create(userId: number, input: CreateCampaignInput): Promise<Campaign> {
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
      throw BadRequestError('A data de agendamento está no passado')
    }
    await this.assertCatalogReferences(userId, input.offers)
    return Campaign.create({
      userId,
      name: input.name,
      offers: input.offers,
      groups: input.groups,
      safety: input.safety,
      messageTemplate: input.messageTemplate?.trim() || null,
      sendImages: input.sendImages ?? true,
      status: scheduledAt ? CAMPAIGN_STATUS_ENUM.SCHEDULED : CAMPAIGN_STATUS_ENUM.DRAFT,
      scheduledAt,
    })
  }

  /**
   * For each provided offer, report whether it was already SENT before (from
   * campaign_logs) and whether it currently appears in an active (scheduled or
   * running) campaign. Identity is (source, productId) when both exist,
   * productId for legacy source-free offers, then affiliateUrl.
   *
   * Returns a map keyed by the offer's identity so the UI can annotate rows.
   */
  async checkOffers(
    userId: number,
    offers: CheckOfferInput[],
    groupIds?: string[],
  ): Promise<Record<string, OfferSendStatus>> {
    const productIds = offers.map((o) => o.productId?.trim()).filter((v): v is string => !!v)
    const urls = offers.map((o) => o.affiliateUrl.trim()).filter(Boolean)

    // 1) Sent history from successful campaign logs of THIS user's campaigns.
    const userCampaigns = await Campaign.findAll({
      where: { userId },
      attributes: ['id', 'name', 'status', 'offers', 'groups'],
    })
    const userCampaignIds = userCampaigns.map((c) => c.id)
    const campaignById = new Map(userCampaigns.map((c) => [c.id, c]))

    const logs = await (async () => {
      if (!userCampaignIds.length) return []
      const orConditions: Array<Record<string, unknown>> = []
      if (productIds.length) orConditions.push({ offerProductId: { [Op.in]: productIds } })
      if (urls.length) orConditions.push({ offerUrl: { [Op.in]: urls } })
      if (orConditions.length === 0) return []
      return CampaignLog.findAll({
        where: {
          campaignId: { [Op.in]: userCampaignIds },
          success: true,
          [Op.or]: orConditions,
        },
        attributes: [
          'campaignId',
          'connectionScope',
          'offerIdentity',
          'offerProductId',
          'offerUrl',
          'groupId',
          'groupName',
          'sentAt',
        ],
        order: [['sentAt', 'DESC']],
      })
    })()

    // 2) Active (scheduled/running) campaigns that contain each identity.
    const activeCampaigns = userCampaigns.filter(
      (c) =>
        c.status === CAMPAIGN_STATUS_ENUM.SCHEDULED || c.status === CAMPAIGN_STATUS_ENUM.RUNNING,
    )

    const connectionScope = await this.connectionService.getConnectionScope(userId)
    const ledger = connectionScope
      ? await ProductGroupDelivery.findAll({
          where: {
            userId,
            connectionScope,
            offerIdentity: { [Op.in]: [...new Set(offers.flatMap(offerIdentityAliases))] },
          },
        })
      : []

    const requestedGroupIds = groupIds ? new Set(groupIds) : null
    const result: Record<string, OfferSendStatus> = {}

    for (const offer of offers) {
      const id = offerResultKey(offer)
      const pid = offer.productId?.trim()
      const url = offer.affiliateUrl.trim()
      const identityAliases = offerIdentityAliases(offer)
      const matches = logs.filter((log) => {
        // A null legacy scope is ambiguous after reconnect. Migration backfills
        // known rows; any remaining ambiguous row is audit-only and must not
        // suppress sends for a specific current instance.
        if (connectionScope && log.connectionScope !== connectionScope) return false
        if (log.offerIdentity) return identityAliases.includes(log.offerIdentity)
        if (!pid) return log.offerUrl === url
        if (log.offerProductId !== pid) return false
        if (!offer.source) return true
        const campaign = campaignById.get(log.campaignId)
        return (campaign?.offers ?? []).some((candidate) => sameOffer(candidate, offer))
      })
      const matchingActiveCampaigns = activeCampaigns.filter((campaign) =>
        campaign.offers.some((candidate) => sameOffer(candidate, offer)),
      )
      const visibleActiveCampaigns = requestedGroupIds
        ? matchingActiveCampaigns.filter((campaign) =>
            campaign.groups.some((group) => requestedGroupIds.has(group.id)),
          )
        : matchingActiveCampaigns
      const activeNames = visibleActiveCampaigns.map((c) => c.name)

      const offerLedger = ledger.filter((entry) => identityAliases.includes(entry.offerIdentity))
      const visibleMatches = requestedGroupIds
        ? matches.filter((log) => requestedGroupIds.has(log.groupId))
        : matches
      const visibleLedger = requestedGroupIds
        ? offerLedger.filter((delivery) => requestedGroupIds.has(delivery.groupId))
        : offerLedger
      const groupMap = new Map<
        string,
        { name: string; logs: CampaignLog[]; ledger?: ProductGroupDelivery; activeNames: string[] }
      >()
      for (const log of visibleMatches) {
        const entry = groupMap.get(log.groupId) ?? {
          name: log.groupName,
          logs: [],
          activeNames: [],
        }
        entry.logs.push(log)
        groupMap.set(log.groupId, entry)
      }
      for (const delivery of visibleLedger) {
        const entry = groupMap.get(delivery.groupId) ?? {
          name: delivery.groupName,
          logs: [],
          activeNames: [],
        }
        entry.ledger = delivery
        entry.name = delivery.groupName
        groupMap.set(delivery.groupId, entry)
      }
      for (const active of visibleActiveCampaigns) {
        for (const group of active.groups) {
          if (requestedGroupIds && !requestedGroupIds.has(group.id)) continue
          const entry = groupMap.get(group.id) ?? { name: group.name, logs: [], activeNames: [] }
          if (!entry.activeNames.includes(active.name)) entry.activeNames.push(active.name)
          groupMap.set(group.id, entry)
        }
      }
      if (requestedGroupIds) {
        for (const groupId of requestedGroupIds) {
          if (!groupMap.has(groupId))
            groupMap.set(groupId, { name: groupId, logs: [], activeNames: [] })
        }
      }

      const groups: OfferGroupStatus[] = [...groupMap.entries()].map(([groupId, entry]) => {
        const sent =
          entry.ledger?.status === PRODUCT_GROUP_DELIVERY_STATUS.SENT || entry.logs.length > 0
        const sending =
          entry.ledger?.status === PRODUCT_GROUP_DELIVERY_STATUS.SENDING ||
          entry.activeNames.length > 0
        const lastLog = entry.logs[0]
        const sentAt = entry.ledger?.sentAt ?? lastLog?.sentAt ?? null
        const recoverable = Boolean(
          entry.ledger?.status === PRODUCT_GROUP_DELIVERY_STATUS.SENDING &&
          entry.ledger.createdAt.getTime() <= Date.now() - DELIVERY_CLAIM_RECOVERY_MS &&
          entry.ledger.heartbeatAt.getTime() <= Date.now() - DELIVERY_CLAIM_RECOVERY_MS,
        )
        return {
          groupId,
          groupName: entry.name,
          status: sent ? 'sent' : sending ? 'sending' : 'unsent',
          sentCount: Math.max(
            entry.logs.length,
            entry.ledger?.status === PRODUCT_GROUP_DELIVERY_STATUS.SENT ? 1 : 0,
          ),
          lastSentAt: sentAt ? new Date(sentAt).toISOString() : null,
          inActiveCampaign: entry.activeNames.length > 0,
          activeCampaignNames: entry.activeNames,
          claimStatus:
            entry.ledger?.status === PRODUCT_GROUP_DELIVERY_STATUS.SENT
              ? 'sent'
              : entry.ledger?.status === PRODUCT_GROUP_DELIVERY_STATUS.SENDING
                ? recoverable
                  ? 'unconfirmed'
                  : 'sending'
                : null,
          claimCreatedAt: entry.ledger?.createdAt
            ? new Date(entry.ledger.createdAt).toISOString()
            : null,
          claimCampaignId: entry.ledger?.campaignId ?? null,
          recoverable,
        }
      })
      groups.sort((a, b) => a.groupName.localeCompare(b.groupName))

      const sentGroups = groups.filter((group) => group.status === 'sent')
      const sendingGroups = groups.filter((group) => group.status === 'sending')
      const ledgerOnlySentCount = visibleLedger.filter(
        (delivery) =>
          delivery.status === PRODUCT_GROUP_DELIVERY_STATUS.SENT &&
          !visibleMatches.some((log) => log.groupId === delivery.groupId),
      ).length
      const latestSentGroup = sentGroups
        .filter((group) => group.lastSentAt)
        .sort((a, b) => String(b.lastSentAt).localeCompare(String(a.lastSentAt)))[0]
      result[id] = {
        alreadySent: sentGroups.length > 0,
        sentCount: visibleMatches.length + ledgerOnlySentCount,
        lastSentAt: latestSentGroup?.lastSentAt ?? null,
        sampleGroup: latestSentGroup?.groupName ?? sentGroups[0]?.groupName ?? null,
        inActiveCampaign: activeNames.length > 0,
        activeCampaignNames: activeNames,
        groups,
        sentGroupIds: sentGroups.map((group) => group.groupId),
        sendingGroupIds: sendingGroups.map((group) => group.groupId),
        eligibleGroupIds: groups
          .filter((group) => group.status === 'unsent')
          .map((group) => group.groupId),
      }
    }

    return result
  }

  async listForUser(
    userId: number,
    limit = 50,
    offset = 0,
  ): Promise<{ rows: Campaign[]; count: number }> {
    return Campaign.findAndCountAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    })
  }

  async getForUser(userId: number, campaignId: number): Promise<Campaign> {
    const campaign = await Campaign.findOne({ where: { id: campaignId, userId } })
    if (!campaign) throw NotFoundError('Campanha não encontrada')
    return campaign
  }

  async getLogs(userId: number, campaignId: number): Promise<CampaignLog[]> {
    await this.getForUser(userId, campaignId)
    return CampaignLog.findAll({ where: { campaignId }, order: [['sentAt', 'ASC']] })
  }

  /**
   * Resolve a crash-ambiguous SENDING claim after the operator checks WhatsApp.
   * `sent` keeps the pair blocked; `retry` releases it for a future campaign run.
   */
  async resolveDeliveryClaim(userId: number, input: ResolveDeliveryClaimInput) {
    const product = input.savedProductId
      ? await SavedProduct.findOne({ where: { id: input.savedProductId, userId } })
      : null
    if (input.savedProductId && !product) {
      throw BadRequestError('Produto salvo inválido ou não pertence ao usuário')
    }
    const resolvedOffer: CheckOfferInput | null = product
      ? { ...product.offer, savedProductId: product.id }
      : (input.offer ?? null)
    if (!resolvedOffer) throw BadRequestError('Informe o produto salvo ou os dados da oferta')
    const connectionScope = await this.connectionService.getConnectionScope(userId)
    if (!connectionScope) throw BadRequestError('Nenhuma conexão armazenada para este usuário')
    const identities = offerIdentityAliases(resolvedOffer)
    const recoverableBefore = new Date(Date.now() - DELIVERY_CLAIM_RECOVERY_MS)

    return sequelize.transaction(async (transaction) => {
      const delivery = await ProductGroupDelivery.findOne({
        where: {
          userId,
          connectionScope,
          offerIdentity: { [Op.in]: identities },
          groupId: input.groupId,
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
          createdAt: { [Op.lte]: recoverableBefore },
          heartbeatAt: { [Op.lte]: recoverableBefore },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!delivery) {
        throw BadRequestError(
          'O envio ainda pode estar em andamento. Aguarde cinco minutos antes de resolver manualmente.',
        )
      }

      if (delivery.campaignId) {
        await Campaign.update(
          { status: CAMPAIGN_STATUS_ENUM.FAILED },
          {
            where: { id: delivery.campaignId, status: CAMPAIGN_STATUS_ENUM.RUNNING },
            transaction,
          },
        )
      }

      if (input.resolution === 'retry') {
        await delivery.destroy({ transaction })
        return {
          savedProductId: product?.id ?? null,
          groupId: input.groupId,
          status: 'unsent' as const,
        }
      }

      await delivery.update(
        {
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
          sentAt: new Date(),
          heartbeatAt: new Date(),
        },
        { transaction },
      )
      if (delivery.campaignId) {
        const existingLog = await CampaignLog.findOne({
          where: {
            campaignId: delivery.campaignId,
            groupId: delivery.groupId,
            offerIdentity: delivery.offerIdentity,
            success: true,
          },
          transaction,
        })
        if (!existingLog) {
          await CampaignLog.create(
            {
              campaignId: delivery.campaignId,
              connectionScope,
              groupId: delivery.groupId,
              groupName: delivery.groupName,
              offerTitle: delivery.offerTitle,
              offerSource: delivery.offerSource,
              offerIdentity: delivery.offerIdentity,
              offerProductId: delivery.offerProductId,
              offerUrl: delivery.offerUrl,
              success: true,
              messageId: delivery.messageId,
            },
            { transaction },
          )
          const [sent, failed] = await Promise.all([
            CampaignLog.count({
              where: { campaignId: delivery.campaignId, success: true },
              transaction,
            }),
            CampaignLog.count({
              where: { campaignId: delivery.campaignId, success: false },
              transaction,
            }),
          ])
          await Campaign.update(
            { totalSent: sent, totalFailed: failed },
            { where: { id: delivery.campaignId }, transaction },
          )
        }
      }
      return {
        savedProductId: product?.id ?? null,
        groupId: input.groupId,
        status: 'sent' as const,
      }
    })
  }

  async cancel(userId: number, campaignId: number): Promise<Campaign> {
    const campaign = await this.getForUser(userId, campaignId)
    if (
      campaign.status === CAMPAIGN_STATUS_ENUM.COMPLETED ||
      campaign.status === CAMPAIGN_STATUS_ENUM.CANCELLED
    ) {
      throw BadRequestError('Esta campanha não pode mais ser cancelada')
    }
    campaign.status = CAMPAIGN_STATUS_ENUM.CANCELLED
    await campaign.save()
    return campaign
  }

  /** Statuses in which a campaign's content/schedule can be edited. */
  private static readonly EDITABLE = new Set<CAMPAIGN_STATUS_ENUM>([
    CAMPAIGN_STATUS_ENUM.DRAFT,
    CAMPAIGN_STATUS_ENUM.SCHEDULED,
    CAMPAIGN_STATUS_ENUM.PAUSED,
    CAMPAIGN_STATUS_ENUM.FAILED,
  ])

  isEditable(campaign: Campaign): boolean {
    return CampaignService.EDITABLE.has(campaign.status)
  }

  /**
   * Update an editable campaign. Changing scheduledAt moves it between DRAFT
   * (no date) and SCHEDULED (future date). Running/completed/cancelled
   * campaigns cannot be edited.
   */
  async update(
    userId: number,
    campaignId: number,
    input: import('@/dtos/campaign').UpdateCampaignInput,
  ): Promise<Campaign> {
    const campaign = await this.getForUser(userId, campaignId)
    if (!this.isEditable(campaign)) {
      throw BadRequestError('Esta campanha não pode ser editada no estado atual')
    }

    if (input.name !== undefined) campaign.name = input.name
    if (input.offers !== undefined) {
      await this.assertCatalogReferences(userId, input.offers)
      campaign.offers = input.offers
    }
    if (input.groups !== undefined) campaign.groups = input.groups
    if (input.safety !== undefined) campaign.safety = input.safety
    if (input.messageTemplate !== undefined) {
      campaign.messageTemplate = input.messageTemplate?.trim() || null
    }
    if (input.sendImages !== undefined) campaign.sendImages = input.sendImages

    if (input.scheduledAt !== undefined) {
      if (input.scheduledAt === null) {
        campaign.scheduledAt = null
        campaign.status = CAMPAIGN_STATUS_ENUM.DRAFT
      } else {
        const when = new Date(input.scheduledAt)
        if (when.getTime() < Date.now() - 60_000) {
          throw BadRequestError('A data de agendamento está no passado')
        }
        campaign.scheduledAt = when
        campaign.status = CAMPAIGN_STATUS_ENUM.SCHEDULED
      }
    }

    await campaign.save()
    return campaign
  }

  /**
   * Pause a scheduled or running campaign. A scheduled one simply won't fire; a
   * running one aborts its in-flight send loop (the runner polls status).
   */
  async pause(userId: number, campaignId: number): Promise<Campaign> {
    const campaign = await this.getForUser(userId, campaignId)
    if (
      campaign.status !== CAMPAIGN_STATUS_ENUM.SCHEDULED &&
      campaign.status !== CAMPAIGN_STATUS_ENUM.RUNNING
    ) {
      throw BadRequestError('Somente campanhas agendadas ou em execução podem ser pausadas')
    }
    campaign.status = CAMPAIGN_STATUS_ENUM.PAUSED
    await campaign.save()
    return campaign
  }

  /**
   * Resume a paused campaign. If it still has a future scheduledAt it goes back
   * to SCHEDULED (fires at that time); otherwise it starts running now.
   */
  async resume(userId: number, campaignId: number): Promise<Campaign> {
    const campaign = await this.getForUser(userId, campaignId)

    // A RUNNING campaign whose process died (deploy/crash) can be relaunched.
    if (campaign.status === CAMPAIGN_STATUS_ENUM.RUNNING) {
      if (this.isStalledRunning(campaign)) {
        await this.resumeStalledRun(userId, campaignId)
        return this.getForUser(userId, campaignId)
      }
      // Still actively sending in a live process — nothing to do.
      return campaign
    }

    if (campaign.status !== CAMPAIGN_STATUS_ENUM.PAUSED) {
      throw BadRequestError('Somente campanhas pausadas ou travadas podem ser retomadas')
    }
    if (campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now()) {
      campaign.status = CAMPAIGN_STATUS_ENUM.SCHEDULED
      await campaign.save()
      return campaign
    }
    // No future schedule — run now.
    return this.runNow(userId, campaignId)
  }

  /**
   * Run a campaign now (fire-and-forget). Returns immediately after flipping
   * status to RUNNING; the actual paced send proceeds in the background.
   */
  async runNow(userId: number, campaignId: number): Promise<Campaign> {
    const campaign = await this.getForUser(userId, campaignId)
    if (campaign.status === CAMPAIGN_STATUS_ENUM.RUNNING) {
      throw BadRequestError('A campanha já está em execução')
    }
    if (campaign.status === CAMPAIGN_STATUS_ENUM.COMPLETED) {
      throw BadRequestError('A campanha já foi concluída')
    }
    if (campaign.status === CAMPAIGN_STATUS_ENUM.CANCELLED) {
      throw BadRequestError('A campanha foi cancelada')
    }

    await this.assertCatalogReferences(userId, campaign.offers)

    // Validate connection ownership and current group membership before changing
    // campaign state, so invalid targets never reach the provider.
    const context = await this.connectionService.requireConnectedContext(userId)
    const currentGroups = await this.groupService.requireCurrentGroups(
      userId,
      campaign.groups.map((group) => group.id),
    )
    const confirmedContext = await this.connectionService.requireConnectedContext(userId)
    if (confirmedContext.scope !== context.scope) {
      throw BadRequestError('A conexão mudou durante a validação. Tente enviar novamente.')
    }
    const groups = campaign.groups.map((group) => ({
      id: group.id,
      name: currentGroups.get(group.id)?.name ?? group.name,
    }))

    const [started] = await Campaign.update(
      {
        status: CAMPAIGN_STATUS_ENUM.RUNNING,
        startedAt: new Date(),
        heartbeatAt: new Date(),
        completedAt: null,
        totalSkipped: 0,
        groups,
      },
      { where: { id: campaign.id, userId, status: campaign.status } },
    )
    if (started !== 1) throw BadRequestError('A campanha já foi iniciada por outro processo')
    const running = await this.getForUser(userId, campaignId)

    // Fire and forget — do not await.
    void this.execute(userId, running, context).catch(async (error) => {
      try {
        await this.refreshCampaignCounters(running.id)
        await Campaign.update(
          { status: CAMPAIGN_STATUS_ENUM.FAILED },
          { where: { id: running.id, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
        )
      } catch (recoveryError) {
        logger.error(
          { recoveryError, campaignId: running.id },
          'Failed to persist campaign failure',
        )
      }
      logger.error({ error, campaignId: running.id }, 'Campaign execution failed')
    })

    return running
  }

  /** A RUNNING campaign is stalled when its heartbeat is stale (no live loop). */
  private isStalledRunning(campaign: Campaign): boolean {
    if (campaign.status !== CAMPAIGN_STATUS_ENUM.RUNNING) return false
    const last = campaign.heartbeatAt ?? campaign.startedAt
    if (!last) return true
    return last.getTime() <= Date.now() - computeStallMs(campaign.safety)
  }

  /**
   * Re-launch the send loop for a RUNNING campaign whose previous process died
   * (deploy/crash). Atomically claims ownership by bumping the heartbeat only
   * if it is still stale, so two processes never resume the same campaign. The
   * ledger makes execute() skip every pair already sent, so it continues from
   * where it stopped. Returns true if this process took ownership.
   */
  private async resumeStalledRun(userId: number, campaignId: number): Promise<boolean> {
    const campaign = await Campaign.findOne({ where: { id: campaignId, userId } })
    if (!campaign || !this.isStalledRunning(campaign)) return false

    // Validate the connection before touching the provider.
    let context: ConnectedContext
    try {
      context = await this.connectionService.requireConnectedContext(userId)
    } catch (error) {
      logger.warn({ error, campaignId }, 'Cannot resume campaign: connection not ready')
      await Campaign.update(
        { status: CAMPAIGN_STATUS_ENUM.FAILED },
        { where: { id: campaignId, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
      )
      return false
    }

    // Atomic claim: only proceed if the heartbeat is still stale.
    const staleBefore = new Date(Date.now() - computeStallMs(campaign.safety))
    const [claimed] = await Campaign.update(
      { heartbeatAt: new Date() },
      {
        where: {
          id: campaignId,
          status: CAMPAIGN_STATUS_ENUM.RUNNING,
          [Op.or]: [{ heartbeatAt: { [Op.lte]: staleBefore } }, { heartbeatAt: null }],
        },
      },
    )
    if (claimed !== 1) return false // another process resumed it first

    const running = await this.getForUser(userId, campaignId)
    logger.info({ campaignId }, 'Resuming stalled campaign')
    void this.execute(userId, running, context).catch(async (error) => {
      try {
        await this.refreshCampaignCounters(running.id)
        await Campaign.update(
          { status: CAMPAIGN_STATUS_ENUM.FAILED },
          { where: { id: running.id, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
        )
      } catch (recoveryError) {
        logger.error({ recoveryError, campaignId: running.id }, 'Failed to persist campaign failure')
      }
      logger.error({ error, campaignId: running.id }, 'Resumed campaign execution failed')
    })
    return true
  }

  /** The actual paced execution. Persists a log row per send and updates counters. */
  private async execute(
    userId: number,
    campaign: Campaign,
    context: ConnectedContext,
  ): Promise<void> {
    const allTasks = buildTasks(campaign.offers, campaign.groups, campaign.safety)
    await this.reconcileSuccessfulHistory(userId, context.scope, allTasks)
    const existingDeliveries = await ProductGroupDelivery.findAll({
      where: {
        userId,
        connectionScope: context.scope,
        offerIdentity: {
          [Op.in]: [...new Set(allTasks.flatMap((task) => offerIdentityAliases(task.offer)))],
        },
        groupId: { [Op.in]: [...new Set(allTasks.map((task) => task.group.id))] },
      },
      attributes: ['offerIdentity', 'groupId'],
    })
    const existingPairs = new Set(
      existingDeliveries.map((delivery) => `${delivery.offerIdentity}\u0000${delivery.groupId}`),
    )
    const tasks = allTasks.filter(
      (task) =>
        !offerIdentityAliases(task.offer).some((identity) =>
          existingPairs.has(`${identity}\u0000${task.group.id}`),
        ),
    )
    let skipped = allTasks.length - tasks.length
    if (skipped) await Campaign.update({ totalSkipped: skipped }, { where: { id: campaign.id } })
    const sender = new SafeSender(
      this.uazapi,
      context.creds,
      campaign.safety,
      campaign.messageTemplate,
      campaign.sendImages,
    )

    const claims = new Map<string, ProductGroupDelivery>()
    const stopHeartbeats = new Map<string, () => void>()
    let connectionChanged = false

    // Campaign-level heartbeat: proves a live process owns this RUNNING campaign,
    // even during inter-message delays. The scheduler resumes campaigns whose
    // heartbeat has gone stale (killed by a deploy/crash).
    await Campaign.update({ heartbeatAt: new Date() }, { where: { id: campaign.id } })
    const campaignHeartbeat = setInterval(() => {
      void Campaign.update(
        { heartbeatAt: new Date() },
        { where: { id: campaign.id, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
      ).catch(() => {})
    }, CAMPAIGN_HEARTBEAT_MS)

    try {
      await sender.run(
        tasks,
        async (result) => {
          const identity = offerIdentity(result.offer)
          const claimKey = `${identity}\u0000${result.group.id}`
          const claim = claims.get(claimKey)
          stopHeartbeats.get(claimKey)?.()
          stopHeartbeats.delete(claimKey)
          claims.delete(claimKey)
          if (!claim) {
            logger.error(
              { campaignId: campaign.id, groupId: result.group.id, offerIdentity: identity },
              'Provider result has no delivery claim',
            )
            return
          }

          const settlement = await this.settleDeliveryClaim(claim, result)
          if (settlement === 'fenced') {
            logger.warn(
              { campaignId: campaign.id, claimId: claim.id },
              'Ignoring failed provider result after delivery claim ownership changed',
            )
            return
          }
          await CampaignLog.create({
            campaignId: campaign.id,
            connectionScope: context.scope,
            groupId: result.group.id,
            groupName: result.group.name,
            offerTitle: result.offer.title,
            offerSource: result.offer.source?.trim().toLowerCase() || null,
            offerIdentity: identity,
            offerProductId: result.offer.productId ?? null,
            offerUrl: result.offer.affiliateUrl ?? null,
            success: result.success,
            messageId: result.messageId ?? null,
            error:
              settlement === 'reconciled'
                ? 'Confirmação tardia recebida após mudança de posse; envio bloqueado por segurança.'
                : (result.error ?? null),
          })
          await this.refreshCampaignCounters(campaign.id)
        },
        // Abort if the campaign was cancelled or paused mid-run.
        async () => {
          const fresh = await Campaign.findByPk(campaign.id, { attributes: ['status'] })
          if (
            fresh?.status === CAMPAIGN_STATUS_ENUM.CANCELLED ||
            fresh?.status === CAMPAIGN_STATUS_ENUM.PAUSED ||
            fresh?.status === CAMPAIGN_STATUS_ENUM.FAILED
          )
            return true
          try {
            const currentContext = await this.connectionService.requireConnectedContext(userId)
            connectionChanged = currentContext.scope !== context.scope
          } catch {
            connectionChanged = true
          }
          return connectionChanged
        },
        async (task) => {
          const claim = await this.claimDelivery(
            userId,
            context.scope,
            campaign.id,
            task.offer,
            task.group,
          )
          if (!claim) {
            skipped++
            await Campaign.update({ totalSkipped: skipped }, { where: { id: campaign.id } })
            return false
          }
          const claimKey = `${claim.offerIdentity}\u0000${claim.groupId}`
          claims.set(claimKey, claim)
          stopHeartbeats.set(claimKey, this.startDeliveryClaimHeartbeat(claim))
          return true
        },
      )
    } catch (error) {
      await this.refreshCampaignCounters(campaign.id)
      await Campaign.update(
        { status: CAMPAIGN_STATUS_ENUM.FAILED },
        { where: { id: campaign.id, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
      )
      throw error
    } finally {
      clearInterval(campaignHeartbeat)
      for (const stop of stopHeartbeats.values()) stop()
      stopHeartbeats.clear()
    }

    const freshStatus = (await Campaign.findByPk(campaign.id, { attributes: ['status'] }))?.status
    const stoppedByUser =
      freshStatus === CAMPAIGN_STATUS_ENUM.CANCELLED || freshStatus === CAMPAIGN_STATUS_ENUM.PAUSED

    const counters = await this.refreshCampaignCounters(campaign.id)
    if (connectionChanged) {
      await Campaign.update(
        { status: CAMPAIGN_STATUS_ENUM.FAILED },
        { where: { id: campaign.id, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
      )
    } else if (!stoppedByUser) {
      await Campaign.update(
        { status: CAMPAIGN_STATUS_ENUM.COMPLETED, completedAt: new Date() },
        { where: { id: campaign.id, status: CAMPAIGN_STATUS_ENUM.RUNNING } },
      )
    }
    logger.info(
      { campaignId: campaign.id, sent: counters.sent, failed: counters.failed },
      'Campaign finished',
    )
  }

  private async claimDelivery(
    userId: number,
    connectionScope: string,
    campaignId: number,
    offer: CampaignOffer,
    group: CampaignGroup,
  ): Promise<ProductGroupDelivery | null> {
    try {
      return await ProductGroupDelivery.create({
        userId,
        connectionScope,
        offerIdentity: offerIdentity(offer),
        offerSource: offer.source?.trim().toLowerCase() || null,
        offerProductId: offer.productId?.trim() || null,
        offerUrl: offer.affiliateUrl.trim(),
        offerTitle: offer.title,
        groupId: group.id,
        groupName: group.name,
        campaignId,
        status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
        claimToken: randomUUID(),
        heartbeatAt: new Date(),
      })
    } catch (error) {
      if (error instanceof UniqueConstraintError) return null
      throw error
    }
  }

  /** Keep an owned SENDING claim fresh while its provider request is in flight. */
  private startDeliveryClaimHeartbeat(claim: ProductGroupDelivery): () => void {
    let active = true
    let refreshing = false
    const timer = setInterval(() => {
      if (!active || refreshing) return
      refreshing = true
      void ProductGroupDelivery.update(
        { heartbeatAt: new Date() },
        {
          where: {
            id: claim.id,
            status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
            claimToken: claim.claimToken,
          },
        },
      )
        .then(([updated]) => {
          if (updated === 0) stop()
        })
        .catch((error) => {
          logger.warn({ error, claimId: claim.id }, 'Failed to refresh delivery claim heartbeat')
        })
        .finally(() => {
          refreshing = false
        })
    }, DELIVERY_CLAIM_HEARTBEAT_MS)
    timer.unref()

    const stop = (): void => {
      if (!active) return
      active = false
      clearInterval(timer)
    }
    return stop
  }

  /**
   * Finalize only the claim generation that initiated the provider request.
   * A late confirmed success is reconciled to SENT even after ownership changed,
   * because allowing a retry at that point could duplicate a delivered message.
   */
  private async settleDeliveryClaim(
    claim: ProductGroupDelivery,
    result: SendResult,
  ): Promise<'owned' | 'reconciled' | 'fenced'> {
    if (!result.success) {
      const deleted = await ProductGroupDelivery.destroy({
        where: {
          id: claim.id,
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
          claimToken: claim.claimToken,
        },
      })
      return deleted === 1 ? 'owned' : 'fenced'
    }

    const sentAt = new Date()
    const [updated] = await ProductGroupDelivery.update(
      {
        status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
        messageId: result.messageId ?? null,
        sentAt,
        heartbeatAt: sentAt,
      },
      {
        where: {
          id: claim.id,
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENDING,
          claimToken: claim.claimToken,
        },
      },
    )
    if (updated === 1) return 'owned'

    await this.reconcileFencedSuccessfulClaim(claim, result.messageId ?? null, sentAt)
    return 'reconciled'
  }

  private async reconcileFencedSuccessfulClaim(
    claim: ProductGroupDelivery,
    messageId: string | null,
    sentAt: Date,
  ): Promise<void> {
    const pair = {
      userId: claim.userId,
      connectionScope: claim.connectionScope,
      offerIdentity: claim.offerIdentity,
      groupId: claim.groupId,
    }
    const sentValues = {
      campaignId: claim.campaignId,
      groupName: claim.groupName,
      status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
      messageId,
      sentAt,
      heartbeatAt: sentAt,
    }
    const [updated] = await ProductGroupDelivery.update(sentValues, { where: pair })
    if (updated > 0) return

    try {
      await ProductGroupDelivery.create({
        ...pair,
        offerSource: claim.offerSource,
        offerProductId: claim.offerProductId,
        offerUrl: claim.offerUrl,
        offerTitle: claim.offerTitle,
        groupName: claim.groupName,
        campaignId: claim.campaignId,
        status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
        claimToken: randomUUID(),
        heartbeatAt: sentAt,
        messageId,
        sentAt,
      })
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error
      await ProductGroupDelivery.update(sentValues, { where: pair })
    }
  }

  private async assertCatalogReferences(userId: number, offers: CampaignOffer[]): Promise<void> {
    const referencedIds = [
      ...new Set(
        offers.map((offer) => offer.savedProductId).filter((id): id is number => id !== undefined),
      ),
    ]
    if (!referencedIds.length) return
    const products = await SavedProduct.findAll({
      where: { id: { [Op.in]: referencedIds }, userId },
    })
    const byId = new Map(products.map((product) => [product.id, product]))
    for (const offer of offers) {
      if (!offer.savedProductId) continue
      const saved = byId.get(offer.savedProductId)
      if (!saved) throw BadRequestError('Produto salvo inválido ou não pertence ao usuário')
      const unchanged = comparableOffer(saved.offer) === comparableOffer(offer)
      const rating = offer.classificationProfileId
        ? saved.classifications[offer.classificationProfileId]
        : undefined
      const ratedOffer: CampaignOffer = {
        ...saved.offer,
        ...(rating
          ? {
              classificationProfileId: offer.classificationProfileId,
              classificationProfileName: rating.profileName,
            }
          : {}),
      }
      if (rating) {
        for (const field of ['category', 'relevanceScore', 'discountPercent', 'commissionRate'] as const) {
          const value = rating[field]
          if (value === undefined) delete ratedOffer[field]
          else Object.assign(ratedOffer, { [field]: value })
        }
      }
      if (!unchanged && (!rating || comparableOffer(ratedOffer) !== comparableOffer(offer))) {
        throw BadRequestError(
          `O produto salvo #${offer.savedProductId} foi alterado. Atualize a campanha antes de enviar.`,
        )
      }
    }
  }

  /** Seed the ledger from successful logs created before the ledger existed. */
  private async reconcileSuccessfulHistory(
    userId: number,
    connectionScope: string,
    tasks: SendTask[],
  ): Promise<void> {
    if (!tasks.length) return
    const campaigns = await Campaign.findAll({
      where: { userId },
      attributes: ['id', 'offers'],
    })
    if (!campaigns.length) return
    const campaignById = new Map(campaigns.map((item) => [item.id, item]))
    const logs = await CampaignLog.findAll({
      where: {
        campaignId: { [Op.in]: campaigns.map((item) => item.id) },
        success: true,
        groupId: { [Op.in]: [...new Set(tasks.map((task) => task.group.id))] },
      },
    })

    for (const task of tasks) {
      const identity = offerIdentity(task.offer)
      const aliases = offerIdentityAliases(task.offer)
      const log = logs.find((candidate) => {
        if (candidate.groupId !== task.group.id) return false
        if (candidate.connectionScope !== connectionScope) return false
        if (candidate.offerIdentity) return aliases.includes(candidate.offerIdentity)
        const historicalCampaign = campaignById.get(candidate.campaignId)
        return (historicalCampaign?.offers ?? []).some(
          (historicalOffer) =>
            sameOffer(historicalOffer, task.offer) &&
            (!candidate.offerUrl || historicalOffer.affiliateUrl === candidate.offerUrl),
        )
      })
      if (!log) continue
      try {
        await ProductGroupDelivery.create({
          userId,
          connectionScope,
          offerIdentity: identity,
          offerSource: task.offer.source?.trim().toLowerCase() || null,
          offerProductId: task.offer.productId?.trim() || null,
          offerUrl: task.offer.affiliateUrl.trim(),
          offerTitle: task.offer.title,
          groupId: task.group.id,
          groupName: log.groupName || task.group.name,
          campaignId: log.campaignId,
          status: PRODUCT_GROUP_DELIVERY_STATUS.SENT,
          claimToken: randomUUID(),
          heartbeatAt: log.sentAt,
          messageId: log.messageId ?? null,
          sentAt: log.sentAt,
        })
      } catch (error) {
        if (!(error instanceof UniqueConstraintError)) throw error
      }
    }
  }

  private async refreshCampaignCounters(
    campaignId: number,
  ): Promise<{ sent: number; failed: number }> {
    const logs = await CampaignLog.findAll({ where: { campaignId }, attributes: ['success'] })
    const sent = logs.filter((log) => log.success).length
    const failed = logs.length - sent
    await Campaign.update({ totalSent: sent, totalFailed: failed }, { where: { id: campaignId } })
    return { sent, failed }
  }

  /**
   * Called by the scheduler: find due scheduled campaigns and run them.
   * Runs sequentially to avoid hammering the provider.
   */
  async runDueScheduled(): Promise<void> {
    const due = await Campaign.findAll({
      where: { status: CAMPAIGN_STATUS_ENUM.SCHEDULED },
      order: [['scheduledAt', 'ASC']],
      limit: 20,
    })
    const now = Date.now()
    for (const campaign of due) {
      if (!campaign.scheduledAt || campaign.scheduledAt.getTime() > now) continue
      try {
        await this.runNow(campaign.userId, campaign.id)
      } catch (error) {
        logger.warn({ error, campaignId: campaign.id }, 'Failed to start scheduled campaign')
        await Campaign.update(
          { status: CAMPAIGN_STATUS_ENUM.FAILED },
          { where: { id: campaign.id, status: CAMPAIGN_STATUS_ENUM.SCHEDULED } },
        )
      }
    }

    // Self-heal: resume RUNNING campaigns whose loop died (deploy/crash) and
    // whose heartbeat has gone stale. The stall threshold is per-campaign
    // (derived from its interval/pacing), so we cheaply pre-filter by the
    // minimum possible threshold in SQL, then apply the exact check in code.
    const MIN_STALL_FLOOR_MS = 90 * 1000
    const stalledCandidates = await Campaign.findAll({
      where: {
        status: CAMPAIGN_STATUS_ENUM.RUNNING,
        [Op.or]: [
          { heartbeatAt: { [Op.lte]: new Date(now - MIN_STALL_FLOOR_MS) } },
          { heartbeatAt: null },
        ],
      },
      order: [['startedAt', 'ASC']],
      limit: 50,
    })
    for (const campaign of stalledCandidates) {
      if (!this.isStalledRunning(campaign)) continue // still within its quiet window
      try {
        await this.resumeStalledRun(campaign.userId, campaign.id)
      } catch (error) {
        logger.warn({ error, campaignId: campaign.id }, 'Failed to resume stalled campaign')
      }
    }
  }
}
