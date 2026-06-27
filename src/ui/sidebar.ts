// Sidebar: folder header (name + breadcrumb + up), folder/file list, and the
// new-file / new-folder / rename / delete actions. File I/O is delegated to
// host-supplied callbacks; the sidebar only reads listings via fs.listDir and
// drives folder navigation through fs.setCurrentFolder.

import { bus, store } from '../store'
import type { FileEntry, FsService } from '../types'

export interface SidebarDeps {
  fs: FsService
  /** Open a .md file (host loads it into a tab). */
  onOpenFile: (entry: FileEntry) => void
  /** Create a new file in the given folder (host prompts + writes). */
  onNewFile: (folder: string) => void
  /** Create a new folder in the given folder. */
  onNewFolder: (folder: string) => void
  /** Rename an entry (host prompts + performs the move). */
  onRename: (entry: FileEntry) => void
  /** Delete an entry (host confirms + performs the delete). */
  onDelete: (entry: FileEntry) => void
}

export interface SidebarHandle {
  render: () => void
  dispose: () => void
}

// --- inline lucide-style icons -------------------------------------------
const ICON_FILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
const ICON_UP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
const ICON_NEW_FILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>'
const ICON_NEW_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>'
const ICON_RENAME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
const ICON_DELETE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'

function iconBtn(title: string, svg: string, extraClass = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `icon-btn${extraClass ? ' ' + extraClass : ''}`
  b.title = title
  b.setAttribute('aria-label', title)
  b.innerHTML = svg
  return b
}

/** Last path segment, e.g. "minfolio/notes" -> "notes". */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function createSidebar(el: HTMLElement, deps: SidebarDeps): SidebarHandle {
  const { fs } = deps

  /** Parent folder, floored at the workspace root so we can't escape it. */
  function parentOf(path: string): string | null {
    const root = store.settings.rootPath
    if (path === root || !path.startsWith(root)) return null
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    const parent = parts.join('/')
    return parent.length ? parent : null
  }

  async function navigateTo(path: string): Promise<void> {
    try {
      await fs.setCurrentFolder(path)
    } catch {
      // ignore — re-render will show the (unchanged) current folder
    }
    void render()
  }

  function buildHeader(folder: string): HTMLElement {
    const head = document.createElement('div')
    head.className = 'sidebar-head'

    const parent = parentOf(folder)

    const folderBox = document.createElement('div')
    folderBox.className = 'sidebar-folder'
    const name = document.createElement('div')
    name.className = 'sidebar-folder-name'
    name.textContent = basename(folder)
    folderBox.append(name)
    // Only show the full path when we're in a subfolder; at the workspace root
    // the path equals the name, so a breadcrumb would just repeat it.
    if (parent !== null) {
      const crumb = document.createElement('div')
      crumb.className = 'sidebar-breadcrumb'
      crumb.textContent = folder
      folderBox.append(crumb)
    }

    // The "up" affordance only exists inside a subfolder; omit it entirely at
    // the root so it doesn't leave an empty gap (especially on Android/mobile).
    if (parent !== null) {
      const upBtn = iconBtn('Up', ICON_UP)
      upBtn.addEventListener('click', () => void navigateTo(parent))
      head.append(upBtn)
    }
    head.append(folderBox)
    return head
  }

  function buildActions(folder: string): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'sidebar-actions'

    const newFileBtn = iconBtn('New file', ICON_NEW_FILE)
    newFileBtn.addEventListener('click', () => deps.onNewFile(folder))
    const newFolderBtn = iconBtn('New folder', ICON_NEW_FOLDER)
    newFolderBtn.addEventListener('click', () => deps.onNewFolder(folder))

    const spacer = document.createElement('div')
    spacer.className = 'spacer'

    bar.append(newFileBtn, newFolderBtn, spacer)
    return bar
  }

  function buildRow(entry: FileEntry, activePath: string | null): HTMLElement {
    const row = document.createElement('div')
    row.className = 'file-row'
    row.dataset.path = entry.path
    if (!entry.isDir && activePath && entry.path === activePath) {
      row.classList.add('is-active')
    }

    const icon = document.createElement('span')
    icon.className = 'file-icon'
    icon.innerHTML = entry.isDir ? ICON_FOLDER : ICON_FILE

    const nameEl = document.createElement('span')
    nameEl.className = 'file-name'
    nameEl.textContent = entry.name

    const rowActions = document.createElement('span')
    rowActions.className = 'row-actions'
    const renameBtn = iconBtn('Rename', ICON_RENAME)
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      deps.onRename(entry)
    })
    const deleteBtn = iconBtn('Delete', ICON_DELETE)
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      deps.onDelete(entry)
    })
    rowActions.append(renameBtn, deleteBtn)

    row.append(icon, nameEl, rowActions)

    row.addEventListener('click', () => {
      if (entry.isDir) void navigateTo(entry.path)
      else deps.onOpenFile(entry)
    })

    return row
  }

  let renderToken = 0
  async function render(): Promise<void> {
    const token = ++renderToken
    const folder = fs.getCurrentFolder()
    const activePath = store.activeTab?.path ?? null

    let entries: FileEntry[] = []
    let failed = false
    try {
      entries = await fs.listDir(folder)
    } catch {
      failed = true
    }
    // A newer render superseded this one (rapid navigation) — bail.
    if (token !== renderToken) return

    el.innerHTML = ''
    el.append(buildHeader(folder), buildActions(folder))

    const list = document.createElement('div')
    list.className = 'sidebar-list'

    if (failed) {
      const empty = document.createElement('div')
      empty.className = 'sidebar-empty'
      empty.textContent = 'Could not read this folder.'
      list.append(empty)
    } else if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sidebar-empty'
      empty.textContent = 'This folder is empty.'
      list.append(empty)
    } else {
      for (const entry of entries) list.append(buildRow(entry, activePath))
    }

    el.append(list)
  }

  const offFs = bus.on('fs:changed', () => void render())
  const offActive = bus.on('active:changed', () => void render())

  void render()

  return {
    render: () => void render(),
    dispose() {
      offFs()
      offActive()
    },
  }
}
