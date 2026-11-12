import { QueryTypes, type Transaction } from 'sequelize'
import { sequelize } from '@/database'
import { dailyVariantKey, dailyVariantPattern, dailyNormalizedTitleSql } from '@/utils/dailyAssortment'
import {
  offerIdentity,
  offerIdentityAliases,
  normalizedMercadoLivreProductId,
  type OfferIdentityInput,
} from '@/utils/offerIdentity'

export function dailyOfferAliases(offer: OfferIdentityInput): string[] {
  const productId =
    offer.source?.trim().toLowerCase() === 'mercadolivre'
      ? normalizedMercadoLivreProductId(offer.productId)
      : undefined
  const url = offer.affiliateUrl?.trim()
  return [...new Set([...offerIdentityAliases(offer), ...(url ? [offerIdentity({ affiliateUrl: url })] : []),
    ...(productId ? [`mercadolivre:${productId}`] : [])])]
}

export function dailySelectionAliases(offer: OfferIdentityInput & { title?: string }): string[] {
  const variant = dailyVariantKey(offer)
  return [...dailyOfferAliases(offer), ...(variant ? [variant] : [])]
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

const dailyHistory = `WITH daily_history AS (
  SELECT d.offer_identity, CASE WHEN LOWER(TRIM(d.offer_source))='mercadolivre'
    THEN UPPER(REGEXP_REPLACE(d.offer_product_id, '[-[:space:]]', '', 'g')) END AS product_id,
    TRIM(d.offer_url) AS offer_url, d.offer_title, d.group_id, d.status::text AS status, d.sent_at
  FROM product_group_deliveries d
  WHERE d.user_id=:userId AND (:planUuid IS NULL OR d.plan_uuid IS DISTINCT FROM CAST(:planUuid AS UUID))
  UNION ALL
  SELECT s.offer_identity, CASE WHEN LOWER(TRIM(s.offer->>'source'))='mercadolivre'
    THEN UPPER(REGEXP_REPLACE(s.offer->>'productId', '[-[:space:]]', '', 'g')) END AS product_id,
    TRIM(s.offer->>'affiliateUrl'), s.offer->>'title', s.group_id, s.status::text, s.sent_at
  FROM smart_sends s
  WHERE s.user_id=:userId AND (:planId IS NULL OR s.plan_id <> :planId)
    AND s.status IN ('PENDING','SENDING','SENT','UNKNOWN')
)`
const blockedHistory = `(h.status <> 'SENT' OR h.sent_at IS NULL OR :cooldown = 0
  OR (h.group_id IN (:groupIds) AND h.sent_at > :cutoff))`

function historyPolicy(policy: DailyRepeatPolicy) {
  const cooldown = policy.groupIds?.length ? dailyRepeatCooldown(policy) : 0
  return { cooldown, groupIds: policy.groupIds?.length ? policy.groupIds : [''],
    cutoff: new Date((policy.now ?? new Date()).getTime() - cooldown * 86_400_000) }
}

export async function dailyExcludedProductIds(
  userId: number, planId: number | null = null, planUuid: string | null = null, policy: DailyRepeatPolicy = {},
): Promise<string[]> {
  const rows = await sequelize.query<{ product_id: string }>(
    `${dailyHistory} SELECT DISTINCT h.product_id FROM daily_history h
    WHERE h.product_id ~ '^(MLBU|MLB)[0-9]{6,}$' AND ${blockedHistory}`,
    { replacements: { userId, planId, planUuid, ...historyPolicy(policy) }, type: QueryTypes.SELECT },
  )
  return rows.map(row => row.product_id)
}

export interface DailyProductConflicts extends Set<string> {
  repeats: Set<string>
  /** Observability only; never used to relax a conflict. */
  cooldowns?: Set<string>
}

export async function dailyProductConflicts(
  userId: number,
  planId: number | null,
  planUuid: string | null,
  offers: OfferIdentityInput[],
  transaction?: Transaction,
  policy: DailyRepeatPolicy = {},
): Promise<DailyProductConflicts> {
  const conflicts: DailyProductConflicts = Object.assign(new Set<string>(), { repeats: new Set<string>(), cooldowns: new Set<string>() })
  if (!offers.length) return conflicts
  const candidates = offers.map(offer => ({
    aliases: dailyOfferAliases(offer),
    affiliate_url: offer.affiliateUrl?.trim() || null,
    product_id: offer.source?.trim().toLowerCase() === 'mercadolivre'
      ? normalizedMercadoLivreProductId(offer.productId) ?? null : null,
    variant_pattern: dailyVariantPattern(offer),
    variant_title: dailyVariantKey(offer)?.startsWith('title:') ? dailyVariantKey(offer)!.slice(6) : null,
  }))
  const rows = await sequelize.query<{ aliases: string[]; conflict: boolean; repeat: boolean; cooldown: boolean }>(
    `${dailyHistory}, daily_variant_history AS MATERIALIZED (
      SELECT h.*, ${dailyNormalizedTitleSql('h.offer_title')} AS variant_title FROM daily_history h
    )
    SELECT c.aliases, BOOL_OR(${blockedHistory}) AS conflict,
      BOOL_OR(h.status='SENT' AND h.sent_at IS NOT NULL AND :cooldown > 0
        AND h.group_id IN (:groupIds) AND h.sent_at > :cutoff) AS cooldown,
      BOOL_OR(h.status='SENT' AND h.sent_at IS NOT NULL AND :cooldown > 0
        AND h.group_id IN (:groupIds) AND h.sent_at <= :cutoff) AS repeat
    FROM JSONB_TO_RECORDSET(CAST(:candidates AS JSONB)) AS c(aliases TEXT[], product_id TEXT, affiliate_url TEXT, variant_pattern TEXT, variant_title TEXT)
    JOIN daily_variant_history h ON h.offer_identity=ANY(c.aliases) OR h.product_id=c.product_id OR h.offer_url=c.affiliate_url
      OR (c.variant_title IS NOT NULL AND h.variant_title=c.variant_title)
      OR (c.variant_title IS NULL AND c.variant_pattern IS NOT NULL AND h.offer_title ~* c.variant_pattern)
    GROUP BY c.aliases`,
    {
      replacements: { userId, planId, planUuid, candidates: JSON.stringify(candidates), ...historyPolicy(policy) },
      transaction,
      type: QueryTypes.SELECT,
    },
  )
  for (const row of rows) {
    if (row.conflict) row.aliases.forEach(alias => conflicts.add(alias))
    if (row.cooldown) row.aliases.forEach(alias => conflicts.cooldowns!.add(alias))
    if (row.repeat) row.aliases.forEach(alias => conflicts.repeats.add(alias))
  }
  for (const alias of conflicts) conflicts.repeats.delete(alias)
  return conflicts
}

export async function dailyProductHistory(
  userId: number, planId: number, planUuid: string, offer: OfferIdentityInput,
  policy: DailyRepeatPolicy = {}, transaction?: Transaction,
): Promise<{ conflict: boolean; repeat: boolean }> {
  const history = await dailyProductConflicts(userId, planId, planUuid, [offer], transaction, policy)
  return { conflict: history.size > 0, repeat: history.repeats.size > 0 }
}

/** Caller holds the shared delivery-account lock. Ordinary plans keep their repeat semantics. */
export async function hasDailyProductConflict(
  userId: number, planId: number, planUuid: string, offer: OfferIdentityInput,
  transaction: Transaction, policy: DailyRepeatPolicy = {},
): Promise<boolean> {
  return (await dailyProductHistory(userId, planId, planUuid, offer, policy, transaction)).conflict
}
