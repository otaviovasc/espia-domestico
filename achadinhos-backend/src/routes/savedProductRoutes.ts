import { Router } from 'express'
import { container } from 'tsyringe'
import { SavedProductController } from '@/controllers/SavedProductController'
import { authenticate } from '@/middleware/auth'

const savedProductRoutes = Router()
const controller = container.resolve(SavedProductController)

savedProductRoutes.post('/', authenticate, (req, res) => controller.save(req, res))
savedProductRoutes.get('/', authenticate, (req, res) => controller.list(req, res))
savedProductRoutes.patch('/:id', authenticate, (req, res) => controller.update(req, res))
savedProductRoutes.delete('/:id', authenticate, (req, res) => controller.remove(req, res))

export { savedProductRoutes }
