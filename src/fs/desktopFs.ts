// Desktop (Electron) FsService — talks to the Node-fs-backed main process over
// the `window.folioDesktop.fs` IPC bridge. Mirrors CapacitorFs's behaviour and
// path model (workspace-relative paths under a `minfolio/` workspace) so the rest
// of the app is identical across Android/Quest and macOS.

import type { FileEntry, FsService } from '../types'
import { bus, store } from '../store'
import { loadSettings, saveSettings } from './settings'

const WORKSPACE = 'minfolio'

export class DesktopFs implements FsService {
  private currentFolder: string = WORKSPACE

  private get api() {
    const d = window.folioDesktop
    if (!d) throw new Error('folioDesktop bridge unavailable')
    return d.fs
  }

  join(...parts: string[]): string {
    return parts
      .filter((p) => p != null && p !== '')
      .join('/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '')
  }

  async init(): Promise<string> {
    const root = await this.api.init()
    try {
      const settings = await loadSettings()
      const folder = settings.currentFolder?.trim()
      this.currentFolder = folder && (await this.stat(folder)) ? folder : WORKSPACE
    } catch {
      this.currentFolder = WORKSPACE
    }
    return root
  }

  getCurrentFolder(): string {
    return this.currentFolder
  }

  async setCurrentFolder(path: string): Promise<void> {
    this.currentFolder = this.join(path)
    try {
      const settings = await loadSettings()
      settings.currentFolder = this.currentFolder
      await saveSettings(settings)
    } catch {
      /* best-effort */
    }
    if (store.settings) store.settings.currentFolder = this.currentFolder
    bus.emit('fs:changed', undefined)
  }

  listDir(path: string): Promise<FileEntry[]> {
    return this.api.listDir(this.join(path))
  }

  readFile(path: string): Promise<string> {
    return this.api.readFile(this.join(path))
  }

  writeFile(path: string, data: string): Promise<void> {
    return this.api.writeFile(this.join(path), data)
  }

  rename(from: string, to: string): Promise<void> {
    return this.api.rename(this.join(from), this.join(to))
  }

  delete(path: string): Promise<void> {
    return this.api.delete(this.join(path))
  }

  mkdir(path: string): Promise<void> {
    return this.api.mkdir(this.join(path))
  }

  stat(path: string): Promise<FileEntry | null> {
    return this.api.stat(this.join(path))
  }
}
