import { Router } from 'express'
import { container } from 'tsyringe'
import { ConnectionController } from '@/controllers/ConnectionController'
import { authenticate } from '@/middleware/auth'

const connectionRoutes = Router()
const controller = container.resolve(ConnectionController)

connectionRoutes.get('/', authenticate, (req, res) => controller.status(req, res))
connectionRoutes.post('/connect', authenticate, (req, res) => controller.connect(req, res))
connectionRoutes.post('/attach', authenticate, (req, res) => controller.attachExisting(req, res))
connectionRoutes.post('/disconnect', authenticate, (req, res) => controller.disconnect(req, res))
connectionRoutes.get('/webhook', authenticate, (req, res) => controller.webhookInfo(req, res))
connectionRoutes.post('/webhook', authenticate, (req, res) => controller.updateWebhook(req, res))

export { connectionRoutes }
