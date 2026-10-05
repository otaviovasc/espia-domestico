import { Link } from 'react-router-dom'
import type { ExtensionEvidence } from '@/lib/extensionEvidence'
import { extensionVideoSummary } from '@/lib/extensionEvidence'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const videoStatusLabels: Record<string, string> = {
  pending: 'na fila', scanning: 'procurando vídeos', downloading: 'baixando vídeos',
  shortfall: 'menos vídeos que o solicitado', needs_attention: 'aguardando desafio ou login',
  failed: 'falhou', cancelled: 'cancelada', interrupted: 'interrompida',
}

export function ProductExtensionEvidence({ evidence }: { evidence?: ExtensionEvidence }) {
  const videos = extensionVideoSummary(evidence)
  if (!evidence?.commission && !videos) return null
  return <div className="mt-1 space-y-1 text-xs font-normal text-zinc-500">
    {evidence?.commission?.estimatedBrl != null && <p title="Preço atual na captura × comissão exibida. O pagamento real pode variar.">Comissão estimada na captura: {money.format(evidence.commission.estimatedBrl)} ({evidence.commission.percent}%)</p>}
    {videos && <details>
      <summary className="cursor-pointer text-violet-700">{videos.completed}{videos.requested ? `/${videos.requested}` : ''} vídeo(s) baixado(s) na extensão</summary>
      <p className="mt-1 max-w-sm">Envie os arquivos de Downloads/mercado-livre-videos na <Link to="/ads" className="text-violet-700 underline">Biblioteca de anúncios</Link>. O JSON preserva os recibos; os vídeos precisam ser enviados separadamente. Arquivos TS são convertidos para MP4; cada clipe pode ter até 2 minutos.</p>
      {videos.status !== 'complete' && <p className="mt-1">Coleta: {videoStatusLabels[videos.status] || 'em andamento'}.</p>}
    </details>}
  </div>
}
