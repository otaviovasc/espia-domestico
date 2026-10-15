import type { ReactNode } from 'react'
import { Package } from 'lucide-react'
import type { Offer } from '@/lib/api'
import { Badge } from '@/components/ui'

const categoryTones = { A: 'green', B: 'blue', C: 'amber', D: 'red' } as const
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function CampaignOfferRow({ offer, delivery, actions }: { offer: Offer; delivery: ReactNode; actions: ReactNode }) {
  return <div className="flex min-w-0 gap-3 border-b border-line py-4 last:border-0">
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-muted">{offer.imageUrl ? <img src={offer.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" /> : <Package className="text-subtle" size={22} />}</div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><p className="min-w-0 flex-1 break-words text-sm font-medium text-ink">{offer.title}</p><p className="text-sm font-semibold tabular-nums text-ink">{offer.discountedPrice === undefined ? 'Preço não informado' : currency.format(offer.discountedPrice)}</p></div><div className="mt-2 flex flex-wrap items-center gap-2">{offer.category && <span title={typeof offer.relevanceScore === 'number' ? `Relevância ${offer.relevanceScore}/100` : undefined}><Badge tone={categoryTones[offer.category]}>Categoria {offer.category}</Badge></span>}{offer.commissioned === false && <Badge tone="amber">Sem comissão</Badge>}</div><div className="mt-2 min-w-0 text-sm">{delivery}</div><div className="mt-2 flex flex-wrap gap-2">{actions}</div></div>
  </div>
}
