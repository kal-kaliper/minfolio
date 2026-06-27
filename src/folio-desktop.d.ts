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
      writeAbsolute(abs: string, data: string): Promise<void>
      statAbsolute(abs: string): Promise<FileEntry | null>
    }
    /** Native folder picker → absolute path, or null if cancelled. */
    pickFolder(): Promise<string | null>
    /** Native .md file picker → { name, content, path }, or null if cancelled. */
    pickFile(): Promise<{ name: string; content: string; path: string } | null>
    /** Reveal a file in Finder/Explorer. */
    revealPath(path: string, isAbsolute: boolean): Promise<void>
    newWindow(): Promise<void>
    onOpenFile(cb: (filePath: string) => void): void
    onMenu(cb: (action: string) => void): void
  }

  interface Window {
    folioDesktop?: FolioDesktopApi
  }
}

export {}
