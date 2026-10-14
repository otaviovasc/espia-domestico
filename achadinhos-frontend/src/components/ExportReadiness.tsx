import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import type { AdExportReadiness } from '@/lib/adExportReadiness'

export function ExportReadiness({ readiness }: { readiness: AdExportReadiness }) {
  const { blockers, advisories, latestMatchingJob } = readiness
  const count = blockers.length + advisories.length
  const status = blockers.length ? `${blockers.length} ${blockers.length === 1 ? 'ajuste antes de gerar' : 'ajustes antes de gerar'}` : 'Pronto para gerar'
  return (
    <details className="w-full text-xs text-zinc-600">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        {blockers.length ? <CircleAlert size={14} className="shrink-0 text-amber-700" /> : <Check size={14} className="shrink-0 text-emerald-700" />}
        <span role="status" className="font-medium text-zinc-800">{status}</span>
        {advisories.length > 0 ? <span>{advisories.length} {advisories.length === 1 ? 'aviso' : 'avisos'}</span> : null}
        <ChevronDown size={13} className="ml-auto shrink-0" />
      </summary>
      <div className="space-y-3 border-t border-zinc-100 py-2">
        {blockers.length > 0 ? <div><p className="font-medium text-amber-900">Antes de gerar</p><ul className="mt-1 space-y-1">{blockers.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul></div> : null}
        {advisories.length > 0 ? <div><p className="font-medium text-zinc-800">Confira na prévia</p><ul className="mt-1 space-y-1">{advisories.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul></div> : null}
        {count === 0 ? <p>As mídias e os ajustes estão prontos para gerar. Confira a prévia antes de publicar.</p> : null}
        <p className="text-zinc-500">{latestMatchingJob ? 'Há arquivos gerados com estes mesmos ajustes.' : 'Estes ajustes ainda não têm uma exportação concluída.'}</p>
      </div>
    </details>
  )
}
