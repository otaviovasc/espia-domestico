import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { campaignApi, type Campaign } from '@/lib/api'
import { Card, Badge, Spinner } from '@/components/ui'

function statusBadge(status: Campaign['status']) {
  const map: Record<Campaign['status'], { tone: 'zinc' | 'green' | 'red' | 'amber' | 'violet' | 'blue'; label: string }> = {
    DRAFT: { tone: 'zinc', label: 'Rascunho' },
    SCHEDULED: { tone: 'blue', label: 'Agendada' },
    RUNNING: { tone: 'amber', label: 'Enviando' },
    PAUSED: { tone: 'amber', label: 'Pausada' },
    COMPLETED: { tone: 'green', label: 'Concluída' },
    FAILED: { tone: 'red', label: 'Falhou' },
    CANCELLED: { tone: 'zinc', label: 'Cancelada' },
  }
  const { tone, label } = map[status]
  return <Badge tone={tone}>{label}</Badge>
}

export default function CampaignsPage() {
  const query = useQuery({ queryKey: ['campaigns'], queryFn: campaignApi.list })

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Campanhas</h1>
      {query.isLoading && <Spinner />}
      {query.data && query.data.items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-zinc-500">
            Nenhuma campanha ainda. Crie uma em "Nova campanha".
          </p>
        </Card>
      )}
      <div className="space-y-3">
        {query.data?.items.map((c) => (
          <Link key={c.id} to={`/campaigns/${c.id}`}>
            <Card className="transition hover:border-violet-300">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    {statusBadge(c.status)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {c.offers.length} produto(s) · {c.groups.length} grupo(s) ·{' '}
                    {new Date(c.createdAt).toLocaleString('pt-BR')}
                    {c.scheduledAt && ` · agendada p/ ${new Date(c.scheduledAt).toLocaleString('pt-BR')}`}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-green-600">{c.totalSent} enviadas</div>
                  {c.totalFailed > 0 && <div className="text-red-600">{c.totalFailed} falhas</div>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
