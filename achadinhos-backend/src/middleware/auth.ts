import { Request, Response, NextFunction } from 'express'
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken'
import { UnauthorizedError, ForbiddenError } from './Error/AppError'
import { env } from '@/config/env'
import { USER_ROLE_ENUM } from '@/database/models/User'
import type { JwtPayloadDTO } from '@/dtos/auth'

export const AUTH_COOKIE_NAME = 'achadinhos_token'

function isJwtPayloadDTO(payload: string | JwtPayload): payload is JwtPayload & JwtPayloadDTO {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as JwtPayload).sub === 'number' &&
    'uuid' in payload &&
    'role' in payload
  )
}

/**
 * Read the JWT from the httpOnly cookie first, then fall back to the
 * Authorization: Bearer header (useful for API clients / tests).
 */
function extractToken(req: Request): string | null {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE_NAME]
  if (cookieToken) return cookieToken

  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length)
  }
  return null
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req)
  if (!token) {
    return next(UnauthorizedError('Não autenticado'))
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (!isJwtPayloadDTO(payload)) {
      return next(UnauthorizedError('Token inválido'))
    }
    req.user = { userId: payload.sub, uuid: payload.uuid, role: payload.role }
    next()
  } catch {
    next(UnauthorizedError('Token inválido ou expirado'))
  }
}

/** Attach req.user if a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req)
  if (!token) return next()
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (isJwtPayloadDTO(payload)) {
      req.user = { userId: payload.sub, uuid: payload.uuid, role: payload.role }
    }
  } catch {
    // ignore invalid token in optional mode
  }
  next()
}

export function authorize(...allowedRoles: USER_ROLE_ENUM[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(UnauthorizedError('Não autenticado'))
    if (!allowedRoles.includes(req.user.role)) {
      return next(ForbiddenError('Permissões insuficientes'))
    }
    next()
  }
}

export function generateToken(user: {
  id: number
  uuid: string
  role: USER_ROLE_ENUM
}): string {
  const payload: JwtPayloadDTO = { sub: user.id, uuid: user.uuid, role: user.role }
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as SignOptions)
}
