import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, History } from 'lucide-react'
import { apiErrorMessage, campaignApi, type Offer, type OfferGroupDelivery } from '@/lib/api'

interface ProductDeliveryStatusProps {
  groups: OfferGroupDelivery[]
  savedProductId?: number
  offer?: Pick<Offer, 'source' | 'productId' | 'affiliateUrl'>
  groupNames?: ReadonlyMap<string, string>
  emptyLabel?: string
  compact?: boolean
}

const STATUS_COPY = {
  unsent: 'Pronto para enviar',
  sending: 'Em campanha',
  sent: 'Já enviado',
} as const

function StatusIcon({ status }: { status: OfferGroupDelivery['status'] }) {
  if (status === 'sent') return <History size={13} className="shrink-0 text-amber-600" />
  if (status === 'sending') return <CalendarClock size={13} className="shrink-0 text-blue-600" />
  return <CheckCircle2 size={13} className="shrink-0 text-green-600" />
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const days = Math.floor(diff / 86_400_000)
  if (days >= 1) return `há ${days} dia${days > 1 ? 's' : ''}`
  const hours = Math.floor(diff / 3_600_000)
  if (hours >= 1) return `há ${hours}h`
  const minutes = Math.floor(diff / 60_000)
  return `há ${Math.max(1, minutes)} min`
}

export function ProductDeliveryStatus({
  groups,
  savedProductId,
  offer,
  groupNames,
  emptyLabel = 'Sem histórico nos grupos selecionados',
  compact = false,
}: ProductDeliveryStatusProps) {
  const queryClient = useQueryClient()
  const [resolutionError, setResolutionError] = useState<string | null>(null)
  const [pendingResolution, setPendingResolution] = useState<{
    groupId: string
    resolution: 'sent' | 'retry'
  } | null>(null)
  const resolveClaim = useMutation({
    mutationFn: ({ groupId, resolution }: { groupId: string; resolution: 'sent' | 'retry' }) => {
      const identity = savedProductId
        ? { savedProductId }
        : offer
          ? { offer }
          : null
      if (!identity) throw new Error('Oferta sem identificação para resolver o envio')
      return campaignApi.resolveDeliveryClaim(identity, groupId, resolution)
    },
    onSuccess: async () => {
      setResolutionError(null)
      setPendingResolution(null)
      await queryClient.invalidateQueries({ queryKey: ['offer-group-delivery'] })
    },
    onError: (cause) => setResolutionError(apiErrorMessage(cause)),
  })

  if (groups.length === 0) {
    return <span className="text-xs text-zinc-400">{emptyLabel}</span>
  }

  const ready = groups.filter((group) => group.status === 'unsent').length
  const sent = groups.filter((group) => group.status === 'sent').length
  const sending = groups.filter((group) => group.status === 'sending' && !group.recoverable).length
  const ambiguous = groups.filter((group) => group.claimStatus === 'unconfirmed' && group.recoverable).length

  return (
    <details className="group/delivery" open={!compact && groups.length <= 4}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-xs marker:hidden">
        {ready > 0 && <span className="font-medium text-green-700">{ready} a enviar</span>}
        {sent > 0 && <span className="font-medium text-amber-700">{sent} enviado{sent > 1 ? 's' : ''}</span>}
        {sending > 0 && <span className="font-medium text-blue-700">{sending} em campanha</span>}
        {ambiguous > 0 && <span className="font-medium text-red-700">{ambiguous} sem confirmação</span>}
        <CircleDashed size={12} className="text-zinc-400 transition group-open/delivery:rotate-90" />
      </summary>
      <ul className="mt-2 max-h-40 min-w-52 space-y-1 overflow-y-auto rounded-md border border-zinc-100 bg-white p-2 shadow-sm">
        {groups.map((group) => (
          <li key={group.groupId} className="flex items-start gap-1.5 text-xs">
            {group.claimStatus === 'unconfirmed' && group.recoverable
              ? <AlertTriangle size={13} className="shrink-0 text-red-600" />
              : <StatusIcon status={group.status} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-zinc-700" title={groupNames?.get(group.groupId) ?? group.groupName}>
                {groupNames?.get(group.groupId) ?? group.groupName}
              </span>
              <span className="text-zinc-500">
                {group.claimStatus === 'unconfirmed' && group.recoverable
                  ? 'Envio sem confirmação — verifique no WhatsApp antes de reenviar'
                  : group.status === 'sending' && group.claimStatus === 'unconfirmed'
                    ? 'Envio em andamento'
                    : STATUS_COPY[group.status]}
                {group.status === 'sent' && group.sentCount > 1 ? ` ${group.sentCount}×` : ''}
                {group.lastSentAt ? ` · ${timeAgo(group.lastSentAt)}` : ''}
                {group.claimStatus === 'unconfirmed' && group.recoverable && group.claimCreatedAt
                  ? ` · iniciado ${timeAgo(group.claimCreatedAt)}`
                  : ''}
                {group.status === 'sending' && group.activeCampaignNames.length > 0
                  ? ` · ${group.activeCampaignNames.join(', ')}`
                  : ''}
              </span>
              {group.claimStatus === 'unconfirmed' && group.recoverable && (savedProductId || offer) && (
                pendingResolution?.groupId === group.groupId ? (
                  <span className="mt-1 block rounded bg-amber-50 p-2 text-amber-900">
                    {pendingResolution.resolution === 'sent'
                      ? 'Verifique no WhatsApp se a oferta aparece neste grupo. Confirmar impedirá novos envios.'
                      : 'Verifique no WhatsApp se a oferta não foi enviada. Liberar permitirá uma nova tentativa.'}
                    <span className="mt-1 flex gap-2">
                      <button
                        type="button"
                        disabled={resolveClaim.isPending}
                        onClick={() => resolveClaim.mutate(pendingResolution)}
                        className="font-semibold underline disabled:opacity-50"
                      >
                        {resolveClaim.isPending
                          ? 'Atualizando…'
                          : pendingResolution.resolution === 'sent'
                            ? 'Verifiquei: foi enviado'
                            : 'Verifiquei: pode tentar novamente'}
                      </button>
                      <button type="button" disabled={resolveClaim.isPending} onClick={() => setPendingResolution(null)} className="text-zinc-600 underline disabled:opacity-50">Cancelar</button>
                    </span>
                  </span>
                ) : (
                  <span className="mt-1 flex flex-wrap gap-2">
                    <button type="button" disabled={resolveClaim.isPending} onClick={() => { setResolutionError(null); setPendingResolution({ groupId: group.groupId, resolution: 'sent' }) }} className="font-medium text-amber-700 underline disabled:opacity-50">Confirmar que enviou</button>
                    <button type="button" disabled={resolveClaim.isPending} onClick={() => { setResolutionError(null); setPendingResolution({ groupId: group.groupId, resolution: 'retry' }) }} className="font-medium text-violet-700 underline disabled:opacity-50">Liberar para tentar novamente</button>
                  </span>
                )
              )}
            </span>
          </li>
        ))}
        {resolutionError && <li role="alert" className="text-xs text-red-700">{resolutionError}</li>}
      </ul>
    </details>
  )
}
