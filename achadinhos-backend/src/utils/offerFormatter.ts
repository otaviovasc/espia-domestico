import { CampaignOffer } from '@/database/models/Campaign'

/** Format a numeric price in the given currency (defaults to BRL). */
export function formatPrice(value: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
  } catch {
    // Unknown currency code — fall back to a plain formatted number.
    return `${currency} ${value.toFixed(2)}`
  }
}

/** Discount percentage (integer) between original and discounted price. */
export function discountPercent(original?: number, discounted?: number): number | null {
  if (!original || !discounted || original <= 0 || discounted >= original) return null
  return Math.round(((original - discounted) / original) * 100)
}

/**
 * Build the WhatsApp caption/text for a product offer.
 *
 * Example:
 *   🔥 *Fone Bluetooth XYZ*
 *   ~R$199,90~ ➡️ *R$99,90*  (50% OFF 🤑)
 *
 *   Bateria de 30h, cancelamento de ruído.
 *
 *   🎟️ Cupom: *ACHOU10*
 *   👉 https://...
 */
export function formatOfferMessage(offer: CampaignOffer): string {
  const currency = offer.currency || 'BRL'
  const lines: string[] = []

  lines.push(`🔥 *${offer.title.trim()}*`)

  const pct = discountPercent(offer.originalPrice, offer.discountedPrice)
  const discounted = formatPrice(offer.discountedPrice, currency)
  if (offer.originalPrice && pct) {
    const original = formatPrice(offer.originalPrice, currency)
    lines.push(`~${original}~ ➡️ *${discounted}*  (${pct}% OFF 🤑)`)
  } else {
    lines.push(`💰 *${discounted}*`)
  }

  if (offer.description && offer.description.trim()) {
    lines.push('')
    lines.push(offer.description.trim())
  }

  if (offer.coupon && offer.coupon.trim()) {
    lines.push('')
    lines.push(`🎟️ Cupom: *${offer.coupon.trim()}*`)
  }

  lines.push('')
  lines.push(`👉 ${offer.affiliateUrl.trim()}`)

  return lines.join('\n')
}
