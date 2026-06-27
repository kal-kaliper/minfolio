// Shared contracts for all modules. Cross-module code depends ONLY on these
// interfaces, never on another module's concrete implementation.

export type ThemeMode = 'light' | 'dark' | 'system'

/** A file or directory entry within the workspace. `path` is relative to the
 *  filesystem root the FsService is configured with (Documents). */
export interface FileEntry {
  name: string
  /** Path relative to the FS root, e.g. "minfolio/notes/todo.md". */
  path: string
  isDir: boolean
  /** Epoch milliseconds of last modification, or null if unknown. */
  mtime: number | null
  size: number
}

/** Filesystem abstraction. The concrete implementation wraps Capacitor
 *  Filesystem (Directory.Documents). All paths are root-relative. */
export interface FsService {
  /** Ensure the workspace exists and return the current root folder path. */
  init(): Promise<string>
  /** Current folder being browsed (root-relative). */
  getCurrentFolder(): string
  /** Switch the browsed folder and persist it. */
  setCurrentFolder(path: string): Promise<void>
  /** List entries (dirs first, then files; .md files of interest) in a folder. */
  listDir(path: string): Promise<FileEntry[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  delete(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  /** Stat a single path; null if it does not exist. */
  stat(path: string): Promise<FileEntry | null>
  /** Join path segments using the FS separator. */
  join(...parts: string[]): string
}

/** A folder the user added to the (desktop) sidebar from the system. Files are
 *  addressed by absolute path; the folder groups the user's recently-opened
 *  files from within it. Desktop-only — Android keeps its Documents workspace. */
export interface WorkspaceFolder {
  id: string
  /** Display name (the folder's basename). */
  name: string
  /** Absolute path on disk. */
  path: string
  collapsed: boolean
  /** Accent colour assigned at add time; used to tint the folder + its files. */
  color: string
}

/** A recently-opened file, grouped under the workspace folder that contains it. */
export interface RecentEntry {
  /** Absolute file path. */
  path: string
  name: string
  /** Owning WorkspaceFolder id. */
  folderId: string
  /** Epoch ms when last opened (for ordering / pruning). */
  openedAt: number
}

/** The shared, cross-window workspace state (desktop). Persisted under one
 *  non-slot key and synced between windows via the `storage` event. */
export interface Workspace {
  folders: WorkspaceFolder[]
  recents: RecentEntry[]
  /** Which folder new files are created in (and the visually-selected one). */
  selectedFolderId: string | null
}

/** An open editor buffer. */
export interface Tab {
  id: string
  /** Root-relative file path, or null for an unsaved scratch buffer. */
  path: string | null
  /** Absolute path for a file opened from an added desktop folder (outside the
   *  Documents workspace). When set, saves/stats go through the absolute fs ops
   *  and `path` is null. */
  absPath?: string
  title: string
  content: string
  dirty: boolean
  /** Disk mtime at last load/save, the cheap first gate for external changes. */
  lastDiskMtime: number | null
  /** The exact content as last loaded from / saved to disk. Doubles as the
   *  change gate (an mtime-only touch compares equal, so no spurious prompt) and
   *  as the common base for a three-way auto-merge of external edits. */
  lastDiskContent: string
}

/** How the app reconciles an external on-disk change with unsaved local edits.
 *  `reload`: prompt to reload-or-keep (the on-disk version is preserved as a
 *  .conflict copy if kept). `merge`: auto-merge when the edits are disjoint,
 *  falling back to the same prompt only on a true line-level conflict. */
export type UpdateMode = 'reload' | 'merge'

export interface Settings {
  theme: ThemeMode
  rootPath: string
  currentFolder: string
  openTabs: Array<{ id: string; path: string | null; title: string; absPath?: string }>
  activeTabId: string | null
  sidebarOpen: boolean
  /** Whether the formatting toolbar is shown beneath the header. */
  formatBarOpen: boolean
  /** How external on-disk changes are reconciled with unsaved edits. */
  updateMode: UpdateMode
}

/** A formatting command the toolbar can issue against the active editor.
 *  `heading.level` is 1–6 for H1–H6, or 0 to turn the block back into a normal
 *  paragraph. The rest are simple toggles/wraps with no payload. */
export type FormatAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'heading'; level: number }
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'bulletList' }
  | { type: 'orderedList' }
  | { type: 'taskList' }
  | { type: 'quote' }
  | { type: 'codeBlock' }
  | { type: 'table' }
  | { type: 'divider' }

/** Which formatting is active at the current selection, so the toolbar can
 *  reflect state. `heading` is the level (1–6) or null when not in a heading.
 *  `canUndo`/`canRedo` reflect the history stack depth so the toolbar can
 *  enable/disable the undo and redo controls. */
export interface ActiveFormats {
  canUndo: boolean
  canRedo: boolean
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  bulletList: boolean
  orderedList: boolean
  taskList: boolean
  quote: boolean
  codeBlock: boolean
  heading: number | null
}

/** Editor module contract (Milkdown Crepe wrapper). */
export interface EditorApi {
  mount(root: HTMLElement): Promise<void>
  getMarkdown(): string
  setMarkdown(md: string): Promise<void>
  /** Fired on every content change (user edits). */
  onChange(cb: (md: string) => void): void
  /** Re-apply theme (light/dark) without losing content/selection. */
  applyTheme(mode: 'light' | 'dark'): void
  /** Run a formatting command from the toolbar against the current selection. */
  format(action: FormatAction): void
  /** Inspect which formatting is active at the caret/selection (for toolbar
   *  active-state highlighting). */
  getActiveFormats(): ActiveFormats
  /** Subscribe to caret/selection movement so the toolbar can refresh its
   *  active-state. Fires (debounced to a frame) on any selection change. */
  onSelectionChange(cb: () => void): void
  focus(): void
  destroy(): void
}

/** Events emitted on the global store bus. */
export interface StoreEvents {
  'tabs:changed': void
  'active:changed': string | null
  'dirty:changed': { tabId: string; dirty: boolean }
  'fs:changed': void
  /** A file on disk changed externally. */
  'external:changed': { path: string; newMtime: number }
  'theme:changed': 'light' | 'dark'
  'settings:changed': void
  /** The shared workspace (folders/recents/selection) changed, here or in
   *  another window. */
  'workspace:changed': void
}
