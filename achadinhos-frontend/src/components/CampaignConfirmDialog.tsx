import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/ui'

export function CampaignConfirmDialog({ title, description, confirmLabel, cancelLabel = 'Voltar', danger = false, onCancel, onConfirm }: {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-modal="true" onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onCancel={(event) => { event.preventDefault(); onCancel() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCancel()
  }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/50">
    <h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>
    <p id={`${id}-description`} className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{description}</p>
    <div className="mt-5 flex flex-wrap justify-end gap-2"><Button autoFocus variant="secondary" onClick={onCancel}>{cancelLabel}</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></div>
  </dialog>
}
