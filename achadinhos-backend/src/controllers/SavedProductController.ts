import { Request, Response } from 'express'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'
import { OfferSchema } from '@/dtos/campaign'
import { ClassificationProfileIdSchema } from '@/dtos/classificationProfile'
import {
  SavedProductMembershipUpdateSchema,
  SavedProductOfferPatchSchema,
} from '@/dtos/savedProduct'
import { BadRequestError, NotFoundError, UnauthorizedError } from '@/middleware/Error/AppError'
import { SavedProductService } from '@/services/SavedProductService'
import { ProductGroupService } from '@/services/ProductGroupService'

const SaveSchema = z.object({
  offers: z
    .array(
      OfferSchema.extend({
        category: z.enum(['A', 'B', 'C', 'D']),
        affiliateUrl: z.string().url().max(2048),
      }),
    )
    .min(1)
    .max(500),
})

function pagination(value: unknown, defaultValue: number, max: number): number {
  if (value === undefined) return defaultValue
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw BadRequestError('Paginação inválida')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > max) throw BadRequestError('Paginação inválida')
  return parsed
}

@injectable()
export class SavedProductController {
  constructor(
    @inject(SavedProductService) private service: SavedProductService,
    @inject(ProductGroupService) private productGroupService: ProductGroupService,
  ) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  async save(req: Request, res: Response): Promise<void> {
    const parsed = SaveSchema.parse(req.body)
    const result = await this.service.save(this.userId(req), parsed.offers)
    res.json({ success: true, data: result })
  }

  async list(req: Request, res: Response): Promise<void> {
    const limit = pagination(req.query.limit, 100, 100)
    if (limit < 1) throw BadRequestError('Paginação inválida')
    const offset = pagination(req.query.offset, 0, Number.MAX_SAFE_INTEGER)
    const groupId =
      req.query.groupId === undefined
        ? undefined
        : pagination(req.query.groupId, 0, Number.MAX_SAFE_INTEGER)
    if (groupId !== undefined && groupId < 1) throw BadRequestError('ID de grupo inválido')
    const result = await this.service.list(this.userId(req), limit, offset, groupId)
    res.json({ success: true, data: result })
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) throw BadRequestError('ID inválido')
    const parsed = z
      .object({
        offer: SavedProductOfferPatchSchema,
        classificationProfileId: ClassificationProfileIdSchema.optional(),
      })
      .strict()
      .parse(req.body)
    const result = await this.service.update(
      this.userId(req),
      id,
      parsed.offer,
      parsed.classificationProfileId,
    )
    res.json({ success: true, data: result })
  }

  async updateGroups(req: Request, res: Response): Promise<void> {
    const input = SavedProductMembershipUpdateSchema.parse(req.body)
    const result = await this.productGroupService.updateMemberships(
      this.userId(req),
      input.productIds,
      input.groupIds,
      input.mode,
    )
    res.json({ success: true, data: result })
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) throw BadRequestError('ID inválido')
    if (!(await this.service.remove(this.userId(req), id))) {
      throw NotFoundError('Produto salvo não encontrado')
    }
    res.json({ success: true, data: { id } })
  }
}
