// Capacitor Filesystem wrapper, rooted at Directory.Documents with a `folio/`
// workspace. All FsService paths are root-relative (relative to Documents),
// e.g. "folio/notes/todo.md".

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { FileEntry, FsService } from '../types'
import { bus, store } from '../store'
import { loadSettings, saveSettings } from './settings'
import { DesktopFs } from './desktopFs'

const WORKSPACE = 'minfolio'
const DIR = Directory.Documents

const WELCOME_FILE = `${WORKSPACE}/Welcome.md`
const WELCOME_CONTENT = `# Welcome to Minfolio

A clean, minimalist **WYSIWYG markdown editor** and **mind-mapping** app, built
to work nicely alongside LLMs. It runs on Android, Meta Quest, and macOS.

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

/** True when an error looks like "file/dir already exists". */
function isExistsError(e: unknown): boolean {
  const msg = errMessage(e).toLowerCase()
  return msg.includes('exist')
}

/** True when an error looks like "no such file/dir" / not found. */
function isNotFoundError(e: unknown): boolean {
  const msg = errMessage(e).toLowerCase()
  return (
    msg.includes('not exist') ||
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('no such') ||
    msg.includes('enoent') ||
    msg.includes('unable to open') ||
    msg.includes('file does not exist')
  )
}

function errMessage(e: unknown): string {
  if (!e) return ''
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const anyE = e as { message?: unknown; errorMessage?: unknown }
  if (typeof anyE.message === 'string') return anyE.message
  if (typeof anyE.errorMessage === 'string') return anyE.errorMessage
  return String(e)
}

export class CapacitorFs implements FsService {
  private currentFolder: string = WORKSPACE

  join(...parts: string[]): string {
    const joined = parts
      .filter((p) => p != null && p !== '')
      .join('/')
      // collapse duplicate slashes
      .replace(/\/{2,}/g, '/')
      // strip leading slash(es)
      .replace(/^\/+/, '')
    return joined
  }

  async init(): Promise<string> {
    // Ensure the workspace folder exists.
    try {
      await Filesystem.mkdir({ directory: DIR, path: WORKSPACE, recursive: true })
    } catch (e) {
      if (!isExistsError(e)) {
        // Some Android versions throw a generic error if it already exists;
        // verify via stat and rethrow only if it truly is not there.
        const exists = await this.exists(WORKSPACE)
        if (!exists) throw e
      }
    }

    // Seed Welcome.md when the workspace is empty.
    try {
      const entries = await this.rawReaddir(WORKSPACE)
      if (entries.length === 0) {
        await this.writeFile(WELCOME_FILE, WELCOME_CONTENT)
      }
    } catch {
      // If listing fails for any reason, attempt to seed anyway (best-effort).
      try {
        const welcome = await this.stat(WELCOME_FILE)
        if (!welcome) await this.writeFile(WELCOME_FILE, WELCOME_CONTENT)
      } catch {
        /* ignore */
      }
    }

    // Restore persisted current folder.
    try {
      const settings = await loadSettings()
      const folder = settings.currentFolder?.trim()
      if (folder && (await this.exists(folder))) {
        this.currentFolder = folder
      } else {
        this.currentFolder = WORKSPACE
      }
    } catch {
      this.currentFolder = WORKSPACE
    }

    return WORKSPACE
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
      /* best-effort persistence */
    }
    // keep the in-memory store in sync if present
    if (store.settings) store.settings.currentFolder = this.currentFolder
    bus.emit('fs:changed', undefined)
  }

  async listDir(path: string): Promise<FileEntry[]> {
    const dirPath = this.join(path)
    const files = await this.rawReaddir(dirPath)
    const entries: FileEntry[] = files.map((f) => {
      const isDir = f.type === 'directory'
      return {
        name: f.name,
        path: this.join(dirPath, f.name),
        isDir,
        mtime: typeof f.mtime === 'number' ? f.mtime : null,
        size: typeof f.size === 'number' ? f.size : 0,
      }
    })
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return entries
  }

  async readFile(path: string): Promise<string> {
    const res = await Filesystem.readFile({
      directory: DIR,
      path: this.join(path),
      encoding: Encoding.UTF8,
    })
    // With UTF8 encoding, data is a string (Blob only when no encoding).
    return typeof res.data === 'string' ? res.data : await blobToText(res.data)
  }

  async writeFile(path: string, data: string): Promise<void> {
    const target = this.join(path)
    try {
      await Filesystem.writeFile({
        directory: DIR,
        path: target,
        data,
        encoding: Encoding.UTF8,
      })
    } catch (e) {
      // Missing parent directory: create it (recursive) and retry once.
      const parent = parentDir(target)
      if (parent && (isNotFoundError(e) || !(await this.exists(parent)))) {
        await this.mkdir(parent)
        await Filesystem.writeFile({
          directory: DIR,
          path: target,
          data,
          encoding: Encoding.UTF8,
        })
      } else {
        throw e
      }
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const toPath = this.join(to)
    const parent = parentDir(toPath)
    if (parent && !(await this.exists(parent))) {
      await this.mkdir(parent)
    }
    await Filesystem.rename({
      directory: DIR,
      from: this.join(from),
      to: toPath,
      toDirectory: DIR,
    })
  }

  async delete(path: string): Promise<void> {
    const target = this.join(path)
    const info = await this.stat(target)
    if (info?.isDir) {
      await Filesystem.rmdir({ directory: DIR, path: target, recursive: true })
    } else {
      try {
        await Filesystem.deleteFile({ directory: DIR, path: target })
      } catch (e) {
        // Fall back to rmdir if it turned out to be a directory.
        if (info == null) return // already gone
        await Filesystem.rmdir({ directory: DIR, path: target, recursive: true }).catch(() => {
          throw e
        })
      }
    }
  }

  async mkdir(path: string): Promise<void> {
    const target = this.join(path)
    if (!target) return
    try {
      await Filesystem.mkdir({ directory: DIR, path: target, recursive: true })
    } catch (e) {
      if (!isExistsError(e)) {
        if (!(await this.exists(target))) throw e
      }
    }
  }

  async stat(path: string): Promise<FileEntry | null> {
    const target = this.join(path)
    try {
      const res = await Filesystem.stat({ directory: DIR, path: target })
      return {
        name: baseName(target),
        path: target,
        isDir: res.type === 'directory',
        mtime: typeof res.mtime === 'number' ? res.mtime : null,
        size: typeof res.size === 'number' ? res.size : 0,
      }
    } catch (e) {
      if (isNotFoundError(e)) return null
      // Unknown stat error shapes on Android: treat as not-found rather than
      // throwing, so callers can use stat() as an existence check.
      return null
    }
  }

  /** Internal: does a path exist? */
  private async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) != null
  }

  /** Internal: readdir that normalizes "directory not found" → []. */
  private async rawReaddir(path: string) {
    try {
      const res = await Filesystem.readdir({ directory: DIR, path })
      return res.files ?? []
    } catch (e) {
      if (isNotFoundError(e)) return []
      throw e
    }
  }
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '' : path.slice(0, idx)
}

function baseName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Response(blob).text()
}

// Pick the filesystem implementation for the current platform at runtime. The
// desktop (Electron) build exposes window.folioDesktop; everything else uses the
// Capacitor-backed implementation (native on Android/Quest, IndexedDB on web).
export const fs: FsService =
  typeof window !== 'undefined' && window.folioDesktop?.platform === 'electron'
    ? new DesktopFs()
    : new CapacitorFs()
