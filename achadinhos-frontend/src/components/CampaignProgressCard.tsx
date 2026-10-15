import { useEffect, useState } from 'react'
import { Clock, Send, CheckCircle2, XCircle, SkipForward, Timer, Flag } from 'lucide-react'
import type { CampaignProgress } from '@/lib/api'

/** "há 2 min", "em 45s", "agora" from an ISO time relative to now. */
function relative(iso: string | null, tickMs: number): string {
  if (!iso) return '—'
  void tickMs // dependency to re-render on tick
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const s = Math.round(abs / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  let phrase: string
  if (s < 10) phrase = 'agora'
  else if (s < 60) phrase = `${s}s`
  else if (m < 60) phrase = `${m} min${s % 60 ? ` ${s % 60}s` : ''}`
  else phrase = `${h}h ${m % 60}min`
  if (phrase === 'agora') return 'agora'
  return diff >= 0 ? `em ${phrase}` : `há ${phrase}`
}

function clockTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Send
  label: string
  value: number | string
  tone: string
}) {
  return (
    <div className="flex items-center gap-2 border-l-2 border-line pl-3 py-1">
      <Icon size={16} className={tone} />
      <div className="leading-tight">
        <div className="text-base font-semibold tabular-nums text-ink">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </div>
  )
}

export function CampaignProgressCard({ progress }: { progress: CampaignProgress }) {
  // Tick every second so the ETA/countdown stays live.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (progress.status !== 'RUNNING' || progress.stalled) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [progress.status, progress.stalled])

  const { totalPlanned, sent, failed, skipped, remaining } = progress
  const done = Math.min(sent + failed + skipped, totalPlanned)
  const pct = totalPlanned > 0 ? Math.min(100, Math.round((done / totalPlanned) * 100)) : 0
  const resends = progress.resends ?? Math.max(0, (progress.totalSends ?? sent) - sent)
  const isRunning = progress.status === 'RUNNING'
  const running = isRunning && !progress.stalled && remaining > 0

  return (
    <div className="surface-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Progresso do envio</h2>
        <span className="text-sm text-muted">
          <span className="font-semibold tabular-nums text-ink">{done} de {totalPlanned}</span> processados ({pct}%)
        </span>
      </div>

      <div role="progressbar" aria-label="Combinações de produto e grupo processadas" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${done} de ${totalPlanned} processados, ${sent} enviados, ${failed} falhas, ${skipped} ignorados`} className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-muted">Cada combinação de produto e grupo é contada uma vez. O progresso inclui envios, falhas e itens ignorados.</p>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={CheckCircle2} label="Enviadas" value={sent} tone="text-success" />
        <Stat icon={XCircle} label="Falhas" value={failed} tone="text-danger" />
        <Stat icon={SkipForward} label="Ignoradas" value={skipped} tone="text-subtle" />
        <Stat icon={Send} label="Restantes" value={remaining} tone="text-accent" />
      </div>
      {resends > 0 && (
        <p className="mt-2 text-xs text-warning">
          +{resends} reenvio(s) além dos pares únicos — o progresso conta cada par uma vez.
        </p>
      )}

      {/* Next-send ETA — the key info while running */}
      {running && (
        <div className="mt-4 rounded-lg border border-line bg-accent-soft p-4">
          <div className="flex items-center gap-2 text-accent">
            <Timer size={18} />
            <span className="font-semibold">Próxima mensagem</span>
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-accent">
            {relative(progress.nextSendEtaMinAt, tick)}
            {progress.nextSendEtaMaxAt &&
              progress.nextSendEtaMaxAt !== progress.nextSendEtaMinAt && (
                <span className="text-base font-medium text-accent">
                  {' '}
                  – {relative(progress.nextSendEtaMaxAt, tick)}
                </span>
              )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
            <div className="flex items-center gap-1.5">
              <Clock size={14} className="text-subtle" />
              Última: {progress.lastSentAt ? relative(progress.lastSentAt, tick) : '—'}
            </div>
            <div className="flex items-center gap-1.5">
              <Send size={14} className="text-subtle" />
              Intervalo médio ~{progress.avgIntervalSeconds}s
            </div>
            <div className="flex items-center gap-1.5">
              <Flag size={14} className="text-subtle" />
              Conclusão ~{clockTime(progress.estimatedCompletionAt)}
              {progress.estimatedCompletionAt && (
                <span className="text-subtle"> ({relative(progress.estimatedCompletionAt, tick)})</span>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-subtle">
            Estimativas — o envio tem variação aleatória, aquecimento e limite por hora.
          </p>
        </div>
      )}

      {isRunning && progress.stalled && (
        <div className="mt-4 rounded-xl bg-warning-soft p-4 text-sm text-warning">
          Envio interrompido (o servidor reiniciou). Use <strong>Retomar envio</strong> para
          continuar de onde parou.
        </div>
      )}

      {progress.status === 'COMPLETED' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 size={16} /> Campanha concluída.
        </div>
      )}
    </div>
  )
}
