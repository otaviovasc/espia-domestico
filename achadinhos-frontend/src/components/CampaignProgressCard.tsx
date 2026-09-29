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
    <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2">
      <Icon size={16} className={tone} />
      <div className="leading-tight">
        <div className="text-sm font-semibold text-zinc-800">{value}</div>
        <div className="text-[11px] text-zinc-500">{label}</div>
      </div>
    </div>
  )
}

export function CampaignProgressCard({ progress }: { progress: CampaignProgress }) {
  // Tick every second so the ETA/countdown stays live.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const { totalPlanned, sent, failed, skipped, remaining } = progress
  const done = sent + failed + skipped
  const pct = totalPlanned > 0 ? Math.round((done / totalPlanned) * 100) : 0
  const isRunning = progress.status === 'RUNNING'
  const running = isRunning && !progress.stalled && remaining > 0

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Progresso do envio</h2>
        <span className="text-sm text-zinc-500">
          {done} / {totalPlanned} ({pct}%)
        </span>
      </div>

      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="brand-gradient h-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={CheckCircle2} label="enviadas" value={sent} tone="text-green-600" />
        <Stat icon={XCircle} label="falhas" value={failed} tone="text-red-500" />
        <Stat icon={SkipForward} label="ignoradas" value={skipped} tone="text-zinc-400" />
        <Stat icon={Send} label="restantes" value={remaining} tone="text-violet-600" />
      </div>

      {/* Next-send ETA — the key info while running */}
      {running && (
        <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 p-4">
          <div className="flex items-center gap-2 text-violet-800">
            <Timer size={18} />
            <span className="font-semibold">Próxima mensagem</span>
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-violet-700">
            {relative(progress.nextSendEtaMinAt, tick)}
            {progress.nextSendEtaMaxAt &&
              progress.nextSendEtaMaxAt !== progress.nextSendEtaMinAt && (
                <span className="text-base font-medium text-violet-500">
                  {' '}
                  – {relative(progress.nextSendEtaMaxAt, tick)}
                </span>
              )}
          </div>
          <div className="mt-2 grid gap-2 text-sm text-zinc-600 sm:grid-cols-3">
            <div className="flex items-center gap-1.5">
              <Clock size={14} className="text-zinc-400" />
              Última: {progress.lastSentAt ? relative(progress.lastSentAt, tick) : '—'}
            </div>
            <div className="flex items-center gap-1.5">
              <Send size={14} className="text-zinc-400" />
              Intervalo médio ~{progress.avgIntervalSeconds}s
            </div>
            <div className="flex items-center gap-1.5">
              <Flag size={14} className="text-zinc-400" />
              Conclusão ~{clockTime(progress.estimatedCompletionAt)}
              {progress.estimatedCompletionAt && (
                <span className="text-zinc-400"> ({relative(progress.estimatedCompletionAt, tick)})</span>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">
            Estimativas — o envio tem variação aleatória, aquecimento e limite por hora.
          </p>
        </div>
      )}

      {isRunning && progress.stalled && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Envio interrompido (o servidor reiniciou). Use <strong>Retomar envio</strong> para
          continuar de onde parou.
        </div>
      )}

      {progress.status === 'COMPLETED' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 size={16} /> Campanha concluída.
        </div>
      )}
    </div>
  )
}
