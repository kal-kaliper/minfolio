// Minfolio desktop (Electron) main process.
//
// The renderer is the SAME web app that Capacitor ships on Android/Quest. Only
// the platform shell differs: here we expose a Node-fs-backed filesystem over
// IPC (see preload.cjs + src/fs/desktopFs.ts), plus native menus, multi-window,
// and macOS .md file associations. Updating src/ updates both targets.

const { app, BrowserWindow, ipcMain, Menu, dialog, shell, screen, clipboard } = require('electron')
const fsn = require('node:fs')
const path = require('node:path')
const fsp = require('node:fs/promises')

let autoUpdater = null
try {
  ;({ autoUpdater } = require('electron-updater'))
} catch {
  // Unsigned macOS builds use the manual GitHub release check. Keep startup
  // working if a packaged app is missing the updater dependency.
}

const isDev = process.env.FOLIO_DEV === '1'
const DEV_URL = 'http://127.0.0.1:5174'
const RELEASES_URL = 'https://github.com/kal-kaliper/minfolio/releases'
const LATEST_RELEASE_API = 'https://api.github.com/repos/kal-kaliper/minfolio/releases/latest'

// Filesystem root mirrors the Capacitor model: paths are relative to the user's
// Documents dir, with a `minfolio/` workspace. Keeps src/ identical across targets.
const BASE = app.getPath('documents')
const WORKSPACE = 'minfolio'
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')
const DEFAULT_WINDOW_BOUNDS = { width: 1100, height: 760 }
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

const WELCOME = `# Welcome to Minfolio

A clean, minimalist **WYSIWYG markdown editor** and **mind-mapping** app, built
to work nicely alongside LLMs. It runs on macOS, Android, and Meta Quest.

## Getting started

- Open a file from the sidebar, or start a new note
- Edit anywhere - your changes *save to disk automatically*
- Press the **mindmap button** (the branch icon, top-right) to see this note as a map

## Why it pairs well with LLMs

Minfolio edits plain \`.md\` files on your own filesystem:

- [x] It auto-loads external changes to open files
- [x] It auto-saves your own edits straight back
- [x] It can highlight recently loaded external changes
- [ ] No account, no sync service, no telemetry

So an agent can edit a note while you have it open, and you see the update live.

## Formatting

Use the top bar for headings, lists, check boxes, comments, and ==highlights==.
You also get *italic*, **bold**, ~~strikethrough~~, and \`inline code\` out of the box:

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`
}
\`\`\`

> Tip: every heading and list becomes a branch in the mindmap. Press the branch
> icon in the top bar to switch between the editor and the map.
`

// --- filesystem IPC (paths are workspace-relative; resolved under BASE) ------

function resolveSafe(rel) {
  const full = path.resolve(BASE, rel || '')
  const baseResolved = path.resolve(BASE)
  if (full !== baseResolved && !full.startsWith(baseResolved + path.sep)) {
    throw new Error('Path escapes workspace root')
  }
  return full
}

function toEntry(rel, name, stats) {
  return {
    name,
    path: rel ? `${rel}/${name}` : name,
    isDir: stats.isDirectory(),
    mtime: Math.round(stats.mtimeMs),
    size: stats.size,
  }
}

async function statEntry(rel) {
  try {
    const stats = await fsp.stat(resolveSafe(rel))
    return {
      name: path.basename(rel),
      path: rel,
      isDir: stats.isDirectory(),
      mtime: Math.round(stats.mtimeMs),
      size: stats.size,
    }
  } catch {
    return null
  }
}

function registerFsIpc() {
  ipcMain.handle('folio:fs:init', async () => {
    await fsp.mkdir(resolveSafe(WORKSPACE), { recursive: true })
    const entries = await fsp.readdir(resolveSafe(WORKSPACE)).catch(() => [])
    if (entries.length === 0) {
      await fsp.writeFile(resolveSafe(`${WORKSPACE}/Welcome.md`), WELCOME, 'utf8')
    }
    return WORKSPACE
  })

  ipcMain.handle('folio:fs:listDir', async (_e, rel) => {
    let dirents
    try {
      dirents = await fsp.readdir(resolveSafe(rel), { withFileTypes: true })
    } catch {
      return []
    }
    const out = []
    for (const d of dirents) {
      try {
        const stats = await fsp.stat(path.join(resolveSafe(rel), d.name))
        out.push(toEntry(rel, d.name, stats))
      } catch {
        /* skip unreadable */
      }
    }
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return out
  })

  ipcMain.handle('folio:fs:readFile', async (_e, rel) => fsp.readFile(resolveSafe(rel), 'utf8'))

  ipcMain.handle('folio:fs:writeFile', async (_e, rel, data) => {
    const full = resolveSafe(rel)
    await fsp.mkdir(path.dirname(full), { recursive: true })
    await fsp.writeFile(full, data, 'utf8')
  })

  ipcMain.handle('folio:fs:rename', async (_e, from, to) => {
    const full = resolveSafe(to)
    await fsp.mkdir(path.dirname(full), { recursive: true })
    await fsp.rename(resolveSafe(from), full)
  })

  ipcMain.handle('folio:fs:delete', async (_e, rel) => {
    await fsp.rm(resolveSafe(rel), { recursive: true, force: true })
  })

  ipcMain.handle('folio:fs:mkdir', async (_e, rel) => {
    await fsp.mkdir(resolveSafe(rel), { recursive: true })
  })

  ipcMain.handle('folio:fs:stat', async (_e, rel) => statEntry(rel))

  // Read an arbitrary absolute path (file opened via association). Returns the
  // workspace-relative path too when the file lives under BASE, so the renderer
  // can open it as a normal editable file instead of an untitled buffer.
  ipcMain.handle('folio:fs:readAbsolute', async (_e, abs) => {
    const content = await fsp.readFile(abs, 'utf8')
    const baseResolved = path.resolve(BASE)
    const a = path.resolve(abs)
    let rel = null
    if (a === baseResolved || a.startsWith(baseResolved + path.sep)) {
      rel = path.relative(baseResolved, a).split(path.sep).join('/')
    }
    return { name: path.basename(abs), content, path: abs, rel }
  })

  ipcMain.handle('folio:newWindow', () => {
    createWindow()
  })

  ipcMain.handle('folio:get-version', () => app.getVersion())

  ipcMain.handle('folio:check-for-updates', (_e, userInitiated = true) => {
    return checkForUpdates(Boolean(userInitiated))
  })

  ipcMain.handle('folio:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      void shell.openExternal(url)
    }
  })

  // --- arbitrary-folder workspace (desktop multi-root) ---------------------

  ipcMain.handle('folio:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  ipcMain.handle('folio:pickFile', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    })
    if (res.canceled || !res.filePaths.length) return null
    const abs = res.filePaths[0]
    const content = await fsp.readFile(abs, 'utf8')
    return { name: path.basename(abs), content, path: abs }
  })

  ipcMain.handle('folio:saveFileAs', async (_e, defaultName, content) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    })
    if (res.canceled || !res.filePath) return null
    const abs = /\.[a-z0-9]+$/i.test(res.filePath) ? res.filePath : `${res.filePath}.md`
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf8')
    return { name: path.basename(abs), path: abs }
  })

  // Read/write/stat by absolute path — files outside the Documents workspace
  // that the user explicitly added/opened. No resolveSafe guard (intentional:
  // the path came from a native picker the user drove).
  ipcMain.handle('folio:fs:writeAbsolute', async (_e, abs, data) => {
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, data, 'utf8')
  })
  // Reveal a file in Finder/Explorer. `isAbsolute` files are revealed directly;
  // workspace-relative paths are resolved under the Documents workspace.
  ipcMain.handle('folio:revealPath', (_e, p, isAbsolute) => {
    try {
      shell.showItemInFolder(isAbsolute ? p : resolveSafe(p))
    } catch {
      /* ignore */
    }
  })

  ipcMain.handle('folio:copyFinalPath', (_e, p, isAbsolute) => {
    try {
      clipboard.writeText(isAbsolute ? path.resolve(p) : resolveSafe(p))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('folio:fs:statAbsolute', async (_e, abs) => {
    try {
      const s = await fsp.stat(abs)
      return {
        name: path.basename(abs),
        path: abs,
        isDir: s.isDirectory(),
        mtime: Math.round(s.mtimeMs),
        size: s.size,
      }
    } catch {
      return null
    }
  })

  ipcMain.on('folio:set-title', (event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && typeof title === 'string') win.setTitle(title)
  })
}

// --- windows + slots ---------------------------------------------------------

const usedSlots = new Set()
const windowsBySlot = new Map()
let windowState = { windows: [], lastFocusedSlot: null }
let saveWindowStateTimer = null
let isQuitting = false
let updateCheckTimer = null
let updateCheckInProgress = false
let updateManualCheck = false
let updateReadyPromptOpen = false
let updateLastNotifiedVersion = null

function claimSlot(preferred) {
  if (Number.isInteger(preferred) && preferred > 0 && !usedSlots.has(preferred)) {
    usedSlots.add(preferred)
    return preferred
  }
  let s = 1
  while (usedSlots.has(s)) s++
  usedSlots.add(s)
  return s
}

function readWindowState() {
  try {
    const parsed = JSON.parse(fsn.readFileSync(WINDOW_STATE_FILE, 'utf8'))
    const windows = Array.isArray(parsed.windows)
      ? parsed.windows
          .map((w) => ({
            slot: Number.isInteger(w.slot) && w.slot > 0 ? w.slot : null,
            bounds: normalizeBounds(w.bounds),
            isMaximized: !!w.isMaximized,
            isFullScreen: !!w.isFullScreen,
          }))
          .filter((w) => w.slot != null)
      : []
    return {
      windows,
      lastFocusedSlot:
        Number.isInteger(parsed.lastFocusedSlot) && parsed.lastFocusedSlot > 0
          ? parsed.lastFocusedSlot
          : null,
    }
  } catch {
    return { windows: [], lastFocusedSlot: null }
  }
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null
  const x = Number.isFinite(bounds.x) ? Math.round(bounds.x) : undefined
  const y = Number.isFinite(bounds.y) ? Math.round(bounds.y) : undefined
  const width = Math.max(640, Number.isFinite(bounds.width) ? Math.round(bounds.width) : 1100)
  const height = Math.max(480, Number.isFinite(bounds.height) ? Math.round(bounds.height) : 760)
  const normalized = { width, height }
  if (x !== undefined && y !== undefined) {
    normalized.x = x
    normalized.y = y
  }
  return normalized
}

function ensureVisibleBounds(bounds) {
  if (!bounds || bounds.x == null || bounds.y == null) return bounds ?? DEFAULT_WINDOW_BOUNDS
  const windowRect = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return !(
      windowRect.x + windowRect.width < area.x ||
      area.x + area.width < windowRect.x ||
      windowRect.y + windowRect.height < area.y ||
      area.y + area.height < windowRect.y
    )
  })
  return visible ? bounds : DEFAULT_WINDOW_BOUNDS
}

function snapshotWindow(win, slot) {
  return {
    slot,
    bounds: normalizeBounds(win.getNormalBounds()),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  }
}

function collectWindowState() {
  const windows = []
  for (const [slot, win] of windowsBySlot) {
    if (!win.isDestroyed()) windows.push(snapshotWindow(win, slot))
  }
  windows.sort((a, b) => a.slot - b.slot)
  if (!windows.some((w) => w.slot === windowState.lastFocusedSlot)) {
    windowState.lastFocusedSlot = BrowserWindow.getFocusedWindow()
      ? [...windowsBySlot].find(([, win]) => win === BrowserWindow.getFocusedWindow())?.[0] ?? null
      : windows[0]?.slot ?? null
  }
  return { windows, lastFocusedSlot: windowState.lastFocusedSlot }
}

function saveWindowStateNow(state = collectWindowState()) {
  windowState = state
  try {
    fsn.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true })
    fsn.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2))
  } catch {
    /* best-effort persistence */
  }
}

function scheduleWindowStateSave() {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer)
  saveWindowStateTimer = setTimeout(() => {
    saveWindowStateTimer = null
    saveWindowStateNow()
  }, 300)
}

/** A file path waiting for a window to be ready to receive it (macOS open-file
 *  can fire before any window exists). */
let pendingOpenFile = null

function foregroundWindow(win) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(openFilePath, restored = {}) {
  const slot = claimSlot(restored.slot)
  const savedBounds = ensureVisibleBounds(normalizeBounds(restored.bounds))
  const win = new BrowserWindow({
    ...savedBounds,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    // Vertically centre the traffic lights within the ~46px top bar (matches
    // the CSS clearance reserved for them in the sidebar/header).
    trafficLightPosition: { x: 16, y: 15 },
    backgroundColor: '#1a1a18',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--folio-slot=${slot}`],
    },
  })
  windowsBySlot.set(slot, win)

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  const fileToOpen = openFilePath || pendingOpenFile
  pendingOpenFile = null
  if (fileToOpen) {
    win.webContents.once('did-finish-load', () => {
      foregroundWindow(win)
      win.webContents.send('folio:open-file', fileToOpen)
    })
  }

  // Open external links in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  if (restored.isMaximized) {
    win.once('ready-to-show', () => win.maximize())
  }
  if (restored.isFullScreen) {
    win.once('ready-to-show', () => win.setFullScreen(true))
  }

  const persistEvents = ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']
  for (const ev of persistEvents) win.on(ev, scheduleWindowStateSave)
  win.on('focus', () => {
    windowState.lastFocusedSlot = slot
    scheduleWindowStateSave()
  })
  win.on('closed', () => {
    usedSlots.delete(slot)
    windowsBySlot.delete(slot)
    if (!isQuitting) saveWindowStateNow()
  })
  scheduleWindowStateSave()
  return win
}

function restoreWindows() {
  windowState = readWindowState()
  const windows = windowState.windows.length ? windowState.windows : [{ slot: 1 }]
  for (const saved of windows) createWindow(null, saved)
  const focusSlot = windowState.lastFocusedSlot
  if (focusSlot && windowsBySlot.has(focusSlot)) windowsBySlot.get(focusSlot).focus()
}

// --- auto updates ------------------------------------------------------------

function updateDialogWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
}

function appVersionLabel() {
  return `Minfolio ${app.getVersion()}`
}

async function showUpdateMessage(options) {
  const win = updateDialogWindow()
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

function parseVersion(value) {
  return String(value || '')
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  const len = Math.max(a.length, b.length, 3)
  for (let i = 0; i < len; i++) {
    const next = a[i] || 0
    const own = b[i] || 0
    if (next > own) return true
    if (next < own) return false
  }
  return false
}

async function fetchLatestRelease() {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Minfolio/${app.getVersion()}`,
    },
  })
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
  const release = await response.json()
  return {
    version: release.tag_name || '',
    url: release.html_url || RELEASES_URL,
  }
}

async function checkForUnsignedMacUpdate(userInitiated) {
  const latest = await fetchLatestRelease()
  if (!latest.version || !isNewerVersion(latest.version, app.getVersion())) {
    if (userInitiated) {
      await showUpdateMessage({
        type: 'info',
        title: 'No updates available',
        message: `${appVersionLabel()} is up to date.`,
        buttons: ['OK'],
      })
    }
    return { ok: true, updateAvailable: false }
  }

  if (!userInitiated && updateLastNotifiedVersion === latest.version) {
    return { ok: true, updateAvailable: true }
  }
  updateLastNotifiedVersion = latest.version

  const { response } = await showUpdateMessage({
    type: 'info',
    title: 'Update available',
    message: `Minfolio ${latest.version} is available`,
    detail:
      'This macOS build is unsigned, so Minfolio will open the GitHub release page for a manual download and install.',
    buttons: ['Open GitHub', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) void shell.openExternal(latest.url)
  return { ok: true, updateAvailable: true }
}

function setupAutoUpdates() {
  if (!autoUpdater) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    updateCheckInProgress = true
  })

  autoUpdater.on('update-available', (info) => {
    if (!updateManualCheck) return
    void showUpdateMessage({
      type: 'info',
      title: 'Update available',
      message: `Minfolio ${info.version} is available`,
      detail: 'The update is downloading in the background. You will be prompted to restart when it is ready.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-not-available', () => {
    updateCheckInProgress = false
    if (!updateManualCheck) return
    updateManualCheck = false
    void showUpdateMessage({
      type: 'info',
      title: 'No updates available',
      message: `${appVersionLabel()} is up to date.`,
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateCheckInProgress = false
    updateManualCheck = false
    if (updateReadyPromptOpen) return
    updateReadyPromptOpen = true
    void showUpdateMessage({
      type: 'info',
      title: 'Update ready',
      message: `Minfolio ${info.version} is ready to install`,
      detail: 'Restart Minfolio to finish installing the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      updateReadyPromptOpen = false
      if (response === 0) autoUpdater.quitAndInstall(false, true)
    })
  })

  autoUpdater.on('error', (error) => {
    updateCheckInProgress = false
    const manual = updateManualCheck
    updateManualCheck = false
    if (!manual) return
    void showUpdateMessage({
      type: 'error',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: error?.message || String(error),
      buttons: ['OK'],
    })
  })
}

async function checkForUpdates(userInitiated = false) {
  if (isDev || !app.isPackaged) {
    if (userInitiated) {
      await showUpdateMessage({
        type: 'info',
        title: 'Updates unavailable',
        message: 'Auto-updates are only available in a packaged Minfolio build.',
        detail: 'Run a signed release build and publish it to GitHub Releases to test the full updater.',
        buttons: ['OK'],
      })
    }
    return { ok: false, reason: 'not-packaged' }
  }

  if (updateCheckInProgress) {
    if (userInitiated) {
      await showUpdateMessage({
        type: 'info',
        title: 'Checking for updates',
        message: 'An update check is already in progress.',
        buttons: ['OK'],
      })
    }
    return { ok: false, reason: 'in-progress' }
  }

  if (process.platform === 'darwin') {
    updateCheckInProgress = true
    try {
      return await checkForUnsignedMacUpdate(userInitiated)
    } catch (error) {
      if (userInitiated) {
        await showUpdateMessage({
          type: 'error',
          title: 'Update check failed',
          message: 'Could not check for updates.',
          detail: error?.message || String(error),
          buttons: ['OK'],
        })
      }
      return { ok: false, reason: 'error' }
    } finally {
      updateCheckInProgress = false
    }
  }

  if (!autoUpdater) {
    if (userInitiated) {
      await showUpdateMessage({
        type: 'error',
        title: 'Update check failed',
        message: 'The updater module is not available in this build.',
        detail: 'Install a freshly packaged Minfolio build and try again.',
        buttons: ['OK'],
      })
    }
    return { ok: false, reason: 'updater-unavailable' }
  }

  updateManualCheck = userInitiated
  updateCheckInProgress = true
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    updateCheckInProgress = false
    updateManualCheck = false
    if (userInitiated) {
      await showUpdateMessage({
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: error?.message || String(error),
        buttons: ['OK'],
      })
    }
    return { ok: false, reason: 'error' }
  }
}

function startAutoUpdateChecks() {
  if (updateCheckTimer) clearInterval(updateCheckTimer)
  void checkForUpdates(false)
  updateCheckTimer = setInterval(() => {
    void checkForUpdates(false)
  }, UPDATE_CHECK_INTERVAL_MS)
}

// --- menu --------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow(),
        },
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: (_i, win) => win && win.webContents.send('folio:menu', 'new-file'),
        },
        { type: 'separator' },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: async (_i, win) => {
            const { canceled, filePaths } = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
            })
            if (!canceled && filePaths[0]) {
              const target = win || createWindow()
              foregroundWindow(target)
              target.webContents.send('folio:open-file', filePaths[0])
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (_i, win) => win && win.webContents.send('folio:menu', 'save'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (_i, win) => win && win.webContents.send('folio:menu', 'close-tab'),
        },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => void checkForUpdates(true),
        },
        {
          label: 'Minfolio Releases',
          click: () => void shell.openExternal(RELEASES_URL),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- lifecycle ---------------------------------------------------------------

// macOS file association: may fire before `ready`.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (app.isReady() && win) {
    foregroundWindow(win)
    win.webContents.send('folio:open-file', filePath)
  } else {
    pendingOpenFile = filePath
    if (app.isReady()) createWindow(filePath)
  }
})

app.whenReady().then(() => {
  registerFsIpc()
  setupAutoUpdates()
  buildMenu()
  restoreWindows()
  startAutoUpdateChecks()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer)
    saveWindowStateTimer = null
  }
  saveWindowStateNow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
