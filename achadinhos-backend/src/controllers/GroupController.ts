import { Request, Response } from 'express'
import { injectable, inject } from 'tsyringe'
import { z } from 'zod'
import { GroupService } from '@/services/GroupService'
import { GroupMessageService } from '@/services/GroupMessageService'
import { UnauthorizedError, BadRequestError } from '@/middleware/Error/AppError'

const SendMessageSchema = z
  .object({
    text: z.string().min(1).max(4000).optional(),
    offer: z.unknown().optional(),
    sendImage: z.boolean().optional(),
    template: z.string().max(4000).nullable().optional(),
  })
  .refine((d) => Boolean(d.text) || Boolean(d.offer), {
    message: 'Informe um texto ou uma oferta para enviar',
  })

@injectable()
export class GroupController {
  constructor(
    @inject(GroupService) private groupService: GroupService,
    @inject(GroupMessageService) private groupMessageService: GroupMessageService,
  ) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  /** GET /groups?search= — list groups from the connected number. */
  async list(req: Request, res: Response): Promise<void> {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const groups = await this.groupService.listForUser(this.userId(req), search)
    res.json({ success: true, data: groups })
  }

  /** GET /groups/:groupId/messages — stored messages for a group thread. */
  async listMessages(req: Request, res: Response): Promise<void> {
    const groupId = req.params.groupId
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const before = typeof req.query.before === 'string' ? req.query.before : undefined
    const messages = await this.groupMessageService.listMessages(this.userId(req), groupId, {
      limit: Number.isFinite(limit) ? limit : undefined,
      before,
    })
    res.json({ success: true, data: messages })
  }

  /** POST /groups/:groupId/messages — send text or a hand-picked offer. */
  async sendMessage(req: Request, res: Response): Promise<void> {
    const groupId = req.params.groupId
    const parsed = SendMessageSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const userId = this.userId(req)
    const { text, offer, sendImage, template } = parsed.data
    const message = offer
      ? await this.groupMessageService.sendOffer(userId, groupId, offer, { sendImage, template })
      : await this.groupMessageService.sendText(userId, groupId, text as string)
    res.json({ success: true, data: message })
  }
}
