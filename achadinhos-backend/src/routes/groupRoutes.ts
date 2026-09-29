import { Router } from 'express'
import { container } from 'tsyringe'
import { GroupController } from '@/controllers/GroupController'
import { authenticate } from '@/middleware/auth'

const groupRoutes = Router()
const controller = container.resolve(GroupController)

groupRoutes.get('/', authenticate, (req, res) => controller.list(req, res))

export { groupRoutes }
