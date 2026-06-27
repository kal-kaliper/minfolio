// Top-level DOM scaffold: sidebar | (header + tab bar + editor host).
// The host mounts its EditorApi into the exposed `#editor-host` element.

import { bus, store } from '../store'
import { toggleTheme } from './theme'

export interface ShellRefs {
  /** Empty element the host mounts the editor into. */
  editorHost: HTMLElement
  /** Empty element the mindmap view mounts its iframe into (hidden initially). */
  mindmapHost: HTMLElement
  /** Header button that toggles editor <-> mindmap views. */
  viewToggleBtn: HTMLButtonElement
  /** Container the sidebar module renders into. */
  sidebarEl: HTMLElement
  /** Container the tab-bar module renders into. */
  tabbarEl: HTMLElement
  /** Header button that shows/hides the formatting toolbar. */
  formatBtn: HTMLButtonElement
  /** Container the formatting toolbar renders into (below the header). */
  formatBarEl: HTMLElement
  /** The overall app shell (for layout-state queries if needed). */
  shellEl: HTMLElement
}

// --- inline lucide-style icons -------------------------------------------
const ICON_MENU =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
const ICON_SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
const ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
// git-fork (branching tree — reads as "mindmap", not "share") and file-text
// (editor): the two view modes.
const ICON_MINDMAP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>'
const ICON_EDITOR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
// type / "Aa" glyph — toggles the formatting toolbar.
const ICON_FORMAT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 5 20 5 20 7"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="9" y1="19" x2="15" y2="19"/></svg>'
export { ICON_MINDMAP, ICON_EDITOR }

function iconBtn(title: string, svg: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'icon-btn'
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  b.innerHTML = svg
  // After a *mouse* click, drop focus so no focus ring lingers on the button;
  // keyboard activation (no preceding pointerdown) keeps its :focus-visible ring.
  let viaPointer = false
  b.addEventListener('pointerdown', () => {
    viaPointer = true
  })
  b.addEventListener('click', () => {
    if (viaPointer) b.blur()
    viaPointer = false
  })
  return b
}

/**
 * Build the app shell into `root` and return the mount references the host
 * needs. Wires the theme toggle and sidebar-collapse behaviour internally.
 */
export function buildShell(root: HTMLElement): ShellRefs {
  root.innerHTML = ''

  const shell = document.createElement('div')
  shell.className = 'app-shell'
  if (!store.settings.sidebarOpen) shell.classList.add('is-sidebar-collapsed')

  // Sidebar -------------------------------------------------------------
  const sidebarEl = document.createElement('aside')
  sidebarEl.className = 'sidebar'
  sidebarEl.id = 'sidebar'

  // Scrim (only visible/active in the narrow overlay layout) ------------
  const scrim = document.createElement('div')
  scrim.className = 'sidebar-scrim'

  // Main pane -----------------------------------------------------------
  const main = document.createElement('div')
  main.className = 'main-pane'

  const header = document.createElement('header')
  header.className = 'app-header'

  const collapseBtn = iconBtn('Toggle sidebar', ICON_MENU)
  collapseBtn.classList.add('sidebar-toggle')

  const formatBtn = iconBtn('Toggle formatting bar', ICON_FORMAT)
  formatBtn.classList.add('format-toggle')

  const viewToggleBtn = iconBtn('Switch to mindmap view', ICON_MINDMAP)
  viewToggleBtn.classList.add('view-toggle')

  const themeBtn = iconBtn('Toggle theme', ICON_MOON)
  themeBtn.classList.add('theme-toggle')

  const syncThemeIcon = (): void => {
    themeBtn.innerHTML = store.resolvedTheme === 'dark' ? ICON_SUN : ICON_MOON
  }
  syncThemeIcon()

  // Tabs live inline in the header bar for a compact, single-row chrome.
  const tabbarEl = document.createElement('nav')
  tabbarEl.className = 'tabbar'
  tabbarEl.id = 'tabbar'

  header.append(collapseBtn, tabbarEl, formatBtn, viewToggleBtn, themeBtn)

  // Formatting toolbar — sits between the header and the editor, hidden until
  // toggled. The formatbar module fills it; main.ts wires the toggle button.
  const formatBarEl = document.createElement('div')
  formatBarEl.className = 'format-bar'
  formatBarEl.id = 'format-bar'
  if (!store.settings.formatBarOpen) formatBarEl.hidden = true

  const editorWrap = document.createElement('div')
  editorWrap.className = 'editor-wrap'

  const editorHost = document.createElement('div')
  editorHost.id = 'editor-host'

  const mindmapHost = document.createElement('div')
  mindmapHost.id = 'mindmap-host'
  mindmapHost.style.display = 'none'

  editorWrap.append(editorHost, mindmapHost)

  main.append(header, formatBarEl, editorWrap)
  shell.append(sidebarEl, scrim, main)
  root.append(shell)

  // --- behaviour -------------------------------------------------------
  const setCollapsed = (collapsed: boolean): void => {
    shell.classList.toggle('is-sidebar-collapsed', collapsed)
    store.settings.sidebarOpen = !collapsed
    bus.emit('settings:changed', undefined)
  }

  collapseBtn.addEventListener('click', () => {
    setCollapsed(!shell.classList.contains('is-sidebar-collapsed'))
  })

  // Tapping the scrim (narrow overlay layout) closes the sidebar.
  scrim.addEventListener('click', () => setCollapsed(true))

  themeBtn.addEventListener('click', () => toggleTheme())

  // Keep the toggle icon in sync with whatever theme is actually applied.
  bus.on('theme:changed', () => syncThemeIcon())

  return {
    editorHost,
    mindmapHost,
    viewToggleBtn,
    sidebarEl,
    tabbarEl,
    formatBtn,
    formatBarEl,
    shellEl: shell,
  }
}
