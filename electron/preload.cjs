// Preload: exposes a minimal, safe desktop API to the renderer over IPC.
// The renderer (shared web app) feature-detects `window.folioDesktop` to pick
// the desktop FsService and wire menu/open-file events.

const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Slot id passed by the main process (for per-window settings isolation).
const slotArg = process.argv.find((a) => a.startsWith('--folio-slot='))
const slot = slotArg ? parseInt(slotArg.split('=')[1], 10) || 1 : 1

contextBridge.exposeInMainWorld('folioDesktop', {
  platform: 'electron',
  slot,

  fs: {
    init: () => ipcRenderer.invoke('folio:fs:init'),
    listDir: (rel) => ipcRenderer.invoke('folio:fs:listDir', rel),
    readFile: (rel) => ipcRenderer.invoke('folio:fs:readFile', rel),
    writeFile: (rel, data) => ipcRenderer.invoke('folio:fs:writeFile', rel, data),
    rename: (from, to) => ipcRenderer.invoke('folio:fs:rename', from, to),
    delete: (rel) => ipcRenderer.invoke('folio:fs:delete', rel),
    mkdir: (rel) => ipcRenderer.invoke('folio:fs:mkdir', rel),
    stat: (rel) => ipcRenderer.invoke('folio:fs:stat', rel),
    readAbsolute: (abs) => ipcRenderer.invoke('folio:fs:readAbsolute', abs),
    writeAbsolute: (abs, data) => ipcRenderer.invoke('folio:fs:writeAbsolute', abs, data),
    statAbsolute: (abs) => ipcRenderer.invoke('folio:fs:statAbsolute', abs),
  },

  // Native pickers for the multi-folder workspace (desktop).
  pickFolder: () => ipcRenderer.invoke('folio:pickFolder'),
  pickFile: () => ipcRenderer.invoke('folio:pickFile'),
  saveFileAs: (defaultName, content) => ipcRenderer.invoke('folio:saveFileAs', defaultName, content),
  // Reveal a file in Finder/Explorer (isAbsolute true for added-folder files).
  revealPath: (p, isAbsolute) => ipcRenderer.invoke('folio:revealPath', p, isAbsolute),
  // Copy the fully resolved on-disk path to the native clipboard.
  copyFinalPath: (p, isAbsolute) => ipcRenderer.invoke('folio:copyFinalPath', p, isAbsolute),

  newWindow: () => ipcRenderer.invoke('folio:newWindow'),
  getVersion: () => ipcRenderer.invoke('folio:get-version'),
  checkForUpdates: (userInitiated = true) => ipcRenderer.invoke('folio:check-for-updates', userInitiated),
  openExternal: (url) => ipcRenderer.invoke('folio:open-external', url),
  setTitle: (title) => ipcRenderer.send('folio:set-title', title),

  // Resolve a dropped/selected File to its absolute path. `File.path` was
  // removed in Electron 32+, so the renderer must ask the preload via webUtils.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },

  // file opened via association / Open File… dialog (absolute path)
  onOpenFile: (cb) => {
    ipcRenderer.on('folio:open-file', (_e, filePath) => cb(filePath))
  },
  // native menu actions ('new-file' | 'save')
  onMenu: (cb) => {
    ipcRenderer.on('folio:menu', (_e, action) => cb(action))
  },
})
