// Tiny reactive store + typed event bus. No framework — modules subscribe to
// the events they care about and read/mutate state through these helpers.

import type { Settings, StoreEvents, Tab, ThemeMode, Workspace } from './types'

type Handler<T> = (payload: T) => void

class Bus {
  private map = new Map<keyof StoreEvents, Set<Handler<any>>>()

  on<K extends keyof StoreEvents>(event: K, fn: Handler<StoreEvents[K]>): () => void {
    let set = this.map.get(event)
    if (!set) {
      set = new Set()
      this.map.set(event, set)
    }
    set.add(fn)
    return () => set!.delete(fn)
  }

  emit<K extends keyof StoreEvents>(event: K, payload: StoreEvents[K]): void {
    this.map.get(event)?.forEach((fn) => fn(payload))
  }
}

export const bus = new Bus()

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  rootPath: 'minfolio',
  currentFolder: 'minfolio',
  openTabs: [],
  activeTabId: null,
  sidebarOpen: false,
  formatBarOpen: false,
  updateMode: 'merge',
}

class Store {
  tabs: Tab[] = []
  activeTabId: string | null = null
  settings: Settings = { ...DEFAULT_SETTINGS }
  /** Shared, cross-window workspace (desktop): added folders + recents. */
  workspace: Workspace = { folders: [], recents: [], selectedFolderId: null }
  /** Resolved theme actually applied to the DOM ('light' | 'dark'). */
  resolvedTheme: 'light' | 'dark' = 'light'

  get activeTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null
  }

  getTab(id: string): Tab | null {
    return this.tabs.find((t) => t.id === id) ?? null
  }

  /** Find an open tab by its file path. */
  getTabByPath(path: string): Tab | null {
    return this.tabs.find((t) => t.path === path) ?? null
  }

  addTab(tab: Tab): void {
    this.tabs.push(tab)
    bus.emit('tabs:changed', undefined)
  }

  removeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    this.tabs.splice(idx, 1)
    if (this.activeTabId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null
      this.setActiveTab(next ? next.id : null)
    }
    bus.emit('tabs:changed', undefined)
  }

  setActiveTab(id: string | null): void {
    this.activeTabId = id
    bus.emit('active:changed', id)
  }

  setDirty(id: string, dirty: boolean): void {
    const tab = this.getTab(id)
    if (!tab || tab.dirty === dirty) return
    tab.dirty = dirty
    bus.emit('dirty:changed', { tabId: id, dirty })
  }

  setTheme(mode: ThemeMode): void {
    this.settings.theme = mode
  }
}

export const store = new Store()

let idCounter = 0
export function nextId(prefix = 'tab'): string {
  idCounter += 1
  return `${prefix}-${idCounter}-${performance.now().toString(36).replace('.', '')}`
}
