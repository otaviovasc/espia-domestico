import { createHash } from 'crypto'

export interface OfferIdentityInput {
  savedProductId?: number
  source?: string
  productId?: string
  affiliateUrl: string
}

export function normalizedOfferSource(source?: string): string {
  return source?.trim().toLowerCase() || 'generic'
}

/** Canonical, source-aware product identity used by the delivery ledger. */
export function offerIdentity(input: OfferIdentityInput): string {
  if (input.savedProductId) {
    return createHash('sha256').update(`savedProduct:${input.savedProductId}`).digest('hex')
  }
  const productId = input.productId?.trim()
  const canonical = productId
    ? JSON.stringify(['product', normalizedOfferSource(input.source), productId])
    : JSON.stringify(['url', input.affiliateUrl.trim()])
  return createHash('sha256').update(canonical).digest('hex')
}

/** Canonical identity plus the pre-catalog alias used by legacy sends. */
export function offerIdentityAliases(input: OfferIdentityInput): string[] {
  const canonical = offerIdentity(input)
  if (!input.savedProductId) return [canonical]
  const legacy = offerIdentity({
    source: input.source,
    productId: input.productId,
    affiliateUrl: input.affiliateUrl,
  })
  return legacy === canonical ? [canonical] : [canonical, legacy]
}

/** Backwards-compatible response-map key consumed by the current frontend. */
export function offerResultKey(input: OfferIdentityInput): string {
  if (input.savedProductId) return `saved:${input.savedProductId}`
  const productId = input.productId?.trim()
  if (!productId) return input.affiliateUrl.trim()
  return input.source?.trim()
    ? JSON.stringify([normalizedOfferSource(input.source), productId])
    : productId
}
