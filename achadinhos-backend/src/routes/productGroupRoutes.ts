import { Router } from 'express'
import { container } from 'tsyringe'
import { ProductGroupController } from '@/controllers/ProductGroupController'
import { authenticate } from '@/middleware/auth'

const productGroupRoutes = Router()
const controller = container.resolve(ProductGroupController)

productGroupRoutes.get('/', authenticate, (req, res) => controller.list(req, res))
productGroupRoutes.post('/', authenticate, (req, res) => controller.create(req, res))
productGroupRoutes.patch('/:id', authenticate, (req, res) => controller.update(req, res))
productGroupRoutes.delete('/:id', authenticate, (req, res) => controller.remove(req, res))

export { productGroupRoutes }
