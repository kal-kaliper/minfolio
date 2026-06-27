// External-change watcher. Capacitor has no native file-watch, so we poll the
// filesystem (the shared source of truth across windows/apps) on app
// resume/foreground (via @capacitor/app) and on a light interval while active:
//
//  1. The active file's mtime — when newer than the buffer's last-known mtime,
//     emit `external:changed` so the open document reloads.
//  2. The current folder's listing — when it changes (a file added, removed or
//     renamed by another window or app), emit `fs:changed` so the sidebar
//     re-lists. This is what keeps two open windows' file lists in sync.

import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { bus } from '../store'
import { fs } from './fsService'
import type { FileEntry } from '../types'

const POLL_INTERVAL_MS = 2000

/** Stat the active file, returning a stable key (its path, relative or
 *  absolute) and current mtime — or null when there's no on-disk active file.
 *  Provided by the host so it can stat workspace-relative or absolute files. */
type ActiveStat = () => Promise<{ key: string; mtime: number } | null>
type MtimeGetter = () => number | null
type FolderGetter = () => string

let statActive: ActiveStat | null = null
let getLast: MtimeGetter | null = null
let getFolder: FolderGetter | null = null

let intervalId: ReturnType<typeof setInterval> | null = null
let stateListener: PluginListenerHandle | null = null
let resumeListener: PluginListenerHandle | null = null

// Track the last mtime we emitted per path so we don't fire repeatedly for the
// same external edit (the buffer's lastMtime may not update until the UI
// reloads/accepts the change).
const emitted = new Map<string, number>()
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

/** Poll the open file's mtime; reload it if it changed on disk. */
async function pollActiveFile(): Promise<void> {
  if (!statActive || !getLast) return
  const info = await statActive()
  if (!info) return
  const { key, mtime: newMtime } = info

  const last = getLast()
  const alreadyEmitted = emitted.get(key)

  // Newer than the buffer's known mtime, and not a duplicate of what we
  // already announced for this exact mtime.
  if ((last == null || newMtime > last) && alreadyEmitted !== newMtime) {
    emitted.set(key, newMtime)
    bus.emit('external:changed', { path: key, newMtime })
  } else if (last != null && newMtime <= last && alreadyEmitted != null) {
    // Buffer caught up (reloaded/saved) — clear the dedupe guard so a future
    // external edit re-triggers.
    emitted.delete(key)
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
    await pollActiveFile()
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
  statActiveFile: ActiveStat,
  getLastMtime: MtimeGetter,
  getCurrentFolder?: FolderGetter,
): void {
  statActive = statActiveFile
  getLast = getLastMtime
  getFolder = getCurrentFolder ?? null

  // Light polling while active.
  startInterval()

  // Foreground / resume → poll immediately (catches edits made while backgrounded).
  App.addListener('appStateChange', (state) => {
    if (state.isActive) {
      startInterval()
      void poll()
    } else {
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
  if (document.visibilityState === 'visible') void poll()
}

export function stopWatching(): void {
  stopInterval()
  stateListener?.remove().catch(() => {})
  resumeListener?.remove().catch(() => {})
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisible)
  stateListener = null
  resumeListener = null
  statActive = null
  getLast = null
  getFolder = null
  emitted.clear()
  folderSig = null
  folderSigPath = null
}
