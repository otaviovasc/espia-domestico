import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import type { AdExportReadiness } from '@/lib/adExportReadiness'

export function ExportReadiness({ readiness }: { readiness: AdExportReadiness }) {
  const { blockers, advisories, latestMatchingJob } = readiness
  const count = blockers.length + advisories.length
  const status = blockers.length ? `${blockers.length} ${blockers.length === 1 ? 'ajuste antes de gerar' : 'ajustes antes de gerar'}` : 'Pronto para gerar'
  return (
    <details className="group w-full rounded-lg border border-line bg-surface px-3 text-xs text-muted">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {blockers.length ? <CircleAlert size={16} aria-hidden="true" className="shrink-0 text-warning" /> : <Check size={16} aria-hidden="true" className="shrink-0 text-success" />}
        <span role="status" className="font-medium text-ink">{status}</span>
        {advisories.length > 0 ? <span>{advisories.length} {advisories.length === 1 ? 'aviso' : 'avisos'}</span> : null}
        <ChevronDown size={16} aria-hidden="true" className="ml-auto shrink-0 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-line py-2">
        {blockers.length > 0 ? <div><p className="font-medium text-warning">Antes de gerar</p><ul className="mt-1 list-disc space-y-1 pl-4">{blockers.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul></div> : null}
        {advisories.length > 0 ? <div><p className="font-medium text-ink">Confira na prévia</p><ul className="mt-1 list-disc space-y-1 pl-4">{advisories.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul></div> : null}
        {count === 0 ? <p>As mídias e os ajustes estão prontos para gerar. Confira a prévia antes de publicar.</p> : null}
        <p className="text-muted">{latestMatchingJob ? 'Há arquivos gerados com estes mesmos ajustes.' : 'Estes ajustes ainda não têm uma exportação concluída.'}</p>
      </div>
    </details>
  )
}
