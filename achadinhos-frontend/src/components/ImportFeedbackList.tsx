import { useState } from 'react'
import { Button } from './ui'

export function ImportFeedbackList({ title, entries }: { title: string; entries: { key: number; message: string }[] }) {
  const [page, setPage] = useState(1)
  if (!entries.length) return null
  const pageCount = Math.max(1, Math.ceil(entries.length / 40))
  const currentPage = Math.min(page, pageCount)
  return (
    <details className="mt-3 rounded-lg border border-line bg-warning-soft p-3 text-sm text-warning">
      <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">{title} ({entries.length})</summary>
      <ul className="mt-2 max-h-64 list-disc space-y-2 overflow-y-auto break-words pl-5">
        {entries.slice((currentPage - 1) * 40, currentPage * 40).map((entry) => <li key={entry.key}>{entry.message}</li>)}
      </ul>
      {pageCount > 1 && <div className="mt-2 flex items-center justify-between gap-3">
        <Button variant="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button>
        <span>Página {currentPage} de {pageCount}</span>
        <Button variant="secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</Button>
      </div>}
    </details>
  )
}
