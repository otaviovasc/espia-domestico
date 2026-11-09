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

/** Caller holds the shared delivery-account lock. Ordinary plans keep their repeat semantics. */
export async function hasDailyProductConflict(
  userId: number,
  planId: number,
  planUuid: string,
  offer: OfferIdentityInput,
  transaction: Transaction,
): Promise<boolean> {
  const productId =
    offer.source?.trim().toLowerCase() === 'mercadolivre'
      ? (normalizedMercadoLivreProductId(offer.productId) ?? null)
      : null
  const rows = await sequelize.query<{ conflict: boolean }>(
    `SELECT EXISTS (
    SELECT 1 FROM product_group_deliveries d
    WHERE d.user_id=:userId AND d.plan_uuid IS DISTINCT FROM CAST(:planUuid AS UUID)
      AND (d.offer_identity IN (:aliases) OR (:productId IS NOT NULL
        AND LOWER(TRIM(d.offer_source))='mercadolivre'
        AND UPPER(REGEXP_REPLACE(d.offer_product_id, '[-[:space:]]', '', 'g'))=:productId))
    UNION ALL
    SELECT 1 FROM smart_sends s
    WHERE s.user_id=:userId AND s.plan_id <> :planId AND s.status IN ('PENDING','SENDING','SENT','UNKNOWN')
      AND (s.offer_identity IN (:aliases) OR (:productId IS NOT NULL
        AND LOWER(TRIM(s.offer->>'source'))='mercadolivre'
        AND UPPER(REGEXP_REPLACE(s.offer->>'productId', '[-[:space:]]', '', 'g'))=:productId))
  ) AS conflict`,
    {
      replacements: { userId, planId, planUuid, productId, aliases: offerIdentityAliases(offer) },
      transaction,
      type: QueryTypes.SELECT,
    },
  )
  return rows[0]?.conflict === true
}
