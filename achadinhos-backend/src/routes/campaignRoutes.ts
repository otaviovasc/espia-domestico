import { Router } from 'express'
import { container } from 'tsyringe'
import { CampaignController } from '@/controllers/CampaignController'
import { authenticate } from '@/middleware/auth'

const campaignRoutes = Router()
const controller = container.resolve(CampaignController)

campaignRoutes.get('/meta', authenticate, (req, res) => controller.meta(req, res))
campaignRoutes.post('/import-offers', authenticate, (req, res) => controller.importOffers(req, res))
campaignRoutes.post('/preview', authenticate, (req, res) => controller.preview(req, res))
campaignRoutes.post('/check-offers', authenticate, (req, res) => controller.checkOffers(req, res))
campaignRoutes.post('/delivery-claims/resolve', authenticate, (req, res) =>
  controller.resolveDeliveryClaim(req, res),
)
campaignRoutes.post('/', authenticate, (req, res) => controller.create(req, res))
campaignRoutes.get('/', authenticate, (req, res) => controller.list(req, res))
campaignRoutes.get('/:id', authenticate, (req, res) => controller.get(req, res))
campaignRoutes.patch('/:id', authenticate, (req, res) => controller.update(req, res))
campaignRoutes.get('/:id/logs', authenticate, (req, res) => controller.logs(req, res))
campaignRoutes.get('/:id/progress', authenticate, (req, res) => controller.progress(req, res))
campaignRoutes.delete('/:id/offers', authenticate, (req, res) => controller.removeOffer(req, res))
campaignRoutes.post('/:id/run', authenticate, (req, res) => controller.run(req, res))
campaignRoutes.post('/:id/pause', authenticate, (req, res) => controller.pause(req, res))
campaignRoutes.post('/:id/resume', authenticate, (req, res) => controller.resume(req, res))
campaignRoutes.post('/:id/cancel', authenticate, (req, res) => controller.cancel(req, res))

export { campaignRoutes }
