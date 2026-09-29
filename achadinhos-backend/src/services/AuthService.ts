import bcrypt from 'bcrypt'
import { injectable } from 'tsyringe'
import { User, USER_ROLE_ENUM } from '@/database/models/User'
import { RegisterRequest, LoginRequest, AuthUserDTO } from '@/dtos/auth'
import { ConflictError, UnauthorizedError } from '@/middleware/Error/AppError'

const BCRYPT_ROUNDS = 12

@injectable()
export class AuthService {
  private toDTO(user: User): AuthUserDTO {
    return {
      id: user.id,
      uuid: user.uuid,
      name: user.name,
      email: user.email,
      role: user.role,
    }
  }

  async register(input: RegisterRequest, role: USER_ROLE_ENUM = USER_ROLE_ENUM.MEMBER): Promise<AuthUserDTO> {
    const email = input.email.trim().toLowerCase()
    const existing = await User.findOne({ where: { email } })
    if (existing) {
      throw ConflictError('Já existe um usuário com este e-mail')
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    const user = await User.create({
      name: input.name.trim(),
      email,
      passwordHash,
      role,
    })
    return this.toDTO(user)
  }

  async login(input: LoginRequest): Promise<AuthUserDTO> {
    const email = input.email.trim().toLowerCase()
    const user = await User.findOne({ where: { email } })
    // Always run a bcrypt compare to avoid user-enumeration timing differences.
    const hash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidin.'
    const ok = await bcrypt.compare(input.password, hash)
    if (!user || !ok) {
      throw UnauthorizedError('E-mail ou senha inválidos')
    }
    return this.toDTO(user)
  }

  async getById(userId: number): Promise<AuthUserDTO | null> {
    const user = await User.findByPk(userId)
    return user ? this.toDTO(user) : null
  }

  async countUsers(): Promise<number> {
    return User.count()
  }
}
