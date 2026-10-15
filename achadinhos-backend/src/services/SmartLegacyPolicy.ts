import { Op, QueryTypes, type Transaction } from 'sequelize'
import { sequelize } from '@/database'
import { SmartAudience } from '@/database/models/SmartAudience'
import { SmartSend, SMART_SEND_STATUS } from '@/database/models/SmartSend'
import { AppError } from '@/middleware/Error/AppError'

export function destinationLockKey(userId: number, scope: string, groupId: string): string {
  return `delivery-destination:${userId}:${scope}:${groupId}`
}

export function localClock(now: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const part = (key: string) => parts.find((entry) => entry.type === key)!.value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

function blocked(message: string): never {
  throw new AppError(message, 409, 'SMART_POLICY_BLOCKED')
}

/** Called under the same account/destination locks as the smart sender. */
export async function assertLegacySmartPolicy(
  userId: number, scope: string, groupId: string, transaction: Transaction, now = new Date(),
): Promise<void> {
  const pending = await SmartSend.count({
    where: {
      userId, connectionScope: scope, groupId,
      status: { [Op.in]: [SMART_SEND_STATUS.PENDING, SMART_SEND_STATUS.SENDING, SMART_SEND_STATUS.UNKNOWN] },
    }, transaction,
  })
  if (pending) blocked('Este grupo possui uma agenda inteligente reservada. Cancele a agenda ou resolva os envios pendentes antes de iniciar uma campanha manual.')

  const audiences = await SmartAudience.findAll({ where: { userId, enabled: true }, transaction })
  const policies = audiences.filter((audience) => audience.destinations.some((target) => target.groupId === groupId))
  for (const audience of policies) {
    const policy = audience.policy
    const clock = localClock(now, policy.timezone)
    if (clock.time < policy.startTime || clock.time >= policy.endTime) {
      blocked(`Fora do horário de ${audience.name}: ${policy.startTime}–${policy.endTime}. A campanha foi pausada para evitar envios noturnos.`)
    }
    const [counts] = await sequelize.query<{ total: number; last_send: Date | null }>(
      `SELECT COUNT(*)::int AS total, MAX(at) AS last_send FROM (
         SELECT sent_at AS at FROM campaign_logs
           WHERE connection_scope = :scope AND group_id = :groupId AND success = true
             AND (sent_at AT TIME ZONE :timezone)::date = CAST(:date AS date)
             AND campaign_id IN (SELECT id FROM campaigns WHERE user_id = :userId)
         UNION ALL
         SELECT COALESCE(sent_at, updated_at) AS at FROM smart_sends
           WHERE user_id = :userId AND connection_scope = :scope AND group_id = :groupId
             AND status IN ('SENT', 'UNKNOWN')
             AND (COALESCE(sent_at, updated_at) AT TIME ZONE :timezone)::date = CAST(:date AS date)
         UNION ALL
         SELECT heartbeat_at AS at FROM product_group_deliveries
           WHERE user_id = :userId AND connection_scope = :scope AND group_id = :groupId
             AND status = 'SENDING' AND campaign_id IS NOT NULL
       ) history`,
      { replacements: { scope, groupId, userId, timezone: policy.timezone, date: clock.date },
        type: QueryTypes.SELECT, transaction },
    )
    if (Number(counts.total) >= policy.dailyCap) blocked(`Limite diário de ${policy.dailyCap} produtos atingido para ${audience.name}. Revise a campanha para o próximo dia.`)
    if (counts.last_send && now.getTime() - new Date(counts.last_send).getTime() < policy.minGapSeconds * 1000) {
      blocked(`Aguarde o intervalo mínimo de ${Math.ceil(policy.minGapSeconds / 60)} minutos de ${audience.name} antes de retomar esta campanha.`)
    }
  }
}
