// Minfolio — app bootstrap. Wires the store, filesystem, editor and UI together
// and owns all orchestration (open/save/new/rename/delete/close, theme,
// external-change reload, tab persistence).

import './styles/theme.css'
import './styles/dialogs.css'

import { bus, nextId, store } from './store'
import type { FileEntry, Tab } from './types'
import { App } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { fs } from './fs/fsService'

// Native plugin (android/.../OpenedFilePlugin.java): reads a file handed to the
// app via the .md "open with" intent using ContentResolver.
interface OpenedFilePayload {
  hasFile: boolean
  name?: string
  content?: string
  uri?: string
}
interface OpenedFilePlugin {
  getPending(): Promise<OpenedFilePayload>
  addListener(
    event: 'fileOpened',
    cb: (data: OpenedFilePayload) => void,
  ): Promise<PluginListenerHandle>
}
const OpenedFile = registerPlugin<OpenedFilePlugin>('OpenedFile')

// Native plugin (android/.../AppInstancePlugin.java): assigns each open window a
// stable slot id so multiple copies persist their session under separate keys.
interface AppInstancePlugin {
  getSlot(): Promise<{ slot: number }>
  openNewWindow(): Promise<void>
}
const AppInstance = registerPlugin<AppInstancePlugin>('AppInstance')
const APP_TITLE = 'Minfolio'
const EXTERNAL_UPDATE_WINDOW_MS = 10 * 60 * 1000
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const VIEW_SCALE_MIN = 85
const VIEW_SCALE_MAX = 130

/** Open another window (a fresh app instance) running side by side. */
export function openNewWindow(): void {
  if (window.folioDesktop) {
    void window.folioDesktop.newWindow()
    return
  }
  AppInstance.openNewWindow().catch(() => {
    /* native unavailable (web dev) — no-op */
  })
}

import { loadSettings, saveSettings, setSettingsSlot } from './fs/settings'
import { startWatching } from './fs/watcher'
import { merge3 } from './fs/merge'
import {
  addFolder,
  addRecent,
  folderForPath,
  getSelectedFolder,
  removeRecent,
  startWorkspaceSync,
} from './fs/workspace'
import { MilkdownEditor } from './editor/editor'
import { buildShell, ICON_EDITOR, ICON_MINDMAP } from './ui/shell'
import { createMindmapView, type MindmapView } from './ui/mindmap'
import { createSidebar } from './ui/sidebar'
import { createDesktopSidebar } from './ui/sidebarDesktop'
import { initTooltips } from './ui/tooltip'
import { createTabBar } from './ui/tabs'
import { createFormatBar } from './ui/formatbar'
import { createFindBar } from './ui/findbar'
import { configureThemePersistence, initTheme } from './ui/theme'
import { confirm, confirmSave, prompt } from './ui/dialogs'

// ---------------------------------------------------------------- helpers

function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function ensureMdExt(name: string): string {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`
}

function clampViewScale(scale: number): number {
  return Math.min(VIEW_SCALE_MAX, Math.max(VIEW_SCALE_MIN, Math.round(scale)))
}

function applyViewScale(scale: number): void {
  document.documentElement.style.fontSize = `${clampViewScale(scale)}%`
}

function stripMarkdownNoise(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/([*_~`=])+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function changedExternalSnippets(before: string, after: string): string[] {
  const oldLines = before.split(/\r?\n/)
  const newLines = after.split(/\r?\n/)
  const snippets: string[] = []

  if (oldLines.length <= 450 && newLines.length <= 450) {
    const dp = Array.from({ length: oldLines.length + 1 }, () =>
      new Array<number>(newLines.length + 1).fill(0),
    )
    for (let i = oldLines.length - 1; i >= 0; i--) {
      for (let j = newLines.length - 1; j >= 0; j--) {
        dp[i][j] =
          oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (j < newLines.length) {
      if (i < oldLines.length && oldLines[i] === newLines[j]) {
        i++
        j++
      } else if (i < oldLines.length && dp[i + 1][j] >= dp[i][j + 1]) {
        i++
      } else {
        snippets.push(newLines[j])
        j++
      }
    }
  } else {
    for (let i = 0; i < newLines.length; i++) {
      if (newLines[i] !== oldLines[i]) snippets.push(newLines[i])
    }
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const line of snippets) {
    for (const candidate of [line.trim(), stripMarkdownNoise(line)]) {
      const value = candidate.replace(/\s+/g, ' ').trim()
      const key = value.toLocaleLowerCase()
      if (value.length < 2 || seen.has(key)) continue
      seen.add(key)
      out.push(value)
      if (out.length >= 40) return out
    }
  }
  return out
}

/** Preserve the on-disk version of `path` (which the user chose not to load)
 *  as a sibling "<stem>.conflict.md" so an external edit is never lost. Picks a
 *  free, numbered name if a prior conflict copy already exists. */
async function saveConflictCopy(path: string, content: string): Promise<string | null> {
  // Absolute paths (files opened from an added folder) are handled through the
  // desktop bridge; workspace-relative paths through the FsService.
  const isAbs = path.startsWith('/')
  const d = isAbs ? desktopFsBridge() : null
  if (isAbs && !d) return null
  const sep = isAbs ? '/' : null
  const slash = path.lastIndexOf('/')
  const dir = slash > 0 ? path.slice(0, slash) : isAbs ? '/' : ''
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : '.md'
  const make = (n: number): string => {
    const name = n < 2 ? `${stem}.conflict${ext}` : `${stem}.conflict-${n}${ext}`
    return sep ? `${dir}/${name}` : fs.join(dir, name)
  }
  const exists = async (p: string): Promise<boolean> =>
    isAbs ? (await d!.statAbsolute(p)) != null : (await fs.stat(p)) != null
  let candidate = make(1)
  for (let n = 2; await exists(candidate); n++) candidate = make(n)
  try {
    if (isAbs) await d!.writeAbsolute(candidate, content)
    else await fs.writeFile(candidate, content)
    return candidate
  } catch {
    return null
  }
}

const editor = new MilkdownEditor()

// Mindmap view (lazy: instantiated in main() once the shell exists). When
// active, the active tab's markdown is shown as a draggable mindmap instead of
// the text editor. View-only for now — see ui/mindmap.ts.
let mindmap: MindmapView | null = null
let mindmapActive = false
let externalUpdatesVisible = false
let refreshFormatStateForView: (() => void) | null = null

// Debounced autosave: write the active buffer to disk shortly after edits stop,
// so work survives even if the user never presses Cmd/Ctrl+S (important on a VR
// headset). Only saved files (with a path) autosave; unsaved scratch buffers
// wait for an explicit save-as.
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    const tab = store.activeTab
    if (tab && tab.dirty && (tab.path || tab.absPath)) void saveTab(tab)
  }, 800)
}

/** Immediately write every dirty, on-disk tab (e.g. when the app backgrounds). */
async function flushDirtyTabs(): Promise<void> {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
  for (const tab of store.tabs) {
    if (tab.dirty && (tab.path || tab.absPath)) await saveTab(tab)
  }
}

function persistOpenTabs(): void {
  store.settings.openTabs = store.tabs.map((t) => ({
    id: t.id,
    path: t.path,
    title: t.title,
    absPath: t.absPath,
  }))
  store.settings.activeTabId = store.activeTabId
  void saveSettings(store.settings)
}

function syncWindowTitle(): void {
  const fileTitle = store.activeTab?.title?.trim()
  const title = fileTitle ? `${fileTitle} - ${APP_TITLE}` : APP_TITLE
  document.title = title
  window.folioDesktop?.setTitle(title)
}

function purgeExternalUpdates(tab: Tab | null): void {
  if (!tab?.externalUpdates?.length) return
  const cutoff = Date.now() - EXTERNAL_UPDATE_WINDOW_MS
  tab.externalUpdates = tab.externalUpdates.filter((u) => u.at >= cutoff && u.snippets.length > 0)
}

function recentExternalUpdateSnippets(tab: Tab | null): string[] {
  purgeExternalUpdates(tab)
  if (!tab?.externalUpdates?.length) return []
  const seen = new Set<string>()
  const snippets: string[] = []
  for (const update of tab.externalUpdates) {
    for (const snippet of update.snippets) {
      const key = snippet.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      snippets.push(snippet)
    }
  }
  return snippets
}

function recordExternalUpdate(tab: Tab, before: string, after: string): void {
  const snippets = changedExternalSnippets(before, after)
  if (!snippets.length) return
  purgeExternalUpdates(tab)
  tab.externalUpdates = [...(tab.externalUpdates ?? []), { at: Date.now(), snippets }]
}

function syncExternalUpdateHighlights(): void {
  const snippets = recentExternalUpdateSnippets(store.activeTab)
  editor.setExternalUpdateHighlights(snippets, externalUpdatesVisible && snippets.length > 0)
  refreshFormatStateForView?.()
}

/** Load a tab's buffer into the editor (or clear it when null). */
async function showTabInEditor(tab: Tab | null): Promise<void> {
  await editor.setMarkdown(tab ? tab.content : '')
  syncExternalUpdateHighlights()
  // Keep the mindmap in sync when it's the visible view (e.g. tab switches).
  if (mindmapActive && mindmap) mindmap.setMarkdown(tab ? tab.content : '')
  if (tab && !mindmapActive) editor.focus()
}

// ---------------------------------------------------------------- tab ops

async function activateTab(id: string): Promise<void> {
  if (store.activeTabId === id) return
  const tab = store.getTab(id)
  if (!tab) return
  store.setActiveTab(id)
  await showTabInEditor(tab)
  persistOpenTabs()
}

async function openFile(entry: FileEntry): Promise<void> {
  if (entry.isDir) return
  const existing = store.getTabByPath(entry.path)
  if (existing) {
    await activateTab(existing.id)
    return
  }
  let content = ''
  try {
    content = await fs.readFile(entry.path)
  } catch {
    await confirm({ title: 'Could not open file', message: entry.path, confirmText: 'OK' })
    return
  }
  const st = await fs.stat(entry.path)
  const tab: Tab = {
    id: nextId(),
    path: entry.path,
    title: entry.name,
    content,
    dirty: false,
    lastDiskMtime: st?.mtime ?? null,
    lastDiskContent: content,
  }
  store.addTab(tab)
  store.setActiveTab(tab.id)
  await showTabInEditor(tab)
  persistOpenTabs()
}

// ------------------------------------------------- external "open with" intent

/** Open an untitled buffer (e.g. a file from outside Documents); Cmd/Ctrl+S
 *  saves it into the workspace via the save-as prompt. */
function createScratchTab(title: string, content: string, dirty: boolean): Tab {
  const tab: Tab = {
    id: nextId(),
    path: null,
    title: ensureMdExt(title || 'untitled.md'),
    content,
    dirty,
    lastDiskMtime: null,
    lastDiskContent: content,
  }
  store.addTab(tab)
  store.setActiveTab(tab.id)
  persistOpenTabs()
  return tab
}

function openExternalBuffer(title: string, content: string): void {
  const tab = createScratchTab(title, content, false)
  void showTabInEditor(tab)
}

/** Open a fresh, empty, untitled tab ready to type into (Cmd/Ctrl+N). It lives
 *  only in memory until the first Cmd/Ctrl+S, which routes through the save-as
 *  prompt. */
function newScratchTab(): void {
  openExternalBuffer('untitled.md', '')
}

// --------------------------------------------- desktop multi-folder workspace

/** Record (or refresh) a file in the workspace recents, auto-adding its folder
 *  as a root if it isn't already one. */
function recordRecent(abs: string, name: string): void {
  let folder = folderForPath(abs)
  if (!folder) {
    const slash = abs.lastIndexOf('/')
    const dir = slash > 0 ? abs.slice(0, slash) : '/'
    const folderName = dir.split('/').filter(Boolean).pop() ?? dir
    folder = addFolder(dir, folderName)
  }
  addRecent(abs, name, folder.id)
}

/** Open a file by absolute path (from the Open dialog, a recent, or an added
 *  folder). Reuses an already-open tab; records the file in recents. */
async function openAbsoluteFile(abs: string, name?: string, content?: string): Promise<void> {
  const d = desktopFsBridge()
  if (!d) return
  const existing = store.tabs.find((t) => t.absPath === abs)
  if (existing) {
    recordRecent(abs, existing.title)
    await activateTab(existing.id)
    return
  }
  let title = name ?? baseName(abs)
  let body = content
  if (body == null) {
    try {
      const r = await d.readAbsolute(abs)
      body = r.content
      title = r.name
    } catch {
      await confirm({ title: 'Could not open file', message: abs, confirmText: 'OK' })
      removeRecent(abs) // a stale recent pointing at a missing file
      return
    }
  }
  const st = await d.statAbsolute(abs)
  const tab: Tab = {
    id: nextId(),
    path: null,
    absPath: abs,
    title,
    content: body,
    dirty: false,
    lastDiskMtime: st?.mtime ?? null,
    lastDiskContent: body,
  }
  store.addTab(tab)
  store.setActiveTab(tab.id)
  await showTabInEditor(tab)
  persistOpenTabs()
  recordRecent(abs, title)
}

/** Drop recents whose file no longer exists (moved/deleted outside the app),
 *  and close any clean tab still pointing at the vanished file. Keeps the panel
 *  honest after files are moved in Finder. */
async function validateWorkspaceRecents(): Promise<void> {
  const d = desktopFsBridge()
  if (!d) return
  for (const r of [...store.workspace.recents]) {
    const st = await d.statAbsolute(r.path)
    if (st) continue
    removeRecent(r.path)
    const tab = store.tabs.find((t) => t.absPath === r.path)
    if (tab && !tab.dirty) {
      const wasActive = store.activeTabId === tab.id
      store.removeTab(tab.id)
      if (wasActive) await showTabInEditor(store.activeTab)
      persistOpenTabs()
    }
  }
}

/** Right-click → "Reveal in Finder" for a tab's file. */
function revealTabInFinder(id: string): void {
  const d = window.folioDesktop
  if (!d) return
  const tab = store.getTab(id)
  if (!tab) return
  if (tab.absPath) void d.revealPath(tab.absPath, true)
  else if (tab.path) void d.revealPath(tab.path, false)
}

/** "Add folder" button: pick a system folder and add it as a workspace root. */
async function addFolderFromSystem(): Promise<void> {
  const d = window.folioDesktop
  if (!d) return
  const dir = await d.pickFolder()
  if (!dir) return
  const name = dir.split('/').filter(Boolean).pop() ?? dir
  addFolder(dir, name)
}

/** "Open file" button: pick a .md file and open it (auto-adds its folder). */
async function openFileFromSystem(): Promise<void> {
  const d = window.folioDesktop
  if (!d) return
  const picked = await d.pickFile()
  if (!picked) return
  await openAbsoluteFile(picked.path, picked.name, picked.content)
}

/** "New file" button: create a file in the selected folder and open it. Falls
 *  back to a scratch tab when no folder is selected yet. */
async function newFileInSelectedFolder(): Promise<void> {
  const d = desktopFsBridge()
  const folder = getSelectedFolder()
  if (!d || !folder) {
    newScratchTab()
    return
  }
  const name = await prompt({
    title: 'New file',
    message: `New file in ${folder.name}`,
    placeholder: 'untitled.md',
    value: '',
  })
  if (!name) return
  const abs = `${folder.path.replace(/\/$/, '')}/${ensureMdExt(name)}`
  if (await d.statAbsolute(abs)) {
    await confirm({ title: 'File already exists', message: abs, confirmText: 'OK' })
    return
  }
  try {
    await d.writeAbsolute(abs, '')
  } catch {
    await confirm({ title: 'Could not create file', message: abs, confirmText: 'OK' })
    return
  }
  await openAbsoluteFile(abs, ensureMdExt(name), '')
}

/** Handle a file handed to Minfolio via an external VIEW/EDIT intent (the .md file
 *  association). The native OpenedFile plugin has already read the bytes via
 *  ContentResolver. If the file lives inside the device Documents tree we open
 *  it as a normal editable workspace file (so saves overwrite the original);
 *  otherwise we open the read content as an untitled buffer. */
async function handleOpenedFile(data: OpenedFilePayload): Promise<void> {
  if (!data || !data.hasFile) return
  const uri = data.uri ?? ''
  if (uri.startsWith('file://')) {
    const abs = decodeURIComponent(uri.slice('file://'.length))
    const marker = '/Documents/'
    const idx = abs.indexOf(marker)
    if (idx !== -1) {
      const rel = abs.slice(idx + marker.length)
      const st = await fs.stat(rel)
      if (st) {
        await openFile({ name: baseName(rel), path: rel, isDir: false, mtime: st.mtime, size: st.size })
        return
      }
    }
  }
  if (typeof data.content === 'string') {
    openExternalBuffer(data.name ?? 'untitled.md', data.content)
    return
  }
  await confirm({ title: 'Could not open file', message: data.name ?? uri, confirmText: 'OK' })
}

/** Open a file handed to the desktop app via the OS .md association or the
 *  Open File… dialog (absolute path). Files inside the Documents workspace open
 *  as workspace files; files outside it open as live absolute-path buffers
 *  (saveable back to the original, revealable in Finder, and recorded in the
 *  sidebar's recents under their auto-added folder). */
async function handleDesktopOpenFile(abs: string): Promise<void> {
  const d = window.folioDesktop
  if (!d) return
  try {
    const { name, content, rel } = await d.fs.readAbsolute(abs)
    if (rel) {
      const st = await fs.stat(rel)
      if (st) {
        await openFile({ name: baseName(rel), path: rel, isDir: false, mtime: st.mtime, size: st.size })
        return
      }
    }
    await openAbsoluteFile(abs, name, content)
  } catch {
    await confirm({ title: 'Could not open file', message: abs, confirmText: 'OK' })
  }
}

const OPENABLE_EXT = /\.(md|markdown|txt)$/i

/** Open one or more files dropped onto the window. On desktop they open as live
 *  absolute-path buffers (saveable, revealable, recorded in recents); on web /
 *  Android, where there is no stable path, their text opens as a buffer. */
async function handleDroppedFiles(files: FileList | null | undefined): Promise<void> {
  if (!files?.length) return
  const d = window.folioDesktop
  for (const file of Array.from(files)) {
    if (!OPENABLE_EXT.test(file.name)) continue
    const abs = d?.pathForFile(file) ?? null
    if (abs) {
      await handleDesktopOpenFile(abs)
      continue
    }
    try {
      openExternalBuffer(file.name, await file.text())
    } catch {
      /* unreadable file — skip */
    }
  }
}

/** Wire window-level drag-and-drop of files. A translucent overlay appears while
 *  a file is dragged over the window. We only intercept drags carrying files
 *  (and preventDefault, so Chromium doesn't navigate to the dropped file),
 *  leaving in-editor text/node drags to ProseMirror. Drop is handled on the
 *  capture phase so a file dropped onto the editor still opens rather than being
 *  swallowed by the editor's own drop handling. */
function setupFileDrop(): void {
  const overlay = document.createElement('div')
  overlay.className = 'drop-overlay'
  overlay.hidden = true
  overlay.innerHTML = '<div class="drop-overlay__hint">Drop to open</div>'
  document.body.append(overlay)

  const carriesFiles = (e: DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files')

  let depth = 0 // dragenter/leave fire per descendant; count to find the real edge
  window.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    depth++
    overlay.hidden = false
  })
  window.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })
  window.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) overlay.hidden = true
  })
  window.addEventListener(
    'drop',
    (e) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth = 0
      overlay.hidden = true
      void handleDroppedFiles(e.dataTransfer?.files)
    },
    true,
  )
}

/** The desktop bridge's filesystem (absolute-path ops), or null off-desktop. */
function desktopFsBridge() {
  return window.folioDesktop?.fs ?? null
}

/** Persist a tab to disk. Returns false if the user cancelled a save-as. */
async function saveTab(tab: Tab): Promise<boolean> {
  // Files opened from an added folder (outside the Documents workspace) are
  // addressed by absolute path and saved through the desktop bridge.
  if (tab.absPath) {
    const d = desktopFsBridge()
    if (!d) return false
    try {
      await d.writeAbsolute(tab.absPath, tab.content)
    } catch {
      await confirm({ title: 'Save failed', message: tab.absPath, confirmText: 'OK' })
      return false
    }
    const st = await d.statAbsolute(tab.absPath)
    tab.lastDiskMtime = st?.mtime ?? null
    tab.lastDiskContent = tab.content
    store.setDirty(tab.id, false)
    bus.emit('tabs:changed', undefined)
    persistOpenTabs()
    return true
  }
  if (!tab.path) {
    if (window.folioDesktop) {
      const saved = await window.folioDesktop.saveFileAs(ensureMdExt(tab.title || 'untitled.md'), tab.content)
      if (!saved) return false
      tab.absPath = saved.path
      tab.path = null
      tab.title = saved.name
      const st = await window.folioDesktop.fs.statAbsolute(saved.path)
      tab.lastDiskMtime = st?.mtime ?? null
      tab.lastDiskContent = tab.content
      store.setDirty(tab.id, false)
      bus.emit('tabs:changed', undefined)
      persistOpenTabs()
      recordRecent(saved.path, saved.name)
      return true
    }
    const name = await prompt({
      title: 'Save as',
      message: `New file in ${fs.getCurrentFolder()}`,
      placeholder: 'untitled.md',
      value: 'untitled.md',
    })
    if (!name) return false
    tab.path = fs.join(fs.getCurrentFolder(), ensureMdExt(name))
    tab.title = baseName(tab.path)
  }
  try {
    await fs.writeFile(tab.path, tab.content)
  } catch {
    await confirm({ title: 'Save failed', message: tab.path ?? '', confirmText: 'OK' })
    return false
  }
  const st = await fs.stat(tab.path)
  tab.lastDiskMtime = st?.mtime ?? null
  tab.lastDiskContent = tab.content
  store.setDirty(tab.id, false)
  bus.emit('tabs:changed', undefined)
  bus.emit('fs:changed', undefined)
  persistOpenTabs()
  return true
}

async function saveActiveTab(): Promise<void> {
  let tab = store.activeTab
  if (!tab) {
    const md = editor.getMarkdown()
    if (!md.trim()) return
    tab = createScratchTab('untitled.md', md, true)
  }
  await saveTab(tab)
}

async function closeTab(id: string): Promise<void> {
  const tab = store.getTab(id)
  if (!tab) return
  if (tab.dirty) {
    const choice = await confirmSave({
      title: `Save changes to ${tab.title}?`,
      message: 'Your changes will be lost if you don’t save them.',
    })
    if (choice === 'cancel') return
    if (choice === 'save') {
      const ok = await saveTab(tab)
      if (!ok) return
    }
  }
  const wasActive = store.activeTabId === id
  store.removeTab(id)
  if (wasActive) await showTabInEditor(store.activeTab)
  persistOpenTabs()
}

// ---------------------------------------------------------------- file ops

async function newFile(folder: string): Promise<void> {
  const name = await prompt({ title: 'New file', placeholder: 'untitled.md', value: '' })
  if (!name) return
  const path = fs.join(folder, ensureMdExt(name))
  if (await fs.stat(path)) {
    await confirm({ title: 'File already exists', message: path, confirmText: 'OK' })
    return
  }
  await fs.writeFile(path, '')
  bus.emit('fs:changed', undefined)
  await openFile({ name: baseName(path), path, isDir: false, mtime: null, size: 0 })
}

async function newFolder(folder: string): Promise<void> {
  const name = await prompt({ title: 'New folder', placeholder: 'folder name', value: '' })
  if (!name) return
  await fs.mkdir(fs.join(folder, name))
  bus.emit('fs:changed', undefined)
}

async function renameEntry(entry: FileEntry): Promise<void> {
  const next = await prompt({ title: `Rename ${entry.name}`, value: entry.name })
  if (!next || next === entry.name) return
  const target = fs.join(parentOf(entry.path), entry.isDir ? next : ensureMdExt(next))
  await fs.rename(entry.path, target)
  // Update any open tabs whose path lived under the renamed entry.
  for (const t of store.tabs) {
    if (t.path === entry.path) {
      t.path = target
      t.title = baseName(target)
    } else if (t.path && t.path.startsWith(entry.path + '/')) {
      t.path = target + t.path.slice(entry.path.length)
      t.title = baseName(t.path)
    }
  }
  bus.emit('tabs:changed', undefined)
  bus.emit('fs:changed', undefined)
  persistOpenTabs()
}

async function deleteEntry(entry: FileEntry): Promise<void> {
  const ok = await confirm({
    title: `Delete ${entry.name}?`,
    message: entry.isDir ? 'The folder and its contents will be deleted.' : 'This cannot be undone.',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true,
  })
  if (!ok) return
  await fs.delete(entry.path)
  // Close any tabs that pointed inside the deleted path.
  const doomed = store.tabs.filter(
    (t) => t.path === entry.path || (t.path && t.path.startsWith(entry.path + '/')),
  )
  for (const t of doomed) {
    const wasActive = store.activeTabId === t.id
    store.removeTab(t.id)
    if (wasActive) await showTabInEditor(store.activeTab)
  }
  bus.emit('fs:changed', undefined)
  persistOpenTabs()
}

// ---------------------------------------------------------------- external

async function handleExternalChange(path: string, newMtime: number): Promise<void> {
  // `path` is the active file's key — a workspace-relative path or an absolute
  // path (for files opened from an added folder).
  const tab = store.tabs.find((t) => t.path === path || t.absPath === path)
  if (!tab) return

  // Read the new bytes first and confirm the content actually changed. An
  // mtime-only bump (e.g. a sync tool re-touching identical content) compares
  // equal to our baseline, so we silently rebase the mtime and never prompt.
  let content = ''
  try {
    if (tab.absPath) {
      const d = desktopFsBridge()
      if (!d) return
      content = (await d.readAbsolute(tab.absPath)).content
    } else {
      content = await fs.readFile(path)
    }
  } catch {
    return
  }
  if (content === tab.lastDiskContent) {
    tab.lastDiskMtime = newMtime
    return
  }

  if (tab.dirty) {
    // In merge mode, try to fold the external edits into the user's buffer when
    // they touched disjoint lines. A clean merge is applied + saved silently;
    // only a true line-level conflict falls through to the prompt below.
    if (store.settings.updateMode === 'merge') {
      const merged = merge3(tab.lastDiskContent, tab.content, content)
      if (merged.ok) {
        recordExternalUpdate(tab, tab.lastDiskContent, content)
        tab.content = merged.text
        if (store.activeTabId === tab.id) await showTabInEditor(tab)
        // Persist the merge so disk + baseline catch up and sibling windows
        // converge on the same merged result.
        await saveTab(tab)
        return
      }
    }

    const reload = await confirm({
      title: 'File changed on disk',
      message: `“${tab.title}” was modified by another app. Reload and discard your unsaved changes? “Keep mine” saves the on-disk version as a .conflict copy so nothing is lost.`,
      confirmText: 'Reload',
      cancelText: 'Keep mine',
      danger: true,
    })
    if (!reload) {
      // Keep the user's buffer, but preserve the external version (which our
      // next autosave would otherwise overwrite) as a sidecar.
      await saveConflictCopy(path, content)
      tab.lastDiskMtime = newMtime
      bus.emit('fs:changed', undefined)
      return
    }
  }

  recordExternalUpdate(tab, tab.lastDiskContent, content)
  tab.content = content
  tab.lastDiskMtime = newMtime
  tab.lastDiskContent = content
  store.setDirty(tab.id, false)
  if (store.activeTabId === tab.id) await showTabInEditor(tab)
}

// -------------------------------------------------------------- app updates

function parseVersion(value: string): number[] {
  return value
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  const len = Math.max(a.length, b.length, 3)
  for (let i = 0; i < len; i++) {
    const next = a[i] ?? 0
    const own = b[i] ?? 0
    if (next > own) return true
    if (next < own) return false
  }
  return false
}

async function maybeCheckForUpdates(): Promise<void> {
  const desktop = window.folioDesktop
  if (!desktop) return
  const now = Date.now()
  const last = store.settings.lastUpdateCheckAt ?? 0
  if (now - last < UPDATE_CHECK_INTERVAL_MS) return
  store.settings.lastUpdateCheckAt = now
  bus.emit('settings:changed', undefined)

  try {
    const [current, response] = await Promise.all([
      desktop.getVersion(),
      fetch('https://api.github.com/repos/kal-kaliper/minfolio/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      }),
    ])
    if (!response.ok) return
    const release = (await response.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
    }
    const tag = release.tag_name ?? ''
    const url = release.html_url ?? ''
    if (!tag || !url || !isNewerVersion(tag, current)) return
    const open = await confirm({
      title: `Minfolio ${tag} is available`,
      message: `You’re running ${current}. Open the GitHub release to download and install the update?`,
      confirmText: 'Open GitHub',
      cancelText: 'Not now',
    })
    if (open) await desktop.openExternal(url)
  } catch {
    /* update checks are best-effort */
  }
}

// ---------------------------------------------------------------- startup

async function restoreTabs(): Promise<boolean> {
  const persisted = store.settings.openTabs ?? []
  let restored = 0
  for (const meta of persisted) {
    try {
      if (meta.absPath) {
        // A file opened from an added folder (absolute path, desktop only).
        const d = desktopFsBridge()
        if (!d) continue
        const st = await d.statAbsolute(meta.absPath)
        if (!st) continue
        const content = (await d.readAbsolute(meta.absPath)).content
        store.tabs.push({
          id: meta.id,
          path: null,
          absPath: meta.absPath,
          title: meta.title || baseName(meta.absPath),
          content,
          dirty: false,
          lastDiskMtime: st.mtime ?? null,
          lastDiskContent: content,
        })
        restored += 1
        continue
      }
      if (!meta.path) continue
      const st = await fs.stat(meta.path)
      if (!st) continue
      const content = await fs.readFile(meta.path)
      store.tabs.push({
        id: meta.id,
        path: meta.path,
        title: meta.title || baseName(meta.path),
        content,
        dirty: false,
        lastDiskMtime: st.mtime ?? null,
        lastDiskContent: content,
      })
      restored += 1
    } catch {
      /* skip unreadable */
    }
  }
  if (restored === 0) return false
  const wanted = store.settings.activeTabId
  const active = store.tabs.find((t) => t.id === wanted) ?? store.tabs[0]
  store.activeTabId = active.id
  bus.emit('tabs:changed', undefined)
  return true
}

async function main(): Promise<void> {
  // Mark the desktop (Electron) shell so CSS can reserve room for the macOS
  // traffic lights and designate window-drag regions (no-op on web/Android).
  if (window.folioDesktop) {
    document.documentElement.classList.add('is-desktop')
    // Load the shared multi-folder workspace and observe other windows' changes.
    startWorkspaceSync()
    // Custom hover tooltips for the icon controls (native ones are unreliable
    // in the frameless window).
    initTooltips()
  }

  // 0. Isolate this window's persisted session by its instance slot, so several
  //    open copies of Minfolio don't overwrite each other's tabs/settings.
  if (window.folioDesktop) {
    setSettingsSlot(window.folioDesktop.slot)
  } else {
    try {
      const { slot } = await AppInstance.getSlot()
      setSettingsSlot(slot)
    } catch {
      /* plugin unavailable (web dev) — slot 1 / shared key */
    }
  }

  // 1. Settings (theme, last folder, open tabs).
  store.settings = await loadSettings()
  applyViewScale(store.settings.viewScale)

  // 2. Filesystem workspace (creates minfolio/, seeds Welcome.md on first run).
  await fs.init()
  store.settings.currentFolder = fs.getCurrentFolder()

  // 3. Theme — persist any theme/sidebar changes.
  configureThemePersistence((s) => void saveSettings(s))
  bus.on('settings:changed', () => void saveSettings(store.settings))
  bus.on('active:changed', syncWindowTitle)
  bus.on('tabs:changed', syncWindowTitle)
  initTheme()
  syncWindowTitle()

  // 4. Shell + editor.
  const app = document.getElementById('app')
  if (!app) throw new Error('#app not found')
  const refs = buildShell(app)

  await editor.mount(refs.editorHost)
  editor.applyTheme(store.resolvedTheme)
  editor.onChange((md) => {
    let tab = store.activeTab
    if (!tab) {
      tab = createScratchTab('untitled.md', md, true)
      return
    }
    tab.content = md
    store.setDirty(tab.id, true)
    scheduleAutosave()
  })
  bus.on('theme:changed', (t) => {
    editor.applyTheme(t)
    mindmap?.applyTheme(t)
  })

  // 4b. Mindmap view + editor<->mindmap toggle (top-right, next to theme).
  // Mindmap edits write straight to the active tab's file (same path the text
  // editor saves to), so the two views stay in sync through disk.
  mindmap = createMindmapView(refs.mindmapHost, {
    onSave: async (markdown) => {
      const tab = store.activeTab
      if (!tab) return
      tab.content = markdown
      store.setDirty(tab.id, true)
      await saveTab(tab)
    },
    getTheme: () => store.resolvedTheme,
  })
  const setMindmapActive = async (active: boolean): Promise<void> => {
    mindmapActive = active
    refs.editorHost.style.display = active ? 'none' : ''
    refs.viewToggleBtn.innerHTML = active ? ICON_EDITOR : ICON_MINDMAP
    refs.viewToggleBtn.title = active ? 'Switch to text view' : 'Switch to mindmap view'
    refs.viewToggleBtn.setAttribute('aria-label', refs.viewToggleBtn.title)
    // The formatting bar only applies to the text editor — hide it and its
    // header toggle in mindmap view (restoring the persisted state on return).
    refs.formatBtn.style.display = active ? 'none' : ''
    refs.commentBtn.style.display = active ? 'none' : ''
    refs.updatesBtn.style.display = active ? 'none' : ''
    refs.formatBarEl.hidden = active || !store.settings.formatBarOpen
    if (active) {
      findBar.close()
      mindmap!.show(store.activeTab?.content ?? '')
    } else {
      mindmap!.hide()
      // The mindmap may have saved edits into the buffer; reload the editor so
      // switching back shows the current content, not the stale pre-mindmap text.
      await showTabInEditor(store.activeTab)
    }
  }
  refs.viewToggleBtn.addEventListener('click', () => void setMindmapActive(!mindmapActive))

  // 4c. Formatting toolbar + its header toggle. The bar issues FormatActions
  // straight to the editor; the header button shows/hides it and the choice is
  // persisted. The bar's active-state highlight tracks the caret via the
  // editor's selection-change hook.
  const findBar = createFindBar(refs.findBarEl, {
    onQuery: (query) => editor.setSearchQuery(query),
    onNext: () => editor.findNext(1),
    onPrevious: () => editor.findNext(-1),
    onClose: () => editor.clearSearch(),
  })
  const formatBar = createFormatBar(refs.formatBarEl, {
    onFormat: (action) => editor.format(action),
    onFind: () => findBar.open(),
    updateMode: store.settings.updateMode,
    onToggleUpdateMode: (next) => {
      store.settings.updateMode = next
      bus.emit('settings:changed', undefined)
    },
    viewScale: store.settings.viewScale,
    onChangeViewScale: (next) => {
      store.settings.viewScale = clampViewScale(next)
      applyViewScale(store.settings.viewScale)
      refreshFormatStateForView?.()
      bus.emit('settings:changed', undefined)
    },
  })
  const syncHeaderEditorControls = (): void => {
    const hasExternalUpdates = recentExternalUpdateSnippets(store.activeTab).length > 0
    refs.updatesBtn.classList.toggle('is-active', externalUpdatesVisible)
    refs.updatesBtn.classList.toggle('has-updates', hasExternalUpdates)
    const title = externalUpdatesVisible
      ? hasExternalUpdates
        ? 'Hide recent filesystem update highlights'
        : 'Update highlights on; no recent filesystem updates'
      : 'Highlight recent filesystem updates'
    refs.updatesBtn.title = title
    refs.updatesBtn.setAttribute('aria-label', title)
  }
  const refreshFormatState = (): void => {
    formatBar.update(editor.getActiveFormats(), {
      viewScale: store.settings.viewScale,
    })
    syncHeaderEditorControls()
  }
  refreshFormatStateForView = refreshFormatState
  editor.onSelectionChange(refreshFormatState)

  refs.commentBtn.addEventListener('mousedown', (e) => e.preventDefault())
  refs.commentBtn.addEventListener('click', (e) => {
    e.preventDefault()
    editor.format({ type: 'comment' })
  })
  refs.updatesBtn.addEventListener('click', () => {
    externalUpdatesVisible = !externalUpdatesVisible
    syncExternalUpdateHighlights()
  })

  const syncFormatToggle = (): void => {
    const open = store.settings.formatBarOpen
    refs.formatBarEl.hidden = !open
    refs.formatBtn.classList.toggle('is-active', open)
  }
  syncFormatToggle()
  refs.formatBtn.addEventListener('click', () => {
    store.settings.formatBarOpen = !store.settings.formatBarOpen
    syncFormatToggle()
    bus.emit('settings:changed', undefined)
  })

  // 5. Tab bar + sidebar.
  const tabbar = createTabBar(refs.tabbarEl, {
    onActivate: (id) => void activateTab(id),
    onClose: (id) => void closeTab(id),
    onReveal: window.folioDesktop ? (id) => revealTabInFinder(id) : undefined,
  })
  // Desktop uses the multi-folder workspace sidebar (added folders + recents);
  // Android/web keeps the single-workspace folder browser.
  const sidebar = window.folioDesktop
    ? createDesktopSidebar(refs.sidebarEl, {
        onNewFile: () => void newFileInSelectedFolder(),
        onAddFolder: () => void addFolderFromSystem(),
        onOpenFile: () => void openFileFromSystem(),
        onOpenRecent: (path, name) => void openAbsoluteFile(path, name),
      })
    : createSidebar(refs.sidebarEl, {
        fs,
        onOpenFile: (e) => void openFile(e),
        onNewFile: (folder) => void newFile(folder),
        onNewFolder: (folder) => void newFolder(folder),
        onRename: (e) => void renameEntry(e),
        onDelete: (e) => void deleteEntry(e),
      })

  // 6. Restore previous session, else open the welcome file.
  const restored = await restoreTabs()
  if (restored) {
    await showTabInEditor(store.activeTab)
  } else {
    const welcome = await fs.stat(fs.join(store.settings.rootPath, 'Welcome.md'))
    if (welcome) {
      await openFile({
        name: 'Welcome.md',
        path: welcome.path,
        isDir: false,
        mtime: welcome.mtime,
        size: welcome.size,
      })
    }
  }

  sidebar.render()
  tabbar.render()
  refreshFormatState()
  setInterval(syncExternalUpdateHighlights, 60_000)
  void maybeCheckForUpdates()

  // 7. External-change watcher + save shortcut.
  bus.on('external:changed', ({ path, newMtime }) => void handleExternalChange(path, newMtime))
  startWatching(
    async () => {
      const t = store.activeTab
      if (!t) return null
      if (t.absPath) {
        const d = desktopFsBridge()
        const st = d ? await d.statAbsolute(t.absPath) : null
        if (!d || st?.mtime == null) return null
        const { content } = await d.readAbsolute(t.absPath)
        return { key: t.absPath, mtime: st.mtime, content }
      }
      if (t.path) {
        const st = await fs.stat(t.path)
        if (st?.mtime == null) return null
        const content = await fs.readFile(t.path)
        return { key: t.path, mtime: st.mtime, content }
      }
      return null
    },
    () => store.activeTab?.lastDiskMtime ?? null,
    () => store.activeTab?.lastDiskContent ?? null,
    () => fs.getCurrentFolder(),
  )

  // Desktop: prune workspace recents whose files were moved/deleted in Finder —
  // at startup and whenever the window regains focus.
  if (window.folioDesktop) {
    void validateWorkspaceRecents()
    window.addEventListener('focus', () => void validateWorkspaceRecents())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void validateWorkspaceRecents()
    })
  }

  // Keyboard shortcuts (work with a paired BT keyboard on Quest; Cmd on
  // mac-style keyboards, Ctrl elsewhere).
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (key === 'f') {
      e.preventDefault()
      if (!mindmapActive) findBar.open()
      return
    }
    // On desktop the native menu owns these accelerators (avoids double-firing).
    if (window.folioDesktop) return
    if (key === 'n' && e.shiftKey) {
      e.preventDefault()
      openNewWindow()
    } else if (key === 's') {
      e.preventDefault()
      void saveActiveTab()
    } else if (key === 'n') {
      e.preventDefault()
      newScratchTab()
    } else if (key === 'w') {
      e.preventDefault()
      if (store.activeTabId) void closeTab(store.activeTabId)
    }
  })

  // Drag a markdown file from Finder/Explorer onto the window to open it.
  setupFileDrop()

  // Open a file Minfolio was launched with via the .md "open with" association,
  // and handle files opened while already running. The native plugin reads the
  // bytes via ContentResolver (works for content:// + Android scoped storage).
  try {
    const pending = await OpenedFile.getPending()
    if (pending.hasFile) await handleOpenedFile(pending)
  } catch {
    /* plugin unavailable (web dev) — ignore */
  }
  OpenedFile.addListener('fileOpened', (d) => void handleOpenedFile(d)).catch(() => {})

  // Desktop: OS file association / Open dialog + native menu actions.
  if (window.folioDesktop) {
    window.folioDesktop.onOpenFile((abs) => void handleDesktopOpenFile(abs))
    window.folioDesktop.onMenu((action) => {
      if (action === 'save') void saveActiveTab()
      else if (action === 'new-file') newScratchTab()
      else if (action === 'close-tab' && store.activeTabId) void closeTab(store.activeTabId)
    })
  }

  // Flush unsaved work when the app is backgrounded or hidden (VR shell switch,
  // headset off) so nothing is lost.
  App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void flushDirtyTabs()
  }).catch(() => {
    /* @capacitor/app unavailable (web dev) — ignore */
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushDirtyTabs()
  })
}

void main()
