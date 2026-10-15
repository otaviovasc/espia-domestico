export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'espia-theme'

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

export function readThemePreference(storage: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: ResolvedTheme, document: Document) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121926' : '#edf2fa')
}

type ThemeSnapshot = { preference: ThemePreference; resolvedTheme: ResolvedTheme }

/** One subscription for OS and cross-tab events, independent of React renders. */
export function createThemeStore(browser: Window) {
  const listeners = new Set<() => void>()
  let media: MediaQueryList | undefined
  try { media = browser.matchMedia('(prefers-color-scheme: dark)') } catch { /* Older or restricted webviews use light. */ }
  const readPreference = () => {
    try { return readThemePreference(browser.localStorage) } catch { return 'system' as const }
  }
  let preference = readPreference()
  let snapshot: ThemeSnapshot = { preference, resolvedTheme: resolveTheme(preference, media?.matches ?? false) }

  function update(nextPreference: ThemePreference) {
    preference = nextPreference
    const resolvedTheme = resolveTheme(preference, media?.matches ?? false)
    applyTheme(resolvedTheme, browser.document)
    if (snapshot.preference === preference && snapshot.resolvedTheme === resolvedTheme) return
    snapshot = { preference, resolvedTheme }
    listeners.forEach(listener => listener())
  }

  const onSystemChange = () => { if (preference === 'system') update(preference) }
  const onStorage = (event: StorageEvent) => {
    // localStorage.clear() also resets the preference. Ignore sessionStorage.
    try { if (event.storageArea && event.storageArea !== browser.localStorage) return } catch { /* Storage may be unavailable. */ }
    if (event.key === THEME_STORAGE_KEY || event.key === null) update(parseThemePreference(event.newValue))
  }

  return {
    getSnapshot: () => snapshot,
    setPreference(nextPreference: ThemePreference) {
      try { browser.localStorage.setItem(THEME_STORAGE_KEY, nextPreference) } catch { /* In-memory choice still works. */ }
      update(nextPreference)
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        browser.addEventListener('storage', onStorage)
        media?.addEventListener('change', onSystemChange)
        // Refresh the OS result if it changed between render and subscription.
        update(preference)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          browser.removeEventListener('storage', onStorage)
          media?.removeEventListener('change', onSystemChange)
        }
      }
    },
  }
}
