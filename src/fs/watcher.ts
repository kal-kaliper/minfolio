// External-change watcher. Capacitor has no native file-watch, so we poll the
// filesystem (the shared source of truth across windows/apps) on app
// resume/foreground (via @capacitor/app) and on a light interval while visible:
//
//  1. Open files' disk content fingerprints — when different from each
//     buffer's last-known disk baseline, emit `external:changed` so the open
//     document reloads.
//  2. The current folder's listing — when it changes (a file added, removed or
//     renamed by another window or app), emit `fs:changed` so the sidebar
//     re-lists. This is what keeps two open windows' file lists in sync.

import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { bus } from '../store'
import { fs } from './fsService'
import type { FileEntry } from '../types'

const POLL_INTERVAL_MS = 2000

/** Stat-and-read open files, returning each file's stable key (its path,
 *  relative or absolute), current disk state, and the buffer's last-known disk
 *  baseline. Provided by the host so it can read/stat workspace-relative or
 *  absolute files. The content is needed so we can detect edits that preserve
 *  the mtime (LLM agents and editors often do). */
type WatchedFile = {
  key: string
  mtime: number
  content: string
  lastMtime: number | null
  lastContent: string | null
}
type WatchedFiles = () => Promise<WatchedFile[]>
type FolderGetter = () => string

let statWatched: WatchedFiles | null = null
let getFolder: FolderGetter | null = null

let intervalId: ReturnType<typeof setInterval> | null = null
let stateListener: PluginListenerHandle | null = null
let resumeListener: PluginListenerHandle | null = null

// Track the last disk fingerprint we emitted per path so we don't fire
// repeatedly for the same external edit (the buffer baseline may not update
// until the UI reloads/accepts the change).
const emitted = new Map<string, string>()
// Signature of the last-seen listing for `folderSigPath`, to detect changes
// (additions/removals/renames/saves) made by other windows or apps.
let folderSig: string | null = null
let folderSigPath: string | null = null
let polling = false

/** A fingerprint of *which* entries a folder holds (name + type), independent
 *  of their contents. We deliberately ignore mtime/size: the sidebar only shows
 *  the set of files, and edits to an open file are handled by the active-file
 *  poll — so keying on the set avoids re-rendering the sidebar on every autosave
 *  while still catching adds, removes and renames from other windows/apps. */
function listingSignature(entries: FileEntry[]): string {
  return entries
    .map((e) => `${e.name}|${e.isDir ? 'd' : 'f'}`)
    .sort()
    .join('\n')
}

function hashString(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function fileSignature(mtime: number | null, content: string): string {
  return `${mtime ?? 'unknown'}:${content.length}:${hashString(content)}`
}

/** Poll open files; reload any whose disk content changed. */
async function pollOpenFiles(): Promise<void> {
  if (!statWatched) return
  for (const info of await statWatched()) {
    const { key, mtime: newMtime, content, lastMtime, lastContent } = info
    const diskSig = fileSignature(newMtime, content)
    const lastSig = lastContent == null ? null : fileSignature(lastMtime, lastContent)
    const alreadyEmitted = emitted.get(key)

    // Different from the buffer's disk baseline, and not a duplicate of what we
    // already announced for this exact disk state. Comparing content as well as
    // mtime catches editors/tools (and LLM agents) that preserve timestamps or
    // write within coarse filesystem timestamp granularity.
    if ((lastSig == null || diskSig !== lastSig) && alreadyEmitted !== diskSig) {
      emitted.set(key, diskSig)
      bus.emit('external:changed', { path: key, newMtime, content })
    } else if (lastSig != null && diskSig === lastSig && alreadyEmitted != null) {
      // Buffer caught up (reloaded/saved) — clear the dedupe guard so a future
      // external edit re-triggers.
      emitted.delete(key)
    }
  }
}

/** Poll the current folder's listing; emit `fs:changed` if it differs from the
 *  last poll (a sibling window or another app touched the folder). */
async function pollFolder(): Promise<void> {
  if (!getFolder) return
  const folder = getFolder()
  const entries = await fs.listDir(folder)
  const sig = listingSignature(entries)

  if (folderSigPath !== folder) {
    // Folder switched (the sidebar already rendered the new one) — just rebase.
    folderSigPath = folder
    folderSig = sig
    return
  }
  if (folderSig !== null && sig !== folderSig) {
    bus.emit('fs:changed', undefined)
  }
  folderSig = sig
}

async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    await pollOpenFiles()
    await pollFolder()
  } catch {
    // stat/list failures (file deleted/renamed mid-poll) are non-fatal.
  } finally {
    polling = false
  }
}

function startInterval(): void {
  if (intervalId != null) return
  intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS)
}

function stopInterval(): void {
  if (intervalId != null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export function startWatching(
  statOpenFiles: WatchedFiles,
  getCurrentFolder?: FolderGetter,
): void {
  statWatched = statOpenFiles
  getFolder = getCurrentFolder ?? null

  // Light polling while visible. On desktop the window can be visible
  // side-by-side while another app has focus; external edits made from that app
  // still need to land in Minfolio without requiring a refocus.
  startInterval()

  // Foreground / resume → poll immediately (catches edits made while backgrounded).
  App.addListener('appStateChange', (state) => {
    if (state.isActive) {
      startInterval()
      void poll()
    } else if (document.visibilityState === 'hidden') {
      stopInterval()
    }
  })
    .then((h) => {
      stateListener = h
    })
    .catch(() => {
      /* @capacitor/app unavailable (e.g. web dev) — interval still runs */
    })

  App.addListener('resume', () => {
    startInterval()
    void poll()
  })
    .then((h) => {
      resumeListener = h
    })
    .catch(() => {
      /* resume not available on this platform */
    })

  // Window-level focus / tab-visible → poll immediately. Covers desktop
  // (Electron) window focus and browser tab switches, where the Capacitor App
  // events above don't fire. This makes switching to a window refresh it at once
  // instead of waiting up to one poll interval.
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)

  // Initial poll on startup.
  void poll()
}

function onFocus(): void {
  void poll()
}
function onVisible(): void {
  if (document.visibilityState === 'visible') {
    startInterval()
    void poll()
  } else {
    stopInterval()
  }
}

export function stopWatching(): void {
  stopInterval()
  stateListener?.remove().catch(() => {})
  resumeListener?.remove().catch(() => {})
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisible)
  stateListener = null
  resumeListener = null
  statWatched = null
  getFolder = null
  emitted.clear()
  folderSig = null
  folderSigPath = null
}
