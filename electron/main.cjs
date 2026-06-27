// Minfolio desktop (Electron) main process.
//
// The renderer is the SAME web app that Capacitor ships on Android/Quest. Only
// the platform shell differs: here we expose a Node-fs-backed filesystem over
// IPC (see preload.cjs + src/fs/desktopFs.ts), plus native menus, multi-window,
// and macOS .md file associations. Updating src/ updates both targets.

const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron')
const path = require('node:path')
const fsp = require('node:fs/promises')

const isDev = process.env.FOLIO_DEV === '1'
const DEV_URL = 'http://127.0.0.1:5174'

// Filesystem root mirrors the Capacitor model: paths are relative to the user's
// Documents dir, with a `minfolio/` workspace. Keeps src/ identical across targets.
const BASE = app.getPath('documents')
const WORKSPACE = 'minfolio'

const WELCOME = `# Welcome to Minfolio

A clean, minimalist **WYSIWYG markdown editor** and **mind-mapping** app, built
to work nicely alongside LLMs. It runs on macOS, Android, and Meta Quest.

## Getting started

- Open a file from the sidebar, or start a new note
- Edit anywhere — your changes *save to disk automatically*
- Press the **mindmap button** (the branch icon, top-right) to see this note as a map

## Why it pairs well with LLMs

Minfolio edits plain \`.md\` files on your own filesystem:

- [x] It auto-loads external changes to the open file
- [x] It auto-saves your own edits straight back
- [ ] No account, no sync service, no telemetry

So an agent can edit a note while you have it open, and you see the update live.

## Formatting

You get *italic*, **bold**, ~~strikethrough~~, and \`inline code\` out of the box:

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
}

// --- windows + slots ---------------------------------------------------------

const usedSlots = new Set()
function claimSlot() {
  let s = 1
  while (usedSlots.has(s)) s++
  usedSlots.add(s)
  return s
}

/** A file path waiting for a window to be ready to receive it (macOS open-file
 *  can fire before any window exists). */
let pendingOpenFile = null

function createWindow(openFilePath) {
  const slot = claimSlot()
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
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

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  const fileToOpen = openFilePath || pendingOpenFile
  pendingOpenFile = null
  if (fileToOpen) {
    win.webContents.once('did-finish-load', () => {
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

  win.on('closed', () => usedSlots.delete(slot))
  return win
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
              ;(win || createWindow()).webContents.send('folio:open-file', filePaths[0])
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- lifecycle ---------------------------------------------------------------

// macOS file association: may fire before `ready`.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (app.isReady() && win) {
    win.webContents.send('folio:open-file', filePath)
  } else {
    pendingOpenFile = filePath
    if (app.isReady()) createWindow(filePath)
  }
})

app.whenReady().then(() => {
  registerFsIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
