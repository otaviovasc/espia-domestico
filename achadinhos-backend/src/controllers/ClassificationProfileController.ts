import type { Request, Response } from 'express'
import { inject, injectable } from 'tsyringe'
import {
  ClassificationProfileIdSchema,
  ClassificationProfileInputSchema,
} from '@/dtos/classificationProfile'
import { BadRequestError, UnauthorizedError } from '@/middleware/Error/AppError'
import { ClassificationProfileService } from '@/services/ClassificationProfileService'

@injectable()
export class ClassificationProfileController {
  constructor(
    @inject(ClassificationProfileService) private service: ClassificationProfileService,
  ) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  private id(req: Request): string {
    const parsed = ClassificationProfileIdSchema.safeParse(req.params.id)
    if (!parsed.success) {
      throw BadRequestError('ID de perfil inválido')
    }
    return parsed.data
  }

  async list(req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: await this.service.list(this.userId(req)) })
  }

  async create(req: Request, res: Response): Promise<void> {
    const input = ClassificationProfileInputSchema.parse(req.body)
    res
      .status(201)
      .json({ success: true, data: await this.service.create(this.userId(req), input) })
  }

  async update(req: Request, res: Response): Promise<void> {
    const input = ClassificationProfileInputSchema.parse(req.body)
    res.json({
      success: true,
      data: await this.service.update(this.userId(req), this.id(req), input),
    })
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = this.id(req)
    await this.service.remove(this.userId(req), id)
    res.json({ success: true, data: { id } })
  }
}
