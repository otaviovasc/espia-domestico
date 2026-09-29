import { Router } from 'express'
import { container } from 'tsyringe'
import rateLimit from 'express-rate-limit'
import { AuthController } from '@/controllers/AuthController'
import { authenticate, optionalAuth } from '@/middleware/auth'

const authRoutes = Router()
const authController = container.resolve(AuthController)

/** Tight rate limit on login to slow credential-stuffing. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Muitas tentativas. Tente novamente mais tarde.' } },
})

authRoutes.post('/register', optionalAuth, (req, res) => authController.register(req, res))
authRoutes.post('/login', loginLimiter, (req, res) => authController.login(req, res))
authRoutes.post('/logout', (req, res) => authController.logout(req, res))
authRoutes.get('/me', authenticate, (req, res) => authController.me(req, res))

export { authRoutes }
