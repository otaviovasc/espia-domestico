import { Router } from 'express'
import { container } from 'tsyringe'
import { GroupController } from '@/controllers/GroupController'
import { authenticate } from '@/middleware/auth'

const groupRoutes = Router()
const controller = container.resolve(GroupController)

groupRoutes.get('/', authenticate, (req, res) => controller.list(req, res))
groupRoutes.get('/:groupId/messages', authenticate, (req, res) =>
  controller.listMessages(req, res),
)
groupRoutes.post('/:groupId/messages', authenticate, (req, res) =>
  controller.sendMessage(req, res),
)

export { groupRoutes }
