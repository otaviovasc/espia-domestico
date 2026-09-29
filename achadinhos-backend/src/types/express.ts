import type { USER_ROLE_ENUM } from '@/database/models/User'

/**
 * Express Request augmentation.
 *
 * This is a real `.ts` module (not a `.d.ts`) and is imported for its side
 * effects in `app.ts`, so `ts-node-dev` — which compiles files as they are
 * required — actually loads the augmentation. A standalone `.d.ts` that
 * nothing imports is skipped by ts-node at runtime.
 */
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      userId: number
      uuid: string
      role: USER_ROLE_ENUM
    }
  }
}

export {}
