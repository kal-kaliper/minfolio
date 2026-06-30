// Settings persistence via @capacitor/preferences. Stores the whole Settings
// object as JSON under a single key, merged over the defaults shape so that
// adding new fields to Settings stays backward-compatible.

import { Preferences } from '@capacitor/preferences'
import type { Settings } from '../types'

const SAVE_DEBOUNCE_MS = 300

// The Preferences key. Each app window ("instance slot") persists its session
// under its own key so multiple open copies don't clobber each other. Slot 1
// keeps the legacy 'folio.settings' key for backward compatibility.
let settingsKey = 'folio.settings'

/** Point settings persistence at this instance's slot. Call once at startup,
 *  before loadSettings(). */
export function setSettingsSlot(slot: number): void {
  settingsKey = slot > 1 ? `folio.settings.${slot}` : 'folio.settings'
}

/** Default settings shape — mirrors store.ts's DEFAULT_SETTINGS. */
const DEFAULTS: Settings = {
  theme: 'system',
  rootPath: 'minfolio',
  currentFolder: 'minfolio',
  openTabs: [],
  activeTabId: null,
  sidebarOpen: false,
  formatBarOpen: false,
  updateMode: 'merge',
  viewScale: 100,
  lastUpdateCheckAt: null,
}

/** Merge persisted JSON over defaults, tolerating missing/corrupt data. */
function coerce(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const p = raw as Partial<Settings>
  return {
    theme: p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? p.theme : DEFAULTS.theme,
    rootPath: typeof p.rootPath === 'string' ? p.rootPath : DEFAULTS.rootPath,
    currentFolder: typeof p.currentFolder === 'string' ? p.currentFolder : DEFAULTS.currentFolder,
    openTabs: Array.isArray(p.openTabs) ? p.openTabs : DEFAULTS.openTabs,
    activeTabId: typeof p.activeTabId === 'string' ? p.activeTabId : DEFAULTS.activeTabId,
    sidebarOpen: typeof p.sidebarOpen === 'boolean' ? p.sidebarOpen : DEFAULTS.sidebarOpen,
    formatBarOpen: typeof p.formatBarOpen === 'boolean' ? p.formatBarOpen : DEFAULTS.formatBarOpen,
    updateMode: p.updateMode === 'merge' || p.updateMode === 'reload' ? p.updateMode : DEFAULTS.updateMode,
    viewScale:
      typeof p.viewScale === 'number' && Number.isFinite(p.viewScale)
        ? Math.min(130, Math.max(85, Math.round(p.viewScale)))
        : DEFAULTS.viewScale,
    lastUpdateCheckAt:
      typeof p.lastUpdateCheckAt === 'number' && Number.isFinite(p.lastUpdateCheckAt)
        ? p.lastUpdateCheckAt
        : DEFAULTS.lastUpdateCheckAt,
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const { value } = await Preferences.get({ key: settingsKey })
    if (!value) return { ...DEFAULTS }
    return coerce(JSON.parse(value))
  } catch {
    return { ...DEFAULTS }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pending: Settings | null = null

/** Persist settings as JSON. Debounced (~300ms) to avoid write thrashing; the
 *  most recent snapshot wins. Resolves once the (debounced) write completes. */
export function saveSettings(s: Settings): Promise<void> {
  pending = { ...s }
  if (saveTimer) clearTimeout(saveTimer)
  return new Promise<void>((resolve) => {
    saveTimer = setTimeout(async () => {
      saveTimer = null
      const snapshot = pending
      pending = null
      try {
        if (snapshot) {
          await Preferences.set({ key: settingsKey, value: JSON.stringify(snapshot) })
        }
      } catch {
        // Best-effort persistence; ignore write failures.
      }
      resolve()
    }, SAVE_DEBOUNCE_MS)
  })
}
