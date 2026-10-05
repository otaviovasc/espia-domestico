import { useCallback, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { CommandManager, StateCommand } from '@/lib/vendor/opencut/commands'
export function useCreativeHistory<T>(initial: T) {
  const [value, apply] = useState(initial)
  const latest = useRef(initial)
  const [available, refresh] = useState({ canUndo: false, canRedo: false })
  const manager = useRef(new CommandManager())
  const set = useCallback((action: SetStateAction<T>) => {
    const before = latest.current
    const next = typeof action === 'function' ? (action as (v: T) => T)(before) : action
    if (JSON.stringify(before) === JSON.stringify(next)) return
    manager.current.execute(
      new StateCommand(before, next, (v) => {
        latest.current = v
        apply(v)
      }),
    )
    refresh({ canUndo: manager.current.canUndo(), canRedo: manager.current.canRedo() })
  }, [])
  const reset = useCallback((next: T) => {
    manager.current.clear()
    latest.current = next
    apply(next)
    refresh({ canUndo: manager.current.canUndo(), canRedo: manager.current.canRedo() })
  }, [])
  const undo = useCallback(() => {
    manager.current.undo()
    refresh({ canUndo: manager.current.canUndo(), canRedo: manager.current.canRedo() })
  }, [])
  const redo = useCallback(() => {
    manager.current.redo()
    refresh({ canUndo: manager.current.canUndo(), canRedo: manager.current.canRedo() })
  }, [])
  return { value, set, reset, undo, redo, ...available }
}
