import { useCallback, useRef } from 'react'
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom'
import UnsavedChangesPrompt from '@/components/UnsavedChangesPrompt'

/** Use once per active route and render prompt beside the route's content. */
export function useUnsavedChanges(
  dirty: boolean,
  message = 'Há alterações que ainda não foram salvas. Se sair agora, elas serão descartadas.',
) {
  const allowOnce = useRef(false)
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    // Focus anchors and same-address transitions do not discard the active route.
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false
    if (allowOnce.current) {
      allowOnce.current = false
      return false
    }
    return dirty
  }, [dirty])
  const blocker = useBlocker(shouldBlock)

  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!dirty) return
    event.preventDefault()
    event.returnValue = ''
  }, [dirty]))

  const allowNextNavigation = useCallback(() => {
    // Call immediately before the successful save's navigate(); consumed once.
    allowOnce.current = true
  }, [])

  return {
    prompt: <UnsavedChangesPrompt blocker={blocker} message={message} />,
    allowNextNavigation,
  }
}
