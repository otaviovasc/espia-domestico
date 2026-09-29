import { Router } from 'express'
import { container } from 'tsyringe'
import { ClassificationProfileController } from '@/controllers/ClassificationProfileController'
import { authenticate } from '@/middleware/auth'

const classificationProfileRoutes = Router()
const controller = container.resolve(ClassificationProfileController)

classificationProfileRoutes.get('/', authenticate, (req, res) => controller.list(req, res))
classificationProfileRoutes.post('/', authenticate, (req, res) => controller.create(req, res))
classificationProfileRoutes.put('/:id', authenticate, (req, res) => controller.update(req, res))
classificationProfileRoutes.delete('/:id', authenticate, (req, res) => controller.remove(req, res))

export { classificationProfileRoutes }
