import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Native top-layer dialog keeps keyboard focus inside and restores its opener. */
export function ConnectionMessagesDialog({
  title,
  titleId,
  onClose,
  children,
}: {
  title: string
  titleId: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/50"
      onCancel={(event) => { event.preventDefault(); closeRef.current() }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((control) => control.getClientRects().length > 0)
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (!first || !last) { event.preventDefault(); return }
        const active = document.activeElement
        if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const box = event.currentTarget.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeRef.current()
      }}
    >
      <div className="flex max-h-[90dvh] min-h-0 flex-col p-4 sm:p-5">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Fechar diálogo: ${title}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
