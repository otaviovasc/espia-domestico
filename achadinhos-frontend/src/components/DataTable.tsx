/*
 * Adapted from shadcn/ui Table, MIT (Copyright (c) 2023 shadcn).
 * https://ui.shadcn.com/r/styles/new-york-v4/table.json
 * https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
 * Semantic application tokens replace registry palette names; native table
 * props, data slots and selection state follow the upstream component.
 */
import type { ComponentProps } from 'react'

export function Table({ className = '', scrollLabel = 'Tabela com rolagem horizontal', ...props }: ComponentProps<'table'> & { scrollLabel?: string }) {
  return (
    <div data-slot="table-container" role="region" aria-label={scrollLabel} tabIndex={0} className="relative w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-xl border-2 border-line-strong bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <table data-slot="table" className={`w-full caption-bottom text-sm ${className}`} {...props} />
    </div>
  )
}

export function TableHeader({ className = '', ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={`bg-surface-muted text-muted [&_tr]:border-b-2 [&_tr]:border-line-strong ${className}`} {...props} />
}

export function TableBody({ className = '', ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={`[&_tr:last-child]:border-b-0 ${className}`} {...props} />
}

export function TableFooter({ className = '', ...props }: ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={`border-t-2 border-line-strong bg-surface-muted font-medium [&>tr]:last:border-b-0 ${className}`} {...props} />
}

export function TableRow({ className = '', ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={`border-b border-line transition-colors hover:bg-surface-muted has-aria-expanded:bg-surface-muted data-[state=selected]:bg-accent-soft motion-reduce:transition-none ${className}`} {...props} />
}

export function TableHead({ className = '', scope = 'col', ...props }: ComponentProps<'th'>) {
  return <th data-slot="table-head" scope={scope} className={`h-11 whitespace-nowrap px-3 py-2 text-left align-middle text-xs font-semibold text-ink [&:has([role=checkbox])]:pr-0 ${className}`} {...props} />
}

export function TableCell({ className = '', ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={`px-3 py-3 align-middle text-ink [&:has([role=checkbox])]:pr-0 ${className}`} {...props} />
}

export function TableCaption({ className = '', ...props }: ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={`p-3 text-left text-sm text-muted ${className}`} {...props} />
}
