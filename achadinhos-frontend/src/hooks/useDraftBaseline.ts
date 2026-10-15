import { useEffect, useState } from 'react'

/** Advance only after a successful save or an explicit load/reset. */
export function useDraftBaseline(snapshot: string, onDirtyChange?: (dirty: boolean) => void) {
  const [baseline, markClean] = useState(snapshot)
  const dirty = snapshot !== baseline
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])
  return { dirty, markClean }
}
