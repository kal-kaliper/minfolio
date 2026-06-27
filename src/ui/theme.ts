// Theme manager. Owns the light/dark switch that is applied to <html> via the
// `data-theme` attribute and consumed by the design tokens in theme.css.
//
// Decoupled from the filesystem: persistence happens by mutating
// store.settings.theme and emitting 'settings:changed' so the host (main.ts)
// can write settings through its own saveSettings hook. A host may instead
// register an explicit persist callback via configureThemePersistence().

import { bus, store } from '../store'
import type { Settings, ThemeMode } from '../types'

const DARK_QUERY = '(prefers-color-scheme: dark)'

let mql: MediaQueryList | null = null
let persist: ((settings: Settings) => void) | null = null

/** Resolve a ThemeMode to a concrete applied theme. */
function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return mql?.matches ? 'dark' : 'light'
  }
  return mode
}

/** Apply a resolved theme to the DOM + store, and notify listeners. */
function apply(resolved: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', resolved)
  if (store.resolvedTheme !== resolved) {
    store.resolvedTheme = resolved
  }
  bus.emit('theme:changed', resolved)
}

/** React to OS-level scheme changes while the user is in 'system' mode. */
function onSystemChange(): void {
  if (store.settings.theme === 'system') {
    apply(resolve('system'))
  }
}

/**
 * Optionally register a persistence callback. If set, it is invoked with the
 * current Settings whenever the theme mode changes. If left unset, theme
 * changes are still persisted indirectly: store.settings.theme is mutated and
 * a 'settings:changed' event is emitted for the host to handle.
 */
export function configureThemePersistence(fn: (settings: Settings) => void): void {
  persist = fn
}

/**
 * Initialise theming. Reads the persisted ThemeMode from store.settings
 * (loaded by the host before this runs), wires the system-preference listener,
 * and applies the resolved theme to the document.
 */
export function initTheme(): void {
  if (!mql && typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia(DARK_QUERY)
    mql.addEventListener('change', onSystemChange)
  }
  apply(resolve(store.settings.theme))
}

/** Set an explicit theme mode ('light' | 'dark' | 'system'), persist + apply. */
export function setThemeMode(mode: ThemeMode): void {
  store.setTheme(mode)
  if (persist) {
    persist(store.settings)
  } else {
    bus.emit('settings:changed', undefined)
  }
  apply(resolve(mode))
}

/**
 * Toggle between light and dark. If the current mode is 'system', this picks
 * the opposite of whatever is currently shown, switching to an explicit mode.
 */
export function toggleTheme(): void {
  const next: ThemeMode = store.resolvedTheme === 'dark' ? 'light' : 'dark'
  setThemeMode(next)
}

/** Tear down the system-preference listener (test/hot-reload hygiene). */
export function disposeTheme(): void {
  if (mql) {
    mql.removeEventListener('change', onSystemChange)
    mql = null
  }
}
