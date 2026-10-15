import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variantClass: Record<ButtonVariant, string> = {
  primary: 'border-line-strong bg-accent text-accent-foreground hover:bg-accent/95',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
  danger: 'border-danger bg-danger-soft text-danger hover:bg-danger/15',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-muted hover:text-ink',
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  loading = false,
  loadingText,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; loadingText?: string }) {
  // Pending contract adapted from Cult UI Halo Button (MIT, Jordan-Gilliam).
  // The local button retains its native type behavior and restrained visual design.
  const pendingLabel = loadingText ?? 'Processando…'
  const hasPendingLabel = loading || loadingText !== undefined
  return (
    <button
      {...props}
      data-variant={variant}
      data-loading={loading || undefined}
      aria-busy={loading || props['aria-busy']}
      disabled={disabled || loading}
      className={`ui-button inline-flex shrink-0 items-center justify-center gap-2 border-2 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${variantClass[variant]} ${className}`}
    >
      {hasPendingLabel ? (
        <span className="inline-grid items-center">
          <span aria-hidden={loading || undefined} className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 ${loading ? 'invisible' : ''}`}>{children}</span>
          <span aria-hidden={!loading || undefined} className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 ${loading ? '' : 'invisible'}`}>
            <span aria-hidden="true" className={`h-4 w-4 shrink-0 rounded-full border-2 border-current border-r-transparent ${loading ? 'animate-spin' : ''}`} />
            {pendingLabel}
          </span>
        </span>
      ) : children}
    </button>
  )
}

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`surface-panel p-5 ${className}`} {...props}>{children}</div>
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`field-control w-full ${className}`} {...props} />
}

export function Label({ children, className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`field-label ${className}`} {...props}>{children}</label>
}

type BadgeTone = 'zinc' | 'green' | 'red' | 'amber' | 'violet' | 'blue' | 'neutral' | 'success' | 'danger' | 'warning' | 'accent' | 'info'
const toneClass: Record<BadgeTone, string> = {
  zinc: 'bg-surface-muted text-muted', neutral: 'bg-surface-muted text-muted',
  green: 'bg-success-soft text-success', success: 'bg-success-soft text-success',
  red: 'bg-danger-soft text-danger', danger: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-warning', warning: 'bg-warning-soft text-warning',
  violet: 'bg-accent-soft text-accent', accent: 'bg-accent-soft text-accent',
  blue: 'bg-info-soft text-info', info: 'bg-info-soft text-info',
}

export function Badge({ children, tone = 'zinc', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${toneClass[tone]} ${className}`} {...props}>{children}</span>
}

export function Spinner({ label = 'Carregando', className = '', decorative = false }: { label?: string; className?: string; decorative?: boolean }) {
  return (
    <span role={decorative ? undefined : 'status'} aria-hidden={decorative || undefined} className={`inline-flex items-center justify-center ${className}`}>
      <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {!decorative ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

export function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={`ui-skeleton h-4 ${className}`} {...props} />
}

export function EmptyState({ title, children, action, className = '' }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`ui-empty-state px-5 py-10 text-center ${className}`}>
      <h2 className="section-heading">{title}</h2>
      {children ? <div className="mx-auto mt-2 max-w-xl text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

const alertClass = { info: 'border-info/25 bg-info-soft text-info', danger: 'border-danger/25 bg-danger-soft text-danger', warning: 'border-warning/25 bg-warning-soft text-warning', success: 'border-success/25 bg-success-soft text-success' }
export function InlineAlert({ children, tone = 'info', className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof alertClass }) {
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${alertClass[tone]} ${className}`} {...props}>{children}</div>
}
