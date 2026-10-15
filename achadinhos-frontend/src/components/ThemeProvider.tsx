import { createContext, useContext, useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { Sun, Moon, Monitor } from 'lucide-react'
import { createThemeStore, type ThemePreference } from '../lib/theme'

type ThemeStore = ReturnType<typeof createThemeStore>
const ThemeContext = createContext<ThemeStore | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createThemeStore(window))
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <ThemeContext.Provider value={store}>{children}</ThemeContext.Provider>
}

export function ThemeControl({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const store = useContext(ThemeContext)
  if (!store) throw new Error('ThemeControl must be rendered inside ThemeProvider')
  return <ThemeSegments store={store} className={className} compact={compact} />
}

const choices = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
] as const

function ThemeSegments({ store, className, compact }: { store: ThemeStore; className: string; compact: boolean }) {
  const id = useId()
  const { preference } = useSyncExternalStore(store.subscribe, store.getSnapshot)

  // Registry composition adapted from shadcn/ui Base Nova ToggleGroup (MIT).
  // https://ui.shadcn.com/r/styles/base-nova/toggle-group.json
  // Base UI owns roving keyboard focus; a theme preference cannot be deselected.
  return (
    <div className={`theme-control ${compact ? 'theme-control-compact' : ''} ${className}`}>
      <span id={id} className={compact ? 'sr-only' : 'field-label'}>Aparência</span>
      <ToggleGroup<ThemePreference>
        aria-labelledby={id}
        data-slot="toggle-group"
        value={[preference]}
        onValueChange={values => { if (values[0]) store.setPreference(values[0]) }}
        className="theme-segments"
      >
        {choices.map(({ value, label, Icon }) => (
          <Toggle key={value} value={value} data-theme-value={value} data-slot="toggle-group-item" className="theme-segment" aria-label={`Tema ${label.toLowerCase()}`} title={`Tema ${label.toLowerCase()}`}>
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span className={compact ? 'sr-only' : ''}>{label}</span>
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  )
}
