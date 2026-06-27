// Desktop (Electron) workspace sidebar: a list of folders the user added from
// the system, each a collapsible section showing the files recently opened from
// it. The selected folder (where new files go) is highlighted. Folder/recents
// state is the shared, cross-window workspace store; this view reads it and
// re-renders on `workspace:changed` (fired locally and by sibling windows).
//
// Android keeps the original folder-browser sidebar (see sidebar.ts); this
// module is only mounted when `window.folioDesktop` is present.

import { bus, store } from '../store'
import {
  recentsForFolder,
  removeFolder,
  removeRecent,
  selectFolder,
  toggleCollapse,
} from '../fs/workspace'

export interface DesktopSidebarDeps {
  /** Create a new file in the selected folder. */
  onNewFile: () => void
  /** Pick a system folder to add. */
  onAddFolder: () => void
  /** Pick a .md file to open. */
  onOpenFile: () => void
  /** Open a recent file by absolute path. */
  onOpenRecent: (path: string, name: string) => void
}

export interface SidebarHandle {
  render: () => void
  dispose: () => void
}

// --- icons ----------------------------------------------------------------
const ICON_NEW_FILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>'
const ICON_ADD_FOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>'
const ICON_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 12 12 15 15"/><line x1="12" y1="12" x2="12" y2="19"/></svg>'
const ICON_FILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
const ICON_CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'

function iconBtn(title: string, svg: string, extraClass = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `icon-btn${extraClass ? ' ' + extraClass : ''}`
  b.title = title
  b.setAttribute('aria-label', title)
  b.innerHTML = svg
  return b
}

export function createDesktopSidebar(el: HTMLElement, deps: DesktopSidebarDeps): SidebarHandle {
  el.classList.add('is-workspace')

  function buildActions(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'sidebar-actions'
    const newFile = iconBtn('New file (in selected folder)', ICON_NEW_FILE)
    newFile.addEventListener('click', () => deps.onNewFile())
    const addFolder = iconBtn('Add folder from system', ICON_ADD_FOLDER)
    addFolder.addEventListener('click', () => deps.onAddFolder())
    const openFile = iconBtn('Open a markdown file', ICON_OPEN)
    openFile.addEventListener('click', () => deps.onOpenFile())
    const spacer = document.createElement('div')
    spacer.className = 'spacer'
    bar.append(newFile, addFolder, openFile, spacer)
    return bar
  }

  function buildFolder(folderId: string): HTMLElement {
    const folder = store.workspace.folders.find((f) => f.id === folderId)!
    const selected = store.workspace.selectedFolderId === folderId
    const activeAbs = store.activeTab?.absPath ?? null

    const section = document.createElement('div')
    section.className = 'ws-folder'
    if (selected) section.classList.add('is-selected')
    if (folder.collapsed) section.classList.add('is-collapsed')
    // Tint the whole section with the folder's colour (used by the header name,
    // the selected rail, and inactive file rows via currentColor/inheritance).
    section.style.setProperty('--ws-color', folder.color)

    // Header: chevron · name · close. Clicking the row selects the folder.
    const head = document.createElement('div')
    head.className = 'ws-folder-head'
    head.title = folder.path

    const chevron = iconBtn(folder.collapsed ? 'Expand' : 'Collapse', ICON_CHEVRON, 'ws-chevron')
    chevron.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleCollapse(folderId)
    })

    const name = document.createElement('span')
    name.className = 'ws-folder-name'
    name.textContent = folder.name

    const close = iconBtn('Close folder', ICON_CLOSE, 'ws-close')
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      removeFolder(folderId)
    })

    head.append(chevron, name, close)
    head.addEventListener('click', () => selectFolder(folderId))
    section.append(head)

    if (!folder.collapsed) {
      const list = document.createElement('div')
      list.className = 'ws-recents'
      const recents = recentsForFolder(folderId)
      if (recents.length === 0) {
        const hint = document.createElement('div')
        hint.className = 'ws-empty'
        hint.textContent = 'No recent files — use Open to add one.'
        list.append(hint)
      } else {
        for (const r of recents) {
          const row = document.createElement('div')
          row.className = 'file-row ws-recent'
          if (activeAbs && r.path === activeAbs) row.classList.add('is-active')

          const icon = document.createElement('span')
          icon.className = 'file-icon'
          icon.innerHTML = ICON_FILE
          const label = document.createElement('span')
          label.className = 'file-name'
          label.textContent = r.name

          const actions = document.createElement('span')
          actions.className = 'row-actions'
          const remove = iconBtn('Remove from recents', ICON_CLOSE)
          remove.addEventListener('click', (e) => {
            e.stopPropagation()
            removeRecent(r.path)
          })
          actions.append(remove)

          row.append(icon, label, actions)
          row.addEventListener('click', () => deps.onOpenRecent(r.path, r.name))
          list.append(row)
        }
      }
      section.append(list)
    }
    return section
  }

  function render(): void {
    el.innerHTML = ''
    // Draggable title strip that clears the macOS traffic lights (which sit at
    // the window's top-left, over the sidebar) and acts as a window-drag handle.
    const titlebar = document.createElement('div')
    titlebar.className = 'ws-titlebar'
    el.append(titlebar)
    el.append(buildActions())

    const body = document.createElement('div')
    body.className = 'sidebar-list'
    if (store.workspace.folders.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sidebar-empty'
      empty.textContent = 'Add a folder from your system to start working.'
      body.append(empty)
    } else {
      for (const f of store.workspace.folders) body.append(buildFolder(f.id))
    }
    el.append(body)
  }

  const offWs = bus.on('workspace:changed', () => render())
  const offActive = bus.on('active:changed', () => render())
  const offTabs = bus.on('tabs:changed', () => render())

  render()

  return {
    render,
    dispose() {
      offWs()
      offActive()
      offTabs()
    },
  }
}
