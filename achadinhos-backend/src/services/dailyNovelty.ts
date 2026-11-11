import { QueryTypes, type Transaction } from 'sequelize'
import { sequelize } from '@/database'
import {
  offerIdentityAliases,
  normalizedMercadoLivreProductId,
  type OfferIdentityInput,
} from '@/utils/offerIdentity'

export function dailyOfferAliases(offer: OfferIdentityInput): string[] {
  const productId =
    offer.source?.trim().toLowerCase() === 'mercadolivre'
      ? normalizedMercadoLivreProductId(offer.productId)
      : undefined
  return [...offerIdentityAliases(offer), ...(productId ? [`mercadolivre:${productId}`] : [])]
}

export interface DailyRepeatPolicy {
  repeatCooldownDays?: number
  groupIds?: string[]
  now?: Date
}

export function dailyRepeatCooldown(policy: DailyRepeatPolicy): number {
  const days = policy.repeatCooldownDays ?? 0
  return Number.isInteger(days) && days >= 7 && days <= 3650 ? days : 0
}

export async function dailyProductHistory(
  userId: number, planId: number, planUuid: string, offer: OfferIdentityInput,
  policy: DailyRepeatPolicy = {}, transaction?: Transaction,
): Promise<{ conflict: boolean; repeat: boolean }> {
  const cooldown = policy.groupIds?.length ? dailyRepeatCooldown(policy) : 0
  const cutoff = new Date((policy.now ?? new Date()).getTime() - cooldown * 86_400_000)
  const productId = offer.source?.trim().toLowerCase() === 'mercadolivre'
    ? normalizedMercadoLivreProductId(offer.productId) ?? null : null
  const rows = await sequelize.query<{ conflict: boolean; repeat: boolean }>(
    `WITH history AS (
      SELECT d.group_id, d.status::text AS status, d.sent_at
      FROM product_group_deliveries d
      WHERE d.user_id=:userId AND d.plan_uuid IS DISTINCT FROM CAST(:planUuid AS UUID)
        AND (d.offer_identity IN (:aliases) OR (:productId IS NOT NULL
          AND LOWER(TRIM(d.offer_source))='mercadolivre'
          AND UPPER(REGEXP_REPLACE(d.offer_product_id, '[-[:space:]]', '', 'g'))=:productId))
      UNION ALL
      SELECT s.group_id, s.status::text, s.sent_at FROM smart_sends s
      WHERE s.user_id=:userId AND s.plan_id <> :planId AND s.status IN ('PENDING','SENDING','SENT','UNKNOWN')
        AND (s.offer_identity IN (:aliases) OR (:productId IS NOT NULL
          AND LOWER(TRIM(s.offer->>'source'))='mercadolivre'
          AND UPPER(REGEXP_REPLACE(s.offer->>'productId', '[-[:space:]]', '', 'g'))=:productId))
    ) SELECT
      COALESCE(BOOL_OR(status <> 'SENT' OR sent_at IS NULL
        OR ((:cooldown = 0 OR group_id IN (:groupIds)) AND (:cooldown = 0 OR sent_at > :cutoff))), false) AS conflict,
      COALESCE(BOOL_OR(status='SENT' AND (:cooldown = 0 OR group_id IN (:groupIds))), false) AS repeat
    FROM history`,
    { replacements: { userId, planId, planUuid, productId, aliases: dailyOfferAliases(offer),
      cooldown, cutoff, groupIds: policy.groupIds?.length ? policy.groupIds : [''] }, transaction, type: QueryTypes.SELECT },
  )
  return rows[0] ?? { conflict: false, repeat: false }
}

/** Caller holds the shared delivery-account lock. Ordinary plans keep their repeat semantics. */
export async function hasDailyProductConflict(
  userId: number, planId: number, planUuid: string, offer: OfferIdentityInput,
  transaction: Transaction, policy: DailyRepeatPolicy = {},
): Promise<boolean> {
  return (await dailyProductHistory(userId, planId, planUuid, offer, policy, transaction)).conflict
}
