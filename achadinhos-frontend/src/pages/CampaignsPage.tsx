import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, Search, Package, RefreshCw } from 'lucide-react'
import { apiErrorMessage, campaignApi, type Campaign } from '@/lib/api'
import { Button, Spinner } from '@/components/ui'
import { CampaignStatus } from '@/components/CampaignStatus'

export default function CampaignsPage() {
  const query = useQuery({ queryKey: ['campaigns'], queryFn: campaignApi.list })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const campaigns = query.data?.items ?? []
  const filtered = campaigns.filter((c) => c.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')) && (status === 'all' || (status === 'active' ? ['RUNNING', 'SCHEDULED', 'PAUSED'].includes(c.status) : c.status === status)))

  return (
    <div className="workspace-page max-w-6xl">
      <header className="page-header">
        <div><h1 className="page-title">Campanhas</h1><p className="page-description">Acompanhe os produtos, os grupos de destino e o resultado dos envios.</p></div>
        <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" to="/compose"><Plus size={16} />Nova campanha</Link>
      </header>

      {query.isLoading && <div role="status" className="surface-panel flex items-center gap-3 p-6 text-sm text-muted"><Spinner />Carregando campanhas…</div>}
      {query.isError && <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"><p className="font-semibold">Não foi possível carregar as campanhas.</p><p className="mt-1">{apiErrorMessage(query.error)}</p><Button variant="secondary" className="mt-3" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={16} />Tentar novamente</Button></div>}
      {query.data && campaigns.length === 0 && <div className="surface-panel flex flex-col items-start gap-3 p-6"><Package className="text-muted" size={28} /><h2 className="section-heading">Sua primeira campanha começa com os produtos</h2><p className="max-w-lg text-sm text-muted">Selecione os produtos, revise a mensagem e escolha os grupos que receberão as ofertas.</p><Link to="/compose" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent underline underline-offset-4">Criar campanha<ArrowRight size={16} /></Link></div>}
      {campaigns.length > 0 && <>
        <div className="workspace-toolbar mb-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 flex-1"><label htmlFor="campaign-search" className="field-label">Buscar campanha</label><div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-subtle" /><input id="campaign-search" className="field-control w-full pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome da campanha" /></div></div>
          <div><label htmlFor="campaign-status" className="field-label">Situação</label><select id="campaign-status" className="field-control w-full" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todas</option><option value="active">Em andamento ou pausadas</option><option value="DRAFT">Rascunhos</option><option value="COMPLETED">Concluídas</option><option value="FAILED">Falhas</option><option value="CANCELLED">Canceladas</option></select></div>
        </div>
        <p role="status" className="mb-3 text-sm text-muted">{filtered.length} de {campaigns.length} campanhas na lista</p>
        <div className="surface-panel overflow-hidden divide-y divide-line">
          {filtered.map((c: Campaign) => <Link key={c.id} to={`/campaigns/${c.id}`} className="group grid min-w-0 gap-4 p-4 outline-offset-[-3px] transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-muted">{c.offers[0]?.imageUrl ? <img src={c.offers[0].imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" /> : <Package size={24} className="text-subtle" />}</div>
              <div className="min-w-0"><div className="flex flex-wrap items-start gap-2"><h2 className="break-words text-base font-semibold text-ink group-hover:text-accent">{c.name}</h2><CampaignStatus status={c.status} stalled={c.status === 'RUNNING' && c.stalled} /></div><p className="mt-1 text-sm text-muted">{c.offers.length} produtos para {c.groups.length} grupos</p><p className="mt-1 text-xs text-subtle tabular-nums">{c.scheduledAt ? `Agendada para ${new Date(c.scheduledAt).toLocaleString('pt-BR')}` : `Criada em ${new Date(c.createdAt).toLocaleString('pt-BR')}`}</p></div>
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-line pt-3 sm:border-0 sm:pt-0"><div className="flex gap-5 text-sm tabular-nums"><div><span className="block font-semibold text-success">{c.totalSent}</span><span className="text-xs text-muted">Envios realizados</span></div><div><span className={`block font-semibold ${c.totalFailed > 0 ? 'text-danger' : 'text-muted'}`}>{c.totalFailed}</span><span className="text-xs text-muted">Falhas</span></div></div><ArrowRight size={18} className="shrink-0 text-subtle group-hover:text-accent" aria-hidden="true" /></div>
          </Link>)}
          {filtered.length === 0 && <p className="p-6 text-sm text-muted">Nenhuma campanha corresponde à busca. Altere o nome ou a situação.</p>}
        </div>
      </>}
    </div>
  )
}
