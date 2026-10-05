import { useEffect, useRef, useState } from 'react'

// Expand within the app so preview controls work in embedded browsers too.
export function usePreviewFullscreen() {
  const ref = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded || !ref.current) return
    const panel = ref.current
    const returnFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const hidden: { node: HTMLElement; inert: boolean }[] = []
    let current: HTMLElement = panel
    while (current.parentElement && current.parentElement !== document.body) {
      for (const sibling of current.parentElement.children) {
        if (sibling !== current && sibling instanceof HTMLElement) {
          hidden.push({ node: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      current = current.parentElement
    }
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]'))
      .filter((element) => element.getClientRects().length && !element.closest('details:not([open]) > :not(summary)'))
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(false) }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    focusable()[0]?.focus()
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.style.overflow = previousOverflow
      hidden.forEach(({ node, inert }) => { node.inert = inert })
      returnFocus?.focus({ preventScroll: true })
    }
  }, [expanded])

  return { ref, expanded, toggle: () => setExpanded((value) => !value) }
}
