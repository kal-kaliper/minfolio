// editor.ts — Milkdown Crepe wrapper implementing the shared EditorApi.
//
// Crepe is a ProseMirror-based WYSIWYG markdown editor that renders block
// styling inline and reveals the raw markdown markers around the active node.
// This module owns its lifecycle (create / destroy), surfaces markdown
// get/set, fires change callbacks for dirty-tracking, and re-themes live
// without rebuilding the document.

import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { CmdKey } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { callCommand } from '@milkdown/kit/utils'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  insertHrCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  toggleStrikethroughCommand,
  insertTableCommand,
} from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import { NodeSelection } from '@milkdown/kit/prose/state'

// Crepe's structural CSS (reset, prosemirror, feature widgets). We deliberately
// do NOT import a colour theme (frame/nord/classic) — colours come from our own
// CSS variables in editor.css, layered per data-theme.
import '@milkdown/crepe/theme/common/style.css'

// Our typography + inline-marker styling and the self-hosted @font-face rules.
import './fonts.css'
import './editor.css'

import {
  createCommentAttrs,
  FOLIO_COMMENT_NODE,
  folioCommentPlugins,
} from './comments'
import { highlightPlugins, toggleHighlightCommand } from './highlight'
import type { ActiveFormats, EditorApi, FormatAction } from '../types'

const NO_FORMATS: ActiveFormats = {
  canUndo: false,
  canRedo: false,
  bold: false,
  italic: false,
  strike: false,
  code: false,
  highlight: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  quote: false,
  codeBlock: false,
  heading: null,
}

type ChangeCallback = (md: string) => void

// DOM events that signal a genuine user edit (as opposed to programmatic /
// async document mutation). Non-editing keys produce no markdownUpdated event,
// so lifting suppression on any of these is harmless.
const USER_INPUT_EVENTS = ['beforeinput', 'keydown', 'paste', 'cut', 'drop'] as const

export class MilkdownEditor implements EditorApi {
  /** The host-provided mount point. Crepe builds its `.milkdown` div inside. */
  private root: HTMLElement | null = null
  private crepe: Crepe | null = null

  /** Latest known markdown. Kept in sync on every markdownUpdated event so
   *  getMarkdown() is cheap and always current even mid-teardown. */
  private markdown = ''

  /** Registered change subscribers. Always invoked with the latest markdown. */
  private changeCbs = new Set<ChangeCallback>()

  /** Current resolved theme; re-applied after every (re)create. */
  private theme: 'light' | 'dark' = 'light'

  /** Guards against firing change callbacks during programmatic setMarkdown /
   *  recreate, which would otherwise mark a freshly-loaded buffer dirty. */
  private suppressChange = false

  /** Serialises async create/destroy so rapid setMarkdown calls can't race. */
  private opQueue: Promise<void> = Promise.resolve()

  /** Incremented on every (re)create; guards the deferred un-suppress timer so
   *  a stale timer from a previous load can't flip the flag mid-create. */
  private loadGen = 0

  /** Toolbar active-state subscribers + the document selectionchange wiring
   *  (installed once, lazily, on first onSelectionChange). */
  private selectionCbs = new Set<() => void>()
  private selectionBound = false
  private selectionRaf = 0

  async mount(root: HTMLElement): Promise<void> {
    this.root = root
    await this.recreate(this.markdown)
  }

  getMarkdown(): string {
    // Prefer a live read when the editor exists; fall back to the cached value.
    if (this.crepe) {
      try {
        this.markdown = this.crepe.getMarkdown()
      } catch {
        /* editor mid-teardown — cached value is the best we have */
      }
    }
    return this.markdown
  }

  async setMarkdown(md: string): Promise<void> {
    this.markdown = md
    // Crepe has no live setter; recreate into the same root with the new value.
    await this.recreate(md)
  }

  onChange(cb: ChangeCallback): void {
    this.changeCbs.add(cb)
  }

  applyTheme(mode: 'light' | 'dark'): void {
    this.theme = mode
    // Theme is purely CSS-variable driven, so this never touches the document
    // — content and selection are preserved.
    if (this.root) this.root.setAttribute('data-theme', mode)
  }

  /** Run a toolbar formatting command against the current selection. Each case
   *  maps to a Milkdown command (callCommand) except task lists, which toggle a
   *  list item's `checked` attribute directly (GFM has no ready-made command).
   *  We re-focus afterward so the caret returns to the document, not the bar. */
  format(action: FormatAction): void {
    if (!this.crepe) return
    // A toolbar action is an explicit user edit, never part of the post-load
    // programmatic cascade — so lift change suppression here. Otherwise a
    // formatting action (e.g. inserting a comment) performed before the user
    // has typed anything would fire markdownUpdated while still suppressed, and
    // the edit would never mark the buffer dirty or autosave.
    this.suppressChange = false
    const run = <T>(cmd: { key: CmdKey<T> }, payload?: T): void => {
      try {
        this.crepe!.editor.action(callCommand(cmd.key, payload))
      } catch {
        /* command unavailable in current state — ignore */
      }
    }
    switch (action.type) {
      case 'undo':
        run(undoCommand)
        break
      case 'redo':
        run(redoCommand)
        break
      case 'heading':
        // level 0 → paragraph (wrapInHeadingCommand falls back to setBlockType).
        run(wrapInHeadingCommand, action.level)
        break
      case 'bold':
        run(toggleStrongCommand)
        break
      case 'italic':
        run(toggleEmphasisCommand)
        break
      case 'strike':
        run(toggleStrikethroughCommand)
        break
      case 'code':
        run(toggleInlineCodeCommand)
        break
      case 'highlight':
        run(toggleHighlightCommand)
        break
      case 'comment':
        this.insertComment()
        break
      case 'bulletList':
        run(wrapInBulletListCommand)
        break
      case 'orderedList':
        run(wrapInOrderedListCommand)
        break
      case 'taskList':
        this.toggleTaskList()
        break
      case 'quote':
        run(wrapInBlockquoteCommand)
        break
      case 'codeBlock':
        run(createCodeBlockCommand)
        break
      case 'table':
        run(insertTableCommand)
        break
      case 'divider':
        run(insertHrCommand)
        break
    }
    this.focus()
    // A command may change marks/blocks without moving the caret, which won't
    // fire selectionchange — refresh the toolbar explicitly.
    this.notifySelection()
  }

  /** Report which formatting is active at the current selection so the toolbar
   *  can highlight matching controls. Reads the live ProseMirror state. */
  getActiveFormats(): ActiveFormats {
    if (!this.crepe) return NO_FORMATS
    let result: ActiveFormats = NO_FORMATS
    try {
      this.crepe.editor.action((ctx) => {
        const { state } = ctx.get(editorViewCtx)
        const { selection, schema, doc, storedMarks } = state
        const markActive = (name: string): boolean => {
          const type = schema.marks[name]
          if (!type) return false
          if (selection.empty) {
            return !!type.isInSet(storedMarks || selection.$from.marks())
          }
          return doc.rangeHasMark(selection.from, selection.to, type)
        }

        let heading: number | null = null
        let bulletList = false
        let orderedList = false
        let taskList = false
        let quote = false
        let codeBlock = false
        const $from = selection.$from
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          switch (node.type.name) {
            case 'heading':
              if (heading == null) heading = (node.attrs.level as number) ?? null
              break
            case 'bullet_list':
              bulletList = true
              break
            case 'ordered_list':
              orderedList = true
              break
            case 'blockquote':
              quote = true
              break
            case 'code_block':
              codeBlock = true
              break
            case 'list_item':
              if (node.attrs.checked != null) taskList = true
              break
          }
        }

        result = {
          canUndo: undoDepth(state) > 0,
          canRedo: redoDepth(state) > 0,
          bold: markActive('strong'),
          italic: markActive('emphasis'),
          strike: markActive('strikethrough'),
          code: markActive('inlineCode'),
          highlight: markActive('highlight'),
          bulletList,
          orderedList,
          taskList,
          quote,
          codeBlock,
          heading,
        }
      })
    } catch {
      /* editor mid-teardown — report nothing active */
    }
    return result
  }

  onSelectionChange(cb: () => void): void {
    this.selectionCbs.add(cb)
    if (this.selectionBound) return
    this.selectionBound = true
    // A single document-level listener covers caret moves, clicks and keyboard
    // navigation inside the contenteditable. Coalesce bursts into one frame.
    document.addEventListener('selectionchange', () => this.notifySelection())
  }

  /** Fire selection subscribers on the next frame (deduped). */
  private notifySelection(): void {
    if (this.selectionRaf) return
    this.selectionRaf = requestAnimationFrame(() => {
      this.selectionRaf = 0
      if (!this.crepe) return
      this.selectionCbs.forEach((cb) => cb())
    })
  }

  /** Toggle a task (checkbox) list. GFM models task items as ordinary list
   *  items carrying a `checked` attribute (null = plain bullet, false/true =
   *  checkbox). If the caret isn't in a list yet we wrap it in a bullet list
   *  first, then flip the nearest list item between plain (null) and unchecked
   *  (false). */
  private toggleTaskList(): void {
    const crepe = this.crepe
    if (!crepe) return

    const findListItem = (
      ctx: Ctx,
    ): { pos: number; attrs: Record<string, unknown> } | null => {
      const { state } = ctx.get(editorViewCtx)
      const $from = state.selection.$from
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d)
        if (node.type.name === 'list_item') {
          return { pos: $from.before(d), attrs: { ...node.attrs } }
        }
      }
      return null
    }

    try {
      // Ensure we're inside a list item before toggling its checked state.
      let inList = false
      crepe.editor.action((ctx) => {
        inList = findListItem(ctx) !== null
      })
      if (!inList) crepe.editor.action(callCommand(wrapInBulletListCommand.key))

      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const li = findListItem(ctx)
        if (!li) return
        const checked = li.attrs.checked == null ? false : null
        view.dispatch(view.state.tr.setNodeMarkup(li.pos, undefined, { ...li.attrs, checked }))
      })
    } catch {
      /* editor mid-teardown or unexpected state — ignore */
    }
  }

  /** Insert a comment marker at the end of the current text block. If text is
   *  selected, place the marker after the selection instead. */
  private insertComment(): void {
    if (!this.crepe) return
    try {
      this.crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const type = state.schema.nodes[FOLIO_COMMENT_NODE]
        if (!type) return

        const { selection } = state
        let insertAt = selection.to
        if (selection.empty) {
          const $from = selection.$from
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).isTextblock) {
              insertAt = $from.end(depth)
              break
            }
          }
        }

        const $insert = state.doc.resolve(insertAt)
        if (!$insert.parent.canReplaceWith($insert.index(), $insert.index(), type)) return

        const node = type.create(createCommentAttrs())
        const tr = state.tr.insert(insertAt, node)
        tr.setSelection(NodeSelection.create(tr.doc, insertAt))
        view.dispatch(tr.scrollIntoView())
      })
    } catch {
      /* editor mid-teardown or schema unavailable — ignore */
    }
  }

  focus(): void {
    if (!this.crepe) return
    try {
      this.crepe.editor.action((ctx) => {
        ctx.get(editorViewCtx).focus()
      })
    } catch {
      /* editor not ready yet */
    }
  }

  destroy(): void {
    this.changeCbs.clear()
    // Chain teardown onto the op queue so it can't interleave with a pending
    // create. We intentionally don't await — destroy() is fire-and-forget per
    // the EditorApi contract.
    this.opQueue = this.opQueue.then(async () => {
      if (this.crepe) {
        const dying = this.crepe
        this.crepe = null
        try {
          await dying.destroy()
        } catch {
          /* already torn down */
        }
      }
    })
    this.root = null
  }

  /** Tear down any existing instance and build a fresh Crepe into `root`,
   *  re-wiring the change listener and re-applying the current theme. All
   *  callers funnel through the op queue to keep create/destroy ordered. */
  private recreate(value: string): Promise<void> {
    const run = this.opQueue.then(async () => {
      if (!this.root) return

      // Tear down the previous instance first.
      if (this.crepe) {
        const old = this.crepe
        this.crepe = null
        try {
          await old.destroy()
        } catch {
          /* ignore */
        }
      }

      // Build the new instance. We disable Crepe's floating selection toolbar
      // (the "bubble") since our persistent top formatting bar replaces it.
      const crepe = new Crepe({
        root: this.root,
        defaultValue: value,
        // Disable Crepe's floating selection toolbar (our persistent top bar
        // replaces it) and its LaTeX math feature, which otherwise treats `$`
        // pairs as inline math — turning dollar amounts like "US$36 billion …
        // $16B" into rendered math. Plain `.md` notes want literal `$`.
        features: { [CrepeFeature.Toolbar]: false, [CrepeFeature.Latex]: false },
      })
      crepe.editor.use(folioCommentPlugins)
      crepe.editor.use(highlightPlugins)
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          this.markdown = markdown
          if (this.suppressChange) return
          this.changeCbs.forEach((cb) => cb(markdown))
        })
      })

      // Suppress change callbacks until the user makes a genuine edit. Loading
      // a document triggers a cascade of *programmatic* markdownUpdated events
      // — initial doc normalization plus async feature init (e.g. CodeMirror
      // code blocks) that can fire long after create() resolves. A timer can't
      // reliably tell those apart from real edits, so instead we lift
      // suppression only on the first real user-input event on the editor DOM.
      this.suppressChange = true
      const gen = ++this.loadGen
      try {
        await crepe.create()
      } catch {
        /* create failed; bail below */
      }

      // If we were destroyed/re-queued while creating, clean up and bail.
      if (!this.root || gen !== this.loadGen) {
        try {
          await crepe.destroy()
        } catch {
          /* ignore */
        }
        return
      }

      this.crepe = crepe
      this.markdown = value
      this.applyTheme(this.theme)

      // Arm the "first user input lifts suppression" listeners.
      const pm = this.root.querySelector<HTMLElement>('.ProseMirror')
      if (pm) {
        const lift = () => {
          if (gen !== this.loadGen) return
          this.suppressChange = false
          for (const ev of USER_INPUT_EVENTS) pm.removeEventListener(ev, lift)
        }
        for (const ev of USER_INPUT_EVENTS) pm.addEventListener(ev, lift)
      }
    })

    this.opQueue = run.catch(() => {
      /* keep the queue alive even if one op throws */
    })
    return run
  }
}
