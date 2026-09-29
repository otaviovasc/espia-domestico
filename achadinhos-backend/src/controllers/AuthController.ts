import { Request, Response, CookieOptions } from 'express'
import { injectable, inject } from 'tsyringe'
import { AuthService } from '@/services/AuthService'
import { RegisterRequestSchema, LoginRequestSchema } from '@/dtos/auth'
import { generateToken, AUTH_COOKIE_NAME } from '@/middleware/auth'
import { BadRequestError, UnauthorizedError, NotFoundError } from '@/middleware/Error/AppError'
import { USER_ROLE_ENUM } from '@/database/models/User'
import { env } from '@/config/env'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

@injectable()
export class AuthController {
  constructor(@inject(AuthService) private authService: AuthService) {}

  private setAuthCookie(res: Response, token: string): void {
    const options: CookieOptions & { partitioned?: boolean } = {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      // Cross-service frontend (espiadomestico.com.br → backend.up.railway.app)
      // needs SameSite=None + Secure, otherwise the browser drops the session
      // cookie on cross-site fetch. Local dev keeps Lax.
      sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
      maxAge: SEVEN_DAYS_MS,
      path: '/',
    }
    // CHIPS: partition the cross-site cookie per top-level site so modern
    // browsers store/send it even with third-party cookies blocked — while
    // keeping it httpOnly (invisible to JS/XSS). Only meaningful with Secure.
    if (env.COOKIE_SECURE) options.partitioned = true
    res.cookie(AUTH_COOKIE_NAME, token, options)
  }

  /**
   * POST /auth/register — creates a new member. Admin-only in normal use, but
   * the very first user (when the table is empty) is allowed through and
   * promoted to ADMIN so the system can be bootstrapped.
   */
  async register(req: Request, res: Response): Promise<void> {
    const parsed = RegisterRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }

    const userCount = await this.authService.countUsers()
    let role = USER_ROLE_ENUM.MEMBER
    if (userCount === 0) {
      role = USER_ROLE_ENUM.ADMIN
    } else {
      // Subsequent registrations require an authenticated admin.
      if (!req.user) throw UnauthorizedError('Não autenticado')
      if (req.user.role !== USER_ROLE_ENUM.ADMIN) {
        throw UnauthorizedError('Apenas administradores podem criar novos usuários')
      }
    }

    const user = await this.authService.register(parsed.data, role)
    res.status(201).json({ success: true, data: user })
  }

  async login(req: Request, res: Response): Promise<void> {
    const parsed = LoginRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const user = await this.authService.login(parsed.data)
    const token = generateToken({ id: user.id, uuid: user.uuid, role: user.role })
    this.setAuthCookie(res, token)
    // Also return the token in the body. The SPA stores it and sends it as a
    // Bearer header, so auth works even when the browser blocks the cross-site
    // (third-party) session cookie.
    res.json({ success: true, data: user, token })
  }

  async logout(_req: Request, res: Response): Promise<void> {
    const options: CookieOptions & { partitioned?: boolean } = {
      path: '/',
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
    }
    if (env.COOKIE_SECURE) options.partitioned = true
    res.clearCookie(AUTH_COOKIE_NAME, options)
    res.json({ success: true })
  }

  async me(req: Request, res: Response): Promise<void> {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    const user = await this.authService.getById(req.user.userId)
    if (!user) throw NotFoundError('Usuário não encontrado')
    res.json({ success: true, data: user })
  }
}
