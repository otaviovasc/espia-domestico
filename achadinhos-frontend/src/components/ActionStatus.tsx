/*
 * Adapted from Animata StatusButton, commit e7478b835a3b5c4153e71f60666634e91bb38813.
 * https://github.com/codse/animata/blob/e7478b835a3b5c4153e71f60666634e91bb38813/animata/button/status-button.tsx
 * Adaptation: controlled persistence/query state, static progress indicator,
 * Portuguese live labels, stable width and strict reduced-motion support.
 *
 * MIT License
 * Copyright (c) Animata
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, CircleAlert, CircleDashed, Pencil } from 'lucide-react'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery)
  preference.addEventListener('change', onChange)
  return () => preference.removeEventListener('change', onChange)
}
function getReducedMotion() { return window.matchMedia(reducedMotionQuery).matches }

type ActionState = 'saving' | 'unsaved' | 'saved' | 'error' | 'loading' | 'unavailable'
const labels: Record<ActionState, string> = {
  saving: 'Salvando projeto…',
  unsaved: 'Alterações pendentes',
  saved: 'Salvo na conta',
  error: 'Falha ao salvar',
  loading: 'Abrindo projeto…',
  unavailable: 'Projeto indisponível',
}
const colors: Record<ActionState, string> = {
  saving: 'text-info', unsaved: 'text-warning', saved: 'text-success',
  error: 'text-danger', loading: 'text-muted', unavailable: 'text-danger',
}

/** Displays the supplied state; it never schedules or simulates completion. */
export function ActionStatus({ state, label = labels[state], className = '' }: {
  state: ActionState
  label?: string
  className?: string
}) {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => true)
  const Icon = state === 'saved' ? CheckCircle2
    : state === 'error' || state === 'unavailable' ? CircleAlert
      : state === 'unsaved' ? Pencil : CircleDashed
  return (
    <span role="status" aria-live="polite" aria-atomic="true" data-action-state={state}
      className={`inline-grid min-h-8 w-44 max-w-full items-center overflow-hidden text-xs ${colors[state]} ${className}`}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 inline-grid">
        {[...Object.values(labels), label].map((text, index) => (
          <span key={index} className="col-start-1 row-start-1 inline-flex items-center gap-2"><span className="h-4 w-4 shrink-0" />{text}</span>
        ))}
      </span>
      {reducedMotion ? (
        <span aria-hidden="true" data-status-motion="static" className="col-start-1 row-start-1 inline-flex items-center gap-2"><Icon size={16} className="shrink-0" />{label}</span>
      ) : <AnimatePresence mode="wait" initial={false}>
        <motion.span key={state} aria-hidden="true" data-status-motion="animated"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="col-start-1 row-start-1 inline-flex items-center gap-2">
          <Icon size={16} className="shrink-0" />{label}
        </motion.span>
      </AnimatePresence>}
    </span>
  )
}
