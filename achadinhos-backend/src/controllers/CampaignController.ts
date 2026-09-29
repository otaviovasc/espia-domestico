import { Request, Response } from 'express'
import { injectable, inject } from 'tsyringe'
import { z } from 'zod'
import { CampaignService } from '@/services/CampaignService'
import { computeStallMs } from '@/services/SafeSender'
import { OfferImportService } from '@/services/OfferImportService'
import { CreateCampaignSchema, UpdateCampaignSchema, OfferSchema } from '@/dtos/campaign'
import {
  renderOfferMessage,
  DEFAULT_TEMPLATE,
  TEMPLATE_PLACEHOLDERS,
} from '@/utils/messageTemplate'
import { listIngestors } from '@/ingestors/registry'
import { Campaign } from '@/database/models/Campaign'
import { BadRequestError, UnauthorizedError } from '@/middleware/Error/AppError'
import { AppError } from '@/middleware/Error/AppError'
import { categorizeOffers, OfferCategorizationService } from '@/services/OfferCategorizationService'
import { logger } from '@/utils/logger'
import { ClassificationProfileService } from '@/services/ClassificationProfileService'
import { ClassificationProfileIdSchema } from '@/dtos/classificationProfile'

const ImportSchema = z.object({
  // Either a JSON string or an already-parsed array/object.
  json: z.union([z.string(), z.array(z.unknown()), z.record(z.unknown())]),
  // Optional explicit marketplace id (e.g. 'mercadolivre'); auto-detected if omitted.
  source: z.string().max(40).optional(),
  classificationProfileId: ClassificationProfileIdSchema.default('default'),
})

function serializeCampaign(c: Campaign) {
  const editable =
    c.status === 'DRAFT' ||
    c.status === 'SCHEDULED' ||
    c.status === 'PAUSED' ||
    c.status === 'FAILED'
  // A RUNNING campaign whose heartbeat is stale has no live process (a
  // deploy/crash killed its loop); the UI can offer "Resume" to relaunch it.
  // The threshold is derived from the campaign's own pacing so long-interval
  // campaigns are never wrongly flagged during their normal quiet time.
  const lastBeat = c.heartbeatAt ?? c.startedAt
  const stalled =
    c.status === 'RUNNING' &&
    (!lastBeat || lastBeat.getTime() <= Date.now() - computeStallMs(c.safety))
  return {
    id: c.id,
    uuid: c.uuid,
    name: c.name,
    offers: c.offers,
    groups: c.groups,
    safety: c.safety,
    messageTemplate: c.messageTemplate,
    sendImages: c.sendImages,
    status: c.status,
    scheduledAt: c.scheduledAt,
    startedAt: c.startedAt,
    heartbeatAt: c.heartbeatAt,
    completedAt: c.completedAt,
    totalSent: c.totalSent,
    totalFailed: c.totalFailed,
    totalSkipped: c.totalSkipped,
    createdAt: c.createdAt,
    editable,
    stalled,
  }
}

@injectable()
export class CampaignController {
  constructor(
    @inject(CampaignService) private campaignService: CampaignService,
    @inject(OfferImportService) private offerImportService: OfferImportService,
    @inject(ClassificationProfileService)
    private classificationProfileService: ClassificationProfileService,
    @inject(OfferCategorizationService)
    private offerCategorizationService: OfferCategorizationService,
  ) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  /** GET /campaigns/meta — ingestors, placeholders, default template for the UI. */
  async meta(_req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: {
        ingestors: listIngestors(),
        placeholders: TEMPLATE_PLACEHOLDERS,
        defaultTemplate: DEFAULT_TEMPLATE,
      },
    })
  }

  /** POST /campaigns/import-offers — parse+validate a product batch (ingestor or generic). */
  async importOffers(req: Request, res: Response): Promise<void> {
    const userId = this.userId(req)
    const parsed = ImportSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((error) => error.message).join(', '))
    }
    const profile = await this.classificationProfileService.getForUser(
      userId,
      parsed.data.classificationProfileId,
    )
    const result = this.offerImportService.parse(parsed.data.json, parsed.data.source)
    let categorized: Awaited<ReturnType<typeof categorizeOffers>>
    try {
      categorized = await this.offerCategorizationService.categorize(result.offers, profile)
    } catch (error) {
      if (error instanceof AppError) throw error
      logger.warn(
        { errorName: error instanceof Error ? error.name : 'Unknown' },
        'Jev categorization failed',
      )
      throw new AppError(
        'Não foi possível categorizar os produtos agora. Tente importar novamente.',
        502,
        'CATEGORIZATION_FAILED',
      )
    }
    const template = typeof req.body?.template === 'string' ? req.body.template : undefined
    res.json({
      success: true,
      data: {
        source: result.source,
        totalSeen: result.totalSeen,
        offers: categorized.offers,
        errors: result.errors,
        categorization: {
          method: 'jev',
          counts: categorized.counts,
          profile: { id: profile.id, name: profile.name },
        },
        previews: categorized.offers.map((offer) => ({
          title: offer.title,
          message: renderOfferMessage(offer, template),
        })),
      },
    })
  }

  /** POST /campaigns/preview — preview formatted messages for offers + optional template. */
  async preview(req: Request, res: Response): Promise<void> {
    this.userId(req)
    const schema = z.object({
      offers: z.array(OfferSchema).min(1),
      template: z.string().max(4000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    res.json({
      success: true,
      data: parsed.data.offers.map((offer) => ({
        title: offer.title,
        message: renderOfferMessage(offer, parsed.data.template),
      })),
    })
  }

  /** POST /campaigns/check-offers — flag offers already sent / in active campaigns. */
  async checkOffers(req: Request, res: Response): Promise<void> {
    const userId = this.userId(req)
    const schema = z.object({
      offers: z
        .array(
          z.object({
            savedProductId: z.number().int().positive().optional(),
            source: z.string().max(40).optional(),
            productId: z.string().max(60).optional(),
            affiliateUrl: z.string().url(),
          }),
        )
        .min(1),
      groupIds: z.array(z.string().endsWith('@g.us')).max(5000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const flags = await this.campaignService.checkOffers(
      userId,
      parsed.data.offers,
      parsed.data.groupIds,
    )
    res.json({ success: true, data: flags })
  }

  /** POST /campaigns/delivery-claims/resolve — operator resolves an ambiguous send. */
  async resolveDeliveryClaim(req: Request, res: Response): Promise<void> {
    const parsed = z
      .object({
        savedProductId: z.number().int().positive().optional(),
        offer: z
          .object({
            source: z.string().max(40).optional(),
            productId: z.string().max(60).optional(),
            affiliateUrl: z.string().url(),
          })
          .optional(),
        groupId: z.string().endsWith('@g.us'),
        resolution: z.enum(['sent', 'retry']),
      })
      .strict()
      .refine((value) => Boolean(value.savedProductId || value.offer), {
        message: 'Informe savedProductId ou offer',
      })
      .safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((error) => error.message).join(', '))
    }
    const result = await this.campaignService.resolveDeliveryClaim(this.userId(req), parsed.data)
    res.json({ success: true, data: result })
  }

  /** POST /campaigns — create a campaign (draft or scheduled). */
  async create(req: Request, res: Response): Promise<void> {
    const parsed = CreateCampaignSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const campaign = await this.campaignService.create(this.userId(req), parsed.data)
    res.status(201).json({ success: true, data: serializeCampaign(campaign) })
  }

  /** POST /campaigns/:id/run — start sending now. */
  async run(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const campaign = await this.campaignService.runNow(this.userId(req), id)
    res.json({ success: true, data: serializeCampaign(campaign) })
  }

  /** GET /campaigns */
  async list(req: Request, res: Response): Promise<void> {
    const limit = req.query.limit ? Number(req.query.limit) : 50
    const offset = req.query.offset ? Number(req.query.offset) : 0
    const { rows, count } = await this.campaignService.listForUser(this.userId(req), limit, offset)
    res.json({ success: true, data: rows.map(serializeCampaign), total: count })
  }

  /** GET /campaigns/:id */
  async get(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const campaign = await this.campaignService.getForUser(this.userId(req), id)
    res.json({ success: true, data: serializeCampaign(campaign) })
  }

  /** PATCH /campaigns/:id — edit an editable campaign. */
  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const parsed = UpdateCampaignSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const campaign = await this.campaignService.update(this.userId(req), id, parsed.data)
    res.json({ success: true, data: serializeCampaign(campaign) })
  }

  /** POST /campaigns/:id/pause */
  async pause(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const campaign = await this.campaignService.pause(this.userId(req), id)
    res.json({ success: true, data: serializeCampaign(campaign) })
  }

  /** POST /campaigns/:id/resume */
  async resume(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const campaign = await this.campaignService.resume(this.userId(req), id)
    res.json({ success: true, data: serializeCampaign(campaign) })
  }

  /** GET /campaigns/:id/logs */
  async logs(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const logs = await this.campaignService.getLogs(this.userId(req), id)
    res.json({ success: true, data: logs })
  }

  /** POST /campaigns/:id/cancel */
  async cancel(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw BadRequestError('ID inválido')
    const campaign = await this.campaignService.cancel(this.userId(req), id)
    res.json({ success: true, data: serializeCampaign(campaign) })
  }
}
