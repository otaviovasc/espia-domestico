import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { injectable, inject } from 'tsyringe'
import { QueryTypes } from 'sequelize'
import { sequelize } from '@/database'
import { env } from '@/config/env'
import type { DailyAutomationConfig } from '@/config/dailyAutomation'
import { dailyWindow } from '@/config/dailyAutomation'
import { ConnectionService } from './ConnectionService'
import { GroupService } from './GroupService'
import { DailyAutomationAlerts } from './DailyAutomationAlerts'

export interface MlCodeIncoming { groupId: string; messageId: string | null; sender: string | null; fromMe: boolean; text: string | null; timestamp: Date; timestampVerified?: boolean }
export interface MlChallenge { id: string; ownerId: string; scope: string; groupId: string; expiresAt: Date }
const key = (): Buffer => createHash('sha256').update('espia:ml-email-code:v1\0').update(env.JWT_SECRET).digest()

export function encryptMlCode(code: string, challenge: Pick<MlChallenge, 'id' | 'scope' | 'groupId'>): string {
  if (!/^\d{6}$/.test(code)) throw new Error('ML_CODE_INVALID')
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(`${challenge.id}:${challenge.scope}:${challenge.groupId}`))
  const data = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}
export function decryptMlCode(encrypted: string, challenge: Pick<MlChallenge, 'id' | 'scope' | 'groupId'>): string {
  const data = Buffer.from(encrypted, 'base64'), decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12))
  decipher.setAAD(Buffer.from(`${challenge.id}:${challenge.scope}:${challenge.groupId}`)); decipher.setAuthTag(data.subarray(12, 28))
  const code = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
  if (!/^\d{6}$/.test(code)) throw new Error('ML_CODE_INVALID')
  return code
}

@injectable()
export class MlAuthChallengeService {
  constructor(
    @inject(ConnectionService) private readonly connections: ConnectionService,
    @inject(GroupService) private readonly groups: GroupService,
    @inject(DailyAutomationAlerts) private readonly alerts: DailyAutomationAlerts,
  ) {}

  async expire(): Promise<void> {
    await sequelize.query("UPDATE ml_auth_challenges SET status='EXPIRED',code_ciphertext=NULL,updated_at=NOW() WHERE expires_at<=NOW() AND status IN('WAITING','CODE_READY','SUBMITTING')")
    await sequelize.query(`UPDATE daily_automation_alerts a SET status='EXPIRED',updated_at=NOW() WHERE status='PENDING' AND event_key LIKE 'ml-auth:%'
      AND NOT EXISTS(SELECT 1 FROM ml_auth_challenges c WHERE a.event_key='ml-auth:'||c.id::text AND c.status='WAITING' AND c.expires_at>NOW())`)
  }

  async begin(config: DailyAutomationConfig): Promise<MlChallenge> {
    const scope = await this.preflight(config)
    await this.expire()
    const challenge: MlChallenge = { id: randomUUID(), ownerId: randomUUID(), scope, groupId: config.alertGroupId!, expiresAt: new Date(Date.now() + 5 * 60_000) }
    const rows = await sequelize.query<{ id: string }>(`INSERT INTO ml_auth_challenges(id,user_id,connection_scope,group_id,owner_id,status,expires_at)
      VALUES(:id,:userId,:scope,:groupId,:ownerId,'WAITING',:expiry) ON CONFLICT DO NOTHING RETURNING id`, {
      replacements: { id: challenge.id, userId: config.userId, scope, groupId: challenge.groupId, ownerId: challenge.ownerId, expiry: challenge.expiresAt }, type: QueryTypes.SELECT })
    if (!rows.length) throw new Error('ML_AUTH_CHALLENGE_ACTIVE')
    try { await this.alerts.enqueueLoginCode(config, dailyWindow(config).date, challenge.id) }
    catch { await this.finish(challenge, false); throw new Error('ML_AUTH_REQUEST_FAILED') }
    return challenge
  }

  async preflight(config: DailyAutomationConfig): Promise<string> {
    if (!config.alertGroupId) throw new Error('ML_AUTH_GROUP_REQUIRED')
    await this.connections.requireConnectedCreds(config.userId)
    const scope = await this.connections.getConnectionScope(config.userId)
    if (!scope) throw new Error('ML_AUTH_CONNECTION_REQUIRED')
    await this.groups.requireCurrentGroups(config.userId, [config.alertGroupId])
    return scope
  }

  /** Called before chat persistence. Late/replayed codes from this operation chat are discarded too. */
  async acceptIncoming(scope: string, message: MlCodeIncoming): Promise<boolean> {
    if (!message.text || !/^\d{6}$/.test(message.text.trim())) return false
    const rows = await sequelize.query<{ id: string; status: string; expires_at: Date; created_at: Date }>(`SELECT id,status,expires_at,created_at FROM ml_auth_challenges
      WHERE connection_scope=:scope AND group_id=:groupId AND created_at>NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1`,
    { replacements: { scope, groupId: message.groupId }, type: QueryTypes.SELECT })
    const row = rows[0]
    if (!row) return false
    if (row.status !== 'WAITING' || new Date(row.expires_at).getTime() <= Date.now() || !message.messageId || !message.timestampVerified || (!message.fromMe && !message.sender) || message.timestamp.getTime() < new Date(row.created_at).getTime() - 1000 || message.timestamp.getTime() > Date.now() + 30_000) return true
    const encrypted = encryptMlCode(message.text.trim(), { id: row.id, scope, groupId: message.groupId })
    await sequelize.query(`UPDATE ml_auth_challenges SET status='CODE_READY',code_ciphertext=:encrypted,accepted_message_id=:messageId,updated_at=NOW()
      WHERE id=:id AND status='WAITING' AND expires_at>NOW()`, { replacements: { id: row.id, encrypted, messageId: message.messageId } })
    return true
  }

  async take(challenge: MlChallenge): Promise<string | null> {
    const rows = await sequelize.query<{ code_ciphertext: string }>(`WITH ready AS (
      SELECT id,code_ciphertext FROM ml_auth_challenges WHERE id=:id AND owner_id=:ownerId AND status='CODE_READY' AND expires_at>NOW() FOR UPDATE)
      UPDATE ml_auth_challenges c SET status='SUBMITTING',code_ciphertext=NULL,updated_at=NOW() FROM ready WHERE c.id=ready.id RETURNING ready.code_ciphertext`,
    { replacements: { id: challenge.id, ownerId: challenge.ownerId }, type: QueryTypes.SELECT })
    return rows[0] ? decryptMlCode(rows[0].code_ciphertext, challenge) : null
  }

  async finish(challenge: MlChallenge, success: boolean): Promise<void> {
    await sequelize.query("UPDATE ml_auth_challenges SET status=:status,code_ciphertext=NULL,updated_at=NOW() WHERE id=:id AND owner_id=:ownerId AND status IN('WAITING','CODE_READY','SUBMITTING')", { replacements: { id: challenge.id, ownerId: challenge.ownerId, status: success ? 'SUCCEEDED' : 'FAILED' } })
  }
}
