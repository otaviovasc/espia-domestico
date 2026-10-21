import { Request, Response } from 'express'
import { injectable, inject } from 'tsyringe'
import {
  CreateSmartPlanSchema,
  ResolveSmartSendSchema,
  SmartKeywordsRequestSchema,
  SmartPlanActionSchema,
  SmartPlanRetrySchema,
  UpdateSmartAudienceSchema,
  UpdateSmartPlanSchema,
} from '@/dtos/smartCampaign'
import { UnauthorizedError } from '@/middleware/Error/AppError'
import { SmartCampaignService } from '@/services/SmartCampaignService'

@injectable()
export class SmartCampaignController {
  constructor(@inject(SmartCampaignService) private readonly service: SmartCampaignService) {}

  private userId(request: Request): number {
    if (!request.user) throw UnauthorizedError('Não autenticado')
    return request.user.userId
  }

  async listAudiences(request: Request, response: Response): Promise<void> {
    response.json({ success: true, data: await this.service.listAudiences(this.userId(request)) })
  }

  async aiStatus(request: Request, response: Response): Promise<void> {
    this.userId(request)
    response.json({ success: true, data: this.service.aiStatus() })
  }

  async updateAudience(request: Request, response: Response): Promise<void> {
    const input = UpdateSmartAudienceSchema.parse(request.body ?? {})
    const data = await this.service.updateAudience(
      this.userId(request),
      request.params.slug.toLowerCase(),
      input,
    )
    response.json({ success: true, data })
  }

  async keywords(request: Request, response: Response): Promise<void> {
    const input = SmartKeywordsRequestSchema.parse(request.body ?? {})
    const data = await this.service.keywordPacks(
      this.userId(request),
      input.date,
      input.audienceSlugs,
      input.requestId,
    )
    response.json({ success: true, data })
  }

  async createPlan(request: Request, response: Response): Promise<void> {
    const input = CreateSmartPlanSchema.parse(request.body ?? {})
    const data = await this.service.createPlan(this.userId(request), input)
    response.status(202).json({ success: true, data })
  }

  async listPlans(request: Request, response: Response): Promise<void> {
    response.json({ success: true, data: await this.service.listPlans(this.userId(request)) })
  }

  async getPlan(request: Request, response: Response): Promise<void> {
    response.json({
      success: true,
      data: await this.service.getPlan(this.userId(request), request.params.id),
    })
  }

  async updatePlan(request: Request, response: Response): Promise<void> {
    const input = UpdateSmartPlanSchema.parse(request.body ?? {})
    response.json({
      success: true,
      data: await this.service.updatePlan(this.userId(request), request.params.id, input),
    })
  }

  private actionRevision(request: Request): number {
    return SmartPlanActionSchema.parse(request.body ?? {}).revision
  }

  async approve(request: Request, response: Response): Promise<void> {
    response.json({
      success: true,
      data: await this.service.approve(
        this.userId(request),
        request.params.id,
        this.actionRevision(request),
      ),
    })
  }

  async pause(request: Request, response: Response): Promise<void> {
    response.json({
      success: true,
      data: await this.service.pause(
        this.userId(request),
        request.params.id,
        this.actionRevision(request),
      ),
    })
  }

  async advance(request: Request, response: Response): Promise<void> {
    response.json({ success: true, data: await this.service.advance(
      this.userId(request), request.params.id, this.actionRevision(request),
    ) })
  }

  async shuffle(request: Request, response: Response): Promise<void> {
    response.json({ success: true, data: await this.service.shuffle(
      this.userId(request), request.params.id, this.actionRevision(request),
    ) })
  }

  async resume(request: Request, response: Response): Promise<void> {
    response.json({
      success: true,
      data: await this.service.resume(
        this.userId(request),
        request.params.id,
        this.actionRevision(request),
      ),
    })
  }

  async cancel(request: Request, response: Response): Promise<void> {
    response.json({
      success: true,
      data: await this.service.cancel(
        this.userId(request),
        request.params.id,
        this.actionRevision(request),
      ),
    })
  }

  async retry(request: Request, response: Response): Promise<void> {
    const input = SmartPlanRetrySchema.parse(request.body ?? {})
    response.status(202).json({
      success: true,
      data: await this.service.retryAnalysis(
        this.userId(request),
        request.params.id,
        input.revision,
        input.requestId,
      ),
    })
  }

  async resolveSend(request: Request, response: Response): Promise<void> {
    const input = ResolveSmartSendSchema.parse(request.body ?? {})
    response.json({
      success: true,
      data: await this.service.resolveUnknown(
        this.userId(request),
        request.params.id,
        input.resolution,
      ),
    })
  }
}
