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

const dailyHistory = `WITH daily_history AS (
  SELECT d.offer_identity, CASE WHEN LOWER(TRIM(d.offer_source))='mercadolivre'
    THEN UPPER(REGEXP_REPLACE(d.offer_product_id, '[-[:space:]]', '', 'g')) END AS product_id
  FROM product_group_deliveries d
  WHERE d.user_id=:userId AND (:planUuid IS NULL OR d.plan_uuid IS DISTINCT FROM CAST(:planUuid AS UUID))
  UNION ALL
  SELECT s.offer_identity, CASE WHEN LOWER(TRIM(s.offer->>'source'))='mercadolivre'
    THEN UPPER(REGEXP_REPLACE(s.offer->>'productId', '[-[:space:]]', '', 'g')) END AS product_id
  FROM smart_sends s
  WHERE s.user_id=:userId AND (:planId IS NULL OR s.plan_id <> :planId)
    AND s.status IN ('PENDING','SENDING','SENT','UNKNOWN')
)`

export async function dailyExcludedProductIds(userId: number, planId: number | null = null, planUuid: string | null = null): Promise<string[]> {
  const rows = await sequelize.query<{ product_id: string }>(
    `${dailyHistory} SELECT DISTINCT product_id FROM daily_history WHERE product_id ~ '^(MLBU|MLB)[0-9]{6,}$'`,
    { replacements: { userId, planId, planUuid }, type: QueryTypes.SELECT },
  )
  return rows.map(row => row.product_id)
}

export async function dailyProductConflicts(
  userId: number,
  planId: number | null,
  planUuid: string | null,
  offers: OfferIdentityInput[],
  transaction?: Transaction,
): Promise<Set<string>> {
  if (!offers.length) return new Set()
  const candidates = offers.map(offer => ({
    aliases: offerIdentityAliases(offer),
    product_id: offer.source?.trim().toLowerCase() === 'mercadolivre'
      ? normalizedMercadoLivreProductId(offer.productId) ?? null : null,
  }))
  const rows = await sequelize.query<{ aliases: string[]; product_id: string | null }>(
    `${dailyHistory}
    SELECT DISTINCT c.aliases, c.product_id
    FROM JSONB_TO_RECORDSET(CAST(:candidates AS JSONB)) AS c(aliases TEXT[], product_id TEXT)
    JOIN daily_history h ON h.offer_identity=ANY(c.aliases) OR h.product_id=c.product_id`,
    {
      replacements: { userId, planId, planUuid, candidates: JSON.stringify(candidates) },
      transaction,
      type: QueryTypes.SELECT,
    },
  )
  return new Set(rows.flatMap(row => [...row.aliases, ...(row.product_id ? [`mercadolivre:${row.product_id}`] : [])]))
}

/** Caller holds the shared delivery-account lock. Ordinary plans keep their repeat semantics. */
export async function hasDailyProductConflict(
  userId: number,
  planId: number,
  planUuid: string,
  offer: OfferIdentityInput,
  transaction: Transaction,
): Promise<boolean> {
  return (await dailyProductConflicts(userId, planId, planUuid, [offer], transaction)).size > 0
}
