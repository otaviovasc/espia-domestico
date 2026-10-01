import { Router } from 'express'
import { container } from 'tsyringe'
import { WebhookController } from '@/controllers/WebhookController'

const webhookRoutes = Router()
const controller = container.resolve(WebhookController)

// Public: UAZAPI posts events here. The connection uuid in the path authorizes.
webhookRoutes.post('/uazapi/:uuid', (req, res) => controller.ingest(req, res))

export { webhookRoutes }
