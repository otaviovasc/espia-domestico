import { CampaignOffer } from '@/database/models/Campaign'
import { formatPrice, discountPercent } from '@/utils/offerFormatter'

/**
 * Message template engine.
 *
 * A template is plain text with `{placeholders}`. Conditional blocks let a line
 * disappear when its data is absent:
 *
 *   {?original}~{original}~ ➡️ {/original}*{price}*{?discount} ({discount} OFF){/discount}
 *
 * `{?key}...{/key}` renders the inner text only when `key` has a value.
 */

export interface TemplateContext {
  title: string
  price: string
  original: string
  discount: string
  installment: string
  commission: string
  coupon: string
  url: string
  currency: string
}

/** Available placeholders, surfaced to the UI as insertable chips. */
export const TEMPLATE_PLACEHOLDERS: { key: keyof TemplateContext; label: string }[] = [
  { key: 'title', label: 'Título' },
  { key: 'price', label: 'Preço' },
  { key: 'original', label: 'Preço original' },
  { key: 'discount', label: 'Desconto %' },
  { key: 'installment', label: 'Parcelamento' },
  { key: 'commission', label: 'Comissão' },
  { key: 'coupon', label: 'Cupom' },
  { key: 'url', label: 'Link' },
]

/** The default template — mirrors the previous hardcoded format, richer. */
export const DEFAULT_TEMPLATE = [
  '🔥 *{title}*',
  '{?original}~{original}~ ➡️ {/original}*{price}*{?discount}  ({discount} OFF 🤑){/discount}',
  '{?installment}💳 {installment}{/installment}',
  '{?coupon}',
  '🎟️ Cupom: *{coupon}*{/coupon}',
  '',
  '👉 {url}',
].join('\n')

function buildContext(offer: CampaignOffer): TemplateContext {
  const currency = offer.currency || 'BRL'
  const pct = discountPercent(offer.originalPrice, offer.discountedPrice)
  return {
    title: offer.title.trim(),
    price: formatPrice(offer.discountedPrice, currency),
    original: offer.originalPrice ? formatPrice(offer.originalPrice, currency) : '',
    discount: pct ? `${pct}%` : '',
    installment: offer.installmentLabel?.trim() ?? '',
    commission: offer.commissionPercent?.trim() ?? '',
    coupon: offer.coupon?.trim() ?? '',
    url: offer.affiliateUrl.trim(),
    currency,
  }
}

/** Render `{?key}...{/key}` conditional blocks based on non-empty context values. */
function renderConditionals(template: string, ctx: TemplateContext): string {
  return template.replace(
    /\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g,
    (_match, key: string, inner: string) => {
      const value = ctx[key as keyof TemplateContext]
      return value && String(value).trim() !== '' ? inner : ''
    },
  )
}

/** Replace `{key}` placeholders with context values (unknown keys left blank). */
function renderPlaceholders(template: string, ctx: TemplateContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = ctx[key as keyof TemplateContext]
    return value !== undefined ? String(value) : ''
  })
}

/** Collapse the blank lines left behind by empty conditional blocks. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Render a campaign message for one offer. Falls back to DEFAULT_TEMPLATE when
 * no custom template is given.
 */
export function renderOfferMessage(offer: CampaignOffer, template?: string | null): string {
  const tpl = template && template.trim() ? template : DEFAULT_TEMPLATE
  const ctx = buildContext(offer)
  return tidy(renderPlaceholders(renderConditionals(tpl, ctx), ctx))
}
