import type { Campaign } from '@/lib/api'

const statuses: Record<Campaign['status'], { label: string; className: string; description: string }> = {
  DRAFT: { label: 'Rascunho', className: 'bg-surface-muted text-muted', description: 'Revise os produtos e os grupos antes de iniciar o envio.' },
  SCHEDULED: { label: 'Agendada', className: 'bg-info-soft text-info', description: 'O envio começará no horário agendado.' },
  RUNNING: { label: 'Enviando', className: 'bg-accent-soft text-accent', description: 'Acompanhe as entregas e o próximo envio abaixo.' },
  PAUSED: { label: 'Pausada', className: 'bg-warning-soft text-warning', description: 'Os envios estão pausados. Retome quando estiver pronto.' },
  COMPLETED: { label: 'Concluída', className: 'bg-success-soft text-success', description: 'O processamento terminou. Confira os resultados de cada envio.' },
  FAILED: { label: 'Falhou', className: 'bg-danger-soft text-danger', description: 'Confira o registro de envios antes de tentar novamente.' },
  CANCELLED: { label: 'Cancelada', className: 'bg-surface-muted text-muted', description: 'Os envios pendentes desta campanha foram cancelados.' },
}

export function CampaignStatus({ status, stalled = false }: { status: Campaign['status']; stalled?: boolean }) {
  const item = statuses[status]
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${stalled ? 'bg-warning-soft text-warning' : item.className}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{stalled ? 'Envio interrompido' : item.label}</span>
}

export function CampaignStatusDescription({ status }: { status: Campaign['status'] }) {
  return <>{statuses[status].description}</>
}
