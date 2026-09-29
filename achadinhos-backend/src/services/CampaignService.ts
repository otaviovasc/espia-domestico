import { injectable, inject } from 'tsyringe'
import { Op } from 'sequelize'
import { Campaign, CAMPAIGN_STATUS_ENUM } from '@/database/models/Campaign'
import { CampaignLog } from '@/database/models/CampaignLog'
import { UazapiClient } from '@/channels/uazapi/UazapiClient'
import { ConnectionService } from '@/services/ConnectionService'
import { SafeSender, buildTasks } from '@/services/SafeSender'
import { CreateCampaignInput } from '@/dtos/campaign'
import { BadRequestError, NotFoundError } from '@/middleware/Error/AppError'
import { logger } from '@/utils/logger'

@injectable()
export class CampaignService {
  constructor(
    @inject(UazapiClient) private uazapi: UazapiClient,
    @inject(ConnectionService) private connectionService: ConnectionService,
  ) {}

  async create(userId: number, input: CreateCampaignInput): Promise<Campaign> {
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
      throw BadRequestError('A data de agendamento está no passado')
    }
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
   * running) campaign. Identity is productId first, then affiliateUrl.
   *
   * Returns a map keyed by the offer's identity so the UI can annotate rows.
   */
  async checkOffers(
    userId: number,
    offers: { productId?: string; affiliateUrl: string }[],
  ): Promise<
    Record<
      string,
      {
        alreadySent: boolean
        sentCount: number
        lastSentAt: string | null
        sampleGroup: string | null
        inActiveCampaign: boolean
        activeCampaignNames: string[]
      }
    >
  > {
    const identityOf = (o: { productId?: string; affiliateUrl: string }) =>
      o.productId?.trim() || o.affiliateUrl.trim()

    const productIds = offers.map((o) => o.productId?.trim()).filter((v): v is string => !!v)
    const urls = offers.map((o) => o.affiliateUrl.trim()).filter(Boolean)

    // 1) Sent history from successful campaign logs of THIS user's campaigns.
    const userCampaigns = await Campaign.findAll({
      where: { userId },
      attributes: ['id', 'name', 'status', 'offers'],
    })
    const userCampaignIds = userCampaigns.map((c) => c.id)

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
        attributes: ['offerProductId', 'offerUrl', 'groupName', 'sentAt'],
        order: [['sentAt', 'DESC']],
      })
    })()

    // 2) Active (scheduled/running) campaigns that contain each identity.
    const activeCampaigns = userCampaigns.filter(
      (c) =>
        c.status === CAMPAIGN_STATUS_ENUM.SCHEDULED ||
        c.status === CAMPAIGN_STATUS_ENUM.RUNNING,
    )

    const result: Record<
      string,
      {
        alreadySent: boolean
        sentCount: number
        lastSentAt: string | null
        sampleGroup: string | null
        inActiveCampaign: boolean
        activeCampaignNames: string[]
      }
    > = {}

    for (const offer of offers) {
      const id = identityOf(offer)
      const pid = offer.productId?.trim()
      const url = offer.affiliateUrl.trim()

      const matches = logs.filter(
        (l) => (pid && l.offerProductId === pid) || (l.offerUrl && l.offerUrl === url),
      )
      const activeNames = activeCampaigns
        .filter((c) =>
          (c.offers as { productId?: string; affiliateUrl?: string }[]).some(
            (o) => (pid && o.productId === pid) || o.affiliateUrl === url,
          ),
        )
        .map((c) => c.name)

      result[id] = {
        alreadySent: matches.length > 0,
        sentCount: matches.length,
        lastSentAt: matches[0]?.sentAt ? new Date(matches[0].sentAt).toISOString() : null,
        sampleGroup: matches[0]?.groupName ?? null,
        inActiveCampaign: activeNames.length > 0,
        activeCampaignNames: activeNames,
      }
    }

    return result
  }

  async listForUser(userId: number, limit = 50, offset = 0): Promise<{ rows: Campaign[]; count: number }> {
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
    if (input.offers !== undefined) campaign.offers = input.offers
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
    if (campaign.status !== CAMPAIGN_STATUS_ENUM.PAUSED) {
      throw BadRequestError('Somente campanhas pausadas podem ser retomadas')
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
    // Validate the user's connection up front so the error surfaces to the caller.
    await this.connectionService.requireConnectedCreds(userId)

    campaign.status = CAMPAIGN_STATUS_ENUM.RUNNING
    campaign.startedAt = new Date()
    campaign.totalSent = 0
    campaign.totalFailed = 0
    await campaign.save()

    // Fire and forget — do not await.
    void this.execute(userId, campaign).catch((error) => {
      logger.error({ error, campaignId: campaign.id }, 'Campaign execution failed')
    })

    return campaign
  }

  /** The actual paced execution. Persists a log row per send and updates counters. */
  private async execute(userId: number, campaign: Campaign): Promise<void> {
    let creds
    try {
      creds = await this.connectionService.requireConnectedCreds(userId)
    } catch (error) {
      campaign.status = CAMPAIGN_STATUS_ENUM.FAILED
      await campaign.save()
      logger.warn({ error, campaignId: campaign.id }, 'Campaign aborted: connection not ready')
      return
    }

    const tasks = buildTasks(campaign.offers, campaign.groups, campaign.safety)
    const sender = new SafeSender(
      this.uazapi,
      creds,
      campaign.safety,
      campaign.messageTemplate,
      campaign.sendImages,
    )

    let sent = 0
    let failed = 0

    const results = await sender.run(
      tasks,
      async (result) => {
        if (result.success) sent++
        else failed++
        await CampaignLog.create({
          campaignId: campaign.id,
          groupId: result.group.id,
          groupName: result.group.name,
          offerTitle: result.offer.title,
          offerProductId: result.offer.productId ?? null,
          offerUrl: result.offer.affiliateUrl ?? null,
          success: result.success,
          messageId: result.messageId ?? null,
          error: result.error ?? null,
        })
        // Periodically flush counters.
        campaign.totalSent = sent
        campaign.totalFailed = failed
        await campaign.save()
      },
      // Abort if the campaign was cancelled or paused mid-run.
      async () => {
        const fresh = await Campaign.findByPk(campaign.id, { attributes: ['status'] })
        return (
          fresh?.status === CAMPAIGN_STATUS_ENUM.CANCELLED ||
          fresh?.status === CAMPAIGN_STATUS_ENUM.PAUSED
        )
      },
    )

    const freshStatus = (await Campaign.findByPk(campaign.id, { attributes: ['status'] }))?.status
    const stoppedByUser =
      freshStatus === CAMPAIGN_STATUS_ENUM.CANCELLED ||
      freshStatus === CAMPAIGN_STATUS_ENUM.PAUSED

    campaign.totalSent = results.filter((r) => r.success).length
    campaign.totalFailed = results.filter((r) => !r.success).length
    campaign.completedAt = new Date()
    if (!stoppedByUser) {
      campaign.status = CAMPAIGN_STATUS_ENUM.COMPLETED
    }
    await campaign.save()
    logger.info(
      { campaignId: campaign.id, sent: campaign.totalSent, failed: campaign.totalFailed },
      'Campaign finished',
    )
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
        campaign.status = CAMPAIGN_STATUS_ENUM.FAILED
        await campaign.save()
      }
    }
  }
}
