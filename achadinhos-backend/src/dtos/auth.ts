import { z } from 'zod'
import { USER_ROLE_ENUM } from '@/database/models/User'

export interface JwtPayloadDTO {
  sub: number
  uuid: string
  role: USER_ROLE_ENUM
}

export const RegisterRequestSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(120),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(128),
})
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>

export const LoginRequestSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export interface AuthUserDTO {
  id: number
  uuid: string
  name: string
  email: string
  role: USER_ROLE_ENUM
}
