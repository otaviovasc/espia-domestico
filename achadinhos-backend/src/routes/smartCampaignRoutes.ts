import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { container } from 'tsyringe'
import { SmartCampaignController } from '@/controllers/SmartCampaignController'
import { authenticate } from '@/middleware/auth'

export const smartCampaignRoutes = Router()
const controller = container.resolve(SmartCampaignController)
const smartReadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => `smart-read:${request.user?.userId ?? request.ip}`,
})
const smartWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => `smart-write:${request.user?.userId ?? request.ip}`,
})

smartCampaignRoutes.use(authenticate)
smartCampaignRoutes.get('/ai-status', controller.aiStatus.bind(controller))
smartCampaignRoutes.get('/audiences', controller.listAudiences.bind(controller))
smartCampaignRoutes.put('/audiences/:slug', controller.updateAudience.bind(controller))
smartCampaignRoutes.post('/keywords', smartReadLimiter, controller.keywords.bind(controller))
smartCampaignRoutes.post('/plans', smartWriteLimiter, controller.createPlan.bind(controller))
smartCampaignRoutes.get('/plans', controller.listPlans.bind(controller))
smartCampaignRoutes.get('/plans/:id', controller.getPlan.bind(controller))
smartCampaignRoutes.patch('/plans/:id', controller.updatePlan.bind(controller))
smartCampaignRoutes.post('/plans/:id/approve', controller.approve.bind(controller))
smartCampaignRoutes.post('/plans/:id/pause', controller.pause.bind(controller))
smartCampaignRoutes.post('/plans/:id/resume', controller.resume.bind(controller))
smartCampaignRoutes.post('/plans/:id/cancel', controller.cancel.bind(controller))
smartCampaignRoutes.post('/plans/:id/retry', smartWriteLimiter, controller.retry.bind(controller))
smartCampaignRoutes.post('/sends/:id/resolve', controller.resolveSend.bind(controller))

export default smartCampaignRoutes
