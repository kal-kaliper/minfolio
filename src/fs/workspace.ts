// workspace.ts — the shared, cross-window workspace state (desktop only):
// the folders the user added from the system, their recently-opened files, and
// which folder is selected (new files go there).
//
// Unlike per-window Settings, this is shared across every open window. We
// persist it under one fixed localStorage key and rely on the browser `storage`
// event, which fires in OTHER windows when one writes — Electron windows share a
// partition's localStorage, so this gives instant cross-window sync with no
// polling. Mutations here update the in-memory store, persist, and emit
// `workspace:changed`; the originating window updates itself directly while
// siblings pick the change up via the storage listener.

import type { RecentEntry, Workspace, WorkspaceFolder } from '../types'
import { bus, nextId, store } from '../store'

const KEY = 'minfolio.workspace'
const MAX_RECENTS_PER_FOLDER = 20

// Folder accent palette — medium-luminance hues that stay readable as text on
// both the light and dark sidebar. Assigned in order as folders are added.
const FOLDER_COLORS = [
  '#5b8cf0', // blue
  '#3aa66b', // green
  '#e0922f', // amber
  '#cf5fa6', // magenta
  '#9a6ad6', // purple
  '#3b9eb8', // teal
  '#e0707a', // rose
  '#b08a3e', // gold
]

const EMPTY: Workspace = { folders: [], recents: [], selectedFolderId: null }

function isFolder(f: unknown): f is WorkspaceFolder {
  const o = f as Partial<WorkspaceFolder>
  return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.path === 'string'
}
function isRecent(r: unknown): r is RecentEntry {
  const o = r as Partial<RecentEntry>
  return !!o && typeof o.path === 'string' && typeof o.folderId === 'string'
}

function coerce(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const p = raw as Partial<Workspace>
  const folders = (Array.isArray(p.folders) ? p.folders.filter(isFolder) : []).map((f, i) => ({
    ...f,
    color: typeof f.color === 'string' ? f.color : FOLDER_COLORS[i % FOLDER_COLORS.length],
  }))
  const recents = Array.isArray(p.recents)
    ? p.recents.filter(isRecent).filter((r) => folders.some((f) => f.id === r.folderId))
    : []
  const selectedFolderId =
    typeof p.selectedFolderId === 'string' && folders.some((f) => f.id === p.selectedFolderId)
      ? p.selectedFolderId
      : (folders[0]?.id ?? null)
  return { folders, recents, selectedFolderId }
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? coerce(JSON.parse(raw)) : { ...EMPTY }
  } catch {
    return { ...EMPTY }
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store.workspace))
  } catch {
    /* storage unavailable — keep the in-memory copy */
  }
}

/** Apply a mutation, persist it, and notify this window. Sibling windows are
 *  notified by the storage listener installed in startWorkspaceSync. */
function commit(): void {
  persist()
  bus.emit('workspace:changed', undefined)
}

/** Begin observing workspace writes from other windows. Call once at startup. */
export function startWorkspaceSync(): void {
  store.workspace = loadWorkspace()
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    store.workspace = loadWorkspace()
    bus.emit('workspace:changed', undefined)
  })
}

// --- mutations ------------------------------------------------------------

/** Add a folder (or re-select it if already present) and select it. */
export function addFolder(path: string, name: string): WorkspaceFolder {
  const existing = store.workspace.folders.find((f) => f.path === path)
  if (existing) {
    store.workspace.selectedFolderId = existing.id
    commit()
    return existing
  }
  const color = FOLDER_COLORS[store.workspace.folders.length % FOLDER_COLORS.length]
  const folder: WorkspaceFolder = { id: nextId('folder'), name, path, collapsed: false, color }
  store.workspace.folders.push(folder)
  store.workspace.selectedFolderId = folder.id
  commit()
  return folder
}

export function removeFolder(id: string): void {
  store.workspace.folders = store.workspace.folders.filter((f) => f.id !== id)
  store.workspace.recents = store.workspace.recents.filter((r) => r.folderId !== id)
  if (store.workspace.selectedFolderId === id) {
    store.workspace.selectedFolderId = store.workspace.folders[0]?.id ?? null
  }
  commit()
}

export function selectFolder(id: string): void {
  if (store.workspace.selectedFolderId === id) return
  store.workspace.selectedFolderId = id
  commit()
}

export function toggleCollapse(id: string): void {
  const f = store.workspace.folders.find((x) => x.id === id)
  if (!f) return
  f.collapsed = !f.collapsed
  commit()
}

/** The added folder that contains `absPath` (longest matching path), or null. */
export function folderForPath(absPath: string): WorkspaceFolder | null {
  let best: WorkspaceFolder | null = null
  for (const f of store.workspace.folders) {
    const prefix = f.path.endsWith('/') ? f.path : f.path + '/'
    if (absPath === f.path || absPath.startsWith(prefix)) {
      if (!best || f.path.length > best.path.length) best = f
    }
  }
  return best
}

/** Record a recently-opened file under its owning folder. An already-listed
 *  file keeps its position (re-opening must not re-sort the list); only a new
 *  file is added, at the top. */
export function addRecent(absPath: string, name: string, folderId: string): void {
  if (store.workspace.recents.some((r) => r.path === absPath)) return
  store.workspace.recents.unshift({ path: absPath, name, folderId, openedAt: Date.now() })
  // Cap per folder, dropping the oldest (bottom-most) beyond the limit.
  const counts = new Map<string, number>()
  store.workspace.recents = store.workspace.recents.filter((r) => {
    const n = (counts.get(r.folderId) ?? 0) + 1
    counts.set(r.folderId, n)
    return n <= MAX_RECENTS_PER_FOLDER
  })
  commit()
}

export function removeRecent(absPath: string): void {
  const before = store.workspace.recents.length
  store.workspace.recents = store.workspace.recents.filter((r) => r.path !== absPath)
  if (store.workspace.recents.length !== before) commit()
}

/** Recents for a folder, in their stable stored order (newest additions on top;
 *  re-opening doesn't reorder). */
export function recentsForFolder(id: string): RecentEntry[] {
  return store.workspace.recents.filter((r) => r.folderId === id)
}

export function getSelectedFolder(): WorkspaceFolder | null {
  const id = store.workspace.selectedFolderId
  return id ? (store.workspace.folders.find((f) => f.id === id) ?? null) : null
}
