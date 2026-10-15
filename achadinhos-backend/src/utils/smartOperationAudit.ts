import type { Transaction } from 'sequelize'
import { sequelize } from '@/database'

/** Append only through this API; no product text, credentials or group chat content. */
export async function recordSmartOperation(
  userId: number,
  action: string,
  metadata: Readonly<Record<string, unknown>>,
  transaction?: Transaction,
): Promise<void> {
  await sequelize.query(
    'INSERT INTO smart_operation_events(user_id, action, metadata) VALUES (:userId, :action, CAST(:metadata AS jsonb))',
    { replacements: { userId, action, metadata: JSON.stringify(metadata) }, transaction },
  )
}
