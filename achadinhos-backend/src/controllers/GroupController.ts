import { Request, Response } from 'express'
import { injectable, inject } from 'tsyringe'
import { GroupService } from '@/services/GroupService'
import { UnauthorizedError } from '@/middleware/Error/AppError'

@injectable()
export class GroupController {
  constructor(@inject(GroupService) private groupService: GroupService) {}

  /** GET /groups?search= — list groups from the connected number. */
  async list(req: Request, res: Response): Promise<void> {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const groups = await this.groupService.listForUser(req.user.userId, search)
    res.json({ success: true, data: groups })
  }
}
