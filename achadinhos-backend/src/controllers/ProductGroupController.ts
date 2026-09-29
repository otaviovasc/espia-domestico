import type { Request, Response } from 'express'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'
import { BadRequestError, UnauthorizedError } from '@/middleware/Error/AppError'
import { ProductGroupService } from '@/services/ProductGroupService'

const NameSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict()
function positiveId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw BadRequestError('ID inválido')
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw BadRequestError('ID inválido')
  return id
}

@injectable()
export class ProductGroupController {
  constructor(@inject(ProductGroupService) private service: ProductGroupService) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  async list(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await this.service.list(this.userId(req)) })
  }

  async create(req: Request, res: Response): Promise<void> {
    const { name } = NameSchema.parse(req.body)
    res.status(201).json({ success: true, data: await this.service.create(this.userId(req), name) })
  }

  async update(req: Request, res: Response): Promise<void> {
    const { name } = NameSchema.parse(req.body)
    res.json({
      success: true,
      data: await this.service.update(this.userId(req), positiveId(req.params.id), name),
    })
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = positiveId(req.params.id)
    await this.service.remove(this.userId(req), id)
    res.json({ success: true, data: { id } })
  }
}
