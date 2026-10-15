import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createThemeStore, parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from '../src/lib/theme.ts'

function fakeBrowser({ saved = null, dark = false, blocked = false } = {}) {
  const events = new Map()
  const mediaListeners = new Set()
  const values = new Map([['ad-config', '{"background":"#111111"}']])
  if (saved !== null) values.set(THEME_STORAGE_KEY, saved)
  const document = {
    documentElement: { dataset: {}, style: {} },
    querySelector: () => ({ setAttribute: (key, value) => { document.meta = { [key]: value } } }),
  }
  const media = {
    matches: dark,
    addEventListener: (_, handler) => mediaListeners.add(handler),
    removeEventListener: (_, handler) => mediaListeners.delete(handler),
  }
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  const browser = {
    document,
    get localStorage() { if (blocked) throw new Error('Storage blocked'); return storage },
    matchMedia: () => media,
    addEventListener: (event, handler) => {
      if (!events.has(event)) events.set(event, new Set())
      events.get(event).add(handler)
    },
    removeEventListener: (event, handler) => events.get(event)?.delete(handler),
  }
  return {
    browser, values, events, mediaListeners,
    systemChange(dark) { media.matches = dark; mediaListeners.forEach(handler => handler()) },
    storageChange(value, { key = THEME_STORAGE_KEY, storageArea = storage } = {}) {
      events.get('storage')?.forEach(handler => handler({ key, newValue: value, storageArea }))
    },
  }
}

test('theme preference falls back to the system for missing or invalid storage values', () => {
  for (const input of [null, undefined, '', 'Dark', '{}', 'system']) assert.equal(parseThemePreference(input), 'system')
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

test('system mode follows OS changes; explicit choice persists and ignores OS changes', () => {
  const env = fakeBrowser({ dark: true })
  const store = createThemeStore(env.browser)
  const unsubscribe = store.subscribe(() => {})
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'dark' })
  env.systemChange(false)
  assert.equal(store.getSnapshot().resolvedTheme, 'light')
  store.setPreference('dark')
  env.systemChange(true)
  env.systemChange(false)
  assert.deepEqual(store.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark' })
  assert.equal(env.values.get(THEME_STORAGE_KEY), 'dark')
  assert.equal(env.browser.document.documentElement.dataset.theme, 'dark')
  assert.equal(env.browser.document.documentElement.style.colorScheme, 'dark')
  assert.equal(env.browser.document.meta.content, '#121926')
  assert.equal(env.values.get('ad-config'), '{"background":"#111111"}')
  unsubscribe()
})

test('cross-tab events update the theme, handle clear, and ignore unrelated storage', () => {
  const env = fakeBrowser({ saved: 'light', dark: true })
  const store = createThemeStore(env.browser)
  const unsubscribe = store.subscribe(() => {})
  env.storageChange('dark', { key: 'ad-config' })
  assert.equal(store.getSnapshot().preference, 'light')
  env.storageChange('dark', { storageArea: {} })
  assert.equal(store.getSnapshot().preference, 'light')
  env.storageChange('dark')
  assert.equal(store.getSnapshot().preference, 'dark')
  env.storageChange('invalid')
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'dark' })
  env.storageChange('light')
  env.storageChange(null, { key: null })
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'dark' })
  unsubscribe()
})

test('blocked storage leaves switching usable for the current session', () => {
  const env = fakeBrowser({ blocked: true, dark: true })
  const store = createThemeStore(env.browser)
  const unsubscribe = store.subscribe(() => {})
  assert.equal(store.getSnapshot().resolvedTheme, 'dark')
  assert.doesNotThrow(() => store.setPreference('light'))
  env.systemChange(true)
  assert.equal(store.getSnapshot().resolvedTheme, 'light')
  store.setPreference('system')
  assert.equal(store.getSnapshot().resolvedTheme, 'dark')
  unsubscribe()
})

test('subscribers share one browser listener and cleanup removes both subscriptions', () => {
  const env = fakeBrowser()
  const store = createThemeStore(env.browser)
  let updates = 0
  const first = store.subscribe(() => { updates++ })
  const second = store.subscribe(() => { updates++ })
  assert.equal(env.events.get('storage').size, 1)
  assert.equal(env.mediaListeners.size, 1)
  const original = store.getSnapshot()
  store.setPreference('system')
  assert.equal(store.getSnapshot(), original)
  assert.equal(updates, 0)
  first()
  assert.equal(env.mediaListeners.size, 1)
  second()
  assert.equal(env.events.get('storage').size, 0)
  assert.equal(env.mediaListeners.size, 0)
})

test('before-paint initialization agrees with the live store for every preference and storage failure', () => {
  const script = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8')
  for (const saved of [null, 'light', 'dark', 'system', 'invalid']) {
    for (const dark of [false, true]) {
      for (const blocked of [false, true]) {
        const env = fakeBrowser({ saved, dark, blocked })
        const context = { window: env.browser, document: env.browser.document }
        Object.defineProperty(context, 'localStorage', { get: () => env.browser.localStorage })
        runInNewContext(script, context)
        const store = createThemeStore(env.browser)
        assert.equal(env.browser.document.documentElement.dataset.theme, store.getSnapshot().resolvedTheme)
        assert.equal(env.browser.document.documentElement.style.colorScheme, store.getSnapshot().resolvedTheme)
        assert.equal(env.browser.document.meta.content, store.getSnapshot().resolvedTheme === 'dark' ? '#121926' : '#edf2fa')
      }
    }
  }
})

test('blue palette keeps readable text and visible control boundaries in both themes', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const blocks = [css.match(/:root \{([\s\S]*?)\n\}/)[1], css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)[1]]
  const luminance = color => {
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
  for (const block of blocks) {
    const tokens = Object.fromEntries([...block.matchAll(/--app-([\w-]+):\s*(#[a-f0-9]{6})/g)].map(match => [match[1], match[2]]))
    const contrast = (foreground, background) => {
      const values = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => b - a)
      return (values[0] + 0.05) / (values[1] + 0.05)
    }
    for (const [foreground, background] of [['ink', 'surface'], ['muted', 'surface'], ['muted', 'surface-muted'], ['muted', 'accent-soft'], ['accent-foreground', 'accent']]) {
      assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} needs AA text contrast`)
    }
    for (const background of ['canvas', 'surface', 'surface-muted', 'surface-raised']) {
      assert.ok(contrast('line-strong', background) >= 3, `Control boundary on ${background} needs 3:1`)
      assert.ok(contrast('accent', background) >= 3, `Focus ring on ${background} needs 3:1`)
    }
  }
})
