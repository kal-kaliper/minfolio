// Type for the desktop (Electron) bridge exposed by electron/preload.cjs.
import type { FileEntry } from './types'

declare global {
  interface FolioDesktopApi {
    platform: 'electron'
    /** Per-window slot id for settings isolation across multiple windows. */
    slot: number
    fs: {
      init(): Promise<string>
      listDir(rel: string): Promise<FileEntry[]>
      readFile(rel: string): Promise<string>
      writeFile(rel: string, data: string): Promise<void>
      rename(from: string, to: string): Promise<void>
      delete(rel: string): Promise<void>
      mkdir(rel: string): Promise<void>
      stat(rel: string): Promise<FileEntry | null>
      readAbsolute(abs: string): Promise<{
        name: string
        content: string
        path: string
        rel: string | null
      }>
    }
    newWindow(): Promise<void>
    onOpenFile(cb: (filePath: string) => void): void
    onMenu(cb: (action: string) => void): void
  }

  interface Window {
    folioDesktop?: FolioDesktopApi
  }
}

export {}
