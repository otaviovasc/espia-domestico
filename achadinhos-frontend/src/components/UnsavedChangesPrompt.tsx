import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import type { Blocker } from 'react-router-dom'
import { Button } from '@/components/ui'
import './workspace-shell.css'

function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

export default function UnsavedChangesPrompt({ blocker, message }: { blocker: Blocker; message: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (blocker.state === 'blocked' && !element.open) element.showModal()
    else if (blocker.state !== 'blocked' && element.open) element.close()
  }, [blocker.state])

  // Closing before removal restores focus when a route becomes clean or unmounts.
  useEffect(() => {
    const element = dialog.current
    return () => { if (element?.open) element.close() }
  }, [])

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="unsaved-changes-dialog border border-line bg-surface text-ink"
      onKeyDown={containFocus}
      onCancel={(event) => {
        event.preventDefault()
        blocker.reset?.()
      }}
      onClick={(event) => { if (event.target === event.currentTarget) blocker.reset?.() }}
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="font-display text-lg font-semibold">Sair sem salvar?</h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-muted">{message}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button autoFocus type="button" className="min-h-11 sm:flex-1" onClick={() => blocker.reset?.()}>Continuar editando</Button>
          <Button type="button" variant="secondary" className="min-h-11 sm:flex-1" onClick={() => blocker.proceed?.()}>Descartar e sair</Button>
        </div>
      </div>
    </dialog>
  )
}

