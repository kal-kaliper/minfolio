// formatbar.ts — the optional formatting toolbar shown beneath the header.
//
// A single horizontal strip of icon buttons (plus a heading dropdown) that
// issue FormatAction commands against the active editor. It owns no editor
// state: it emits the chosen action and, via update(), reflects the active
// formatting reported back by the editor (so e.g. Bold lights up when the caret
// sits in bold text).

import type { ActiveFormats, FormatAction, UpdateMode } from '../types'

export interface FormatBarHandlers {
  onFormat: (action: FormatAction) => void
  /** Current external-update reconciliation mode (for the bar's toggle). */
  updateMode: UpdateMode
  /** Called when the user flips the update-mode toggle. */
  onToggleUpdateMode: (next: UpdateMode) => void
}

export interface FormatBar {
  el: HTMLElement
  /** Reflect the editor's current active formatting on the controls. */
  update: (active: ActiveFormats) => void
}

// --- inline icons. Uniform 24×24 viewBox, 2px round strokes (Bold a touch
//     heavier for legibility) so the set reads as one consistent family. ------
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
const ICON_BOLD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7.5a3.5 3.5 0 0 1 0 7H7z"/></svg>`
const ICON_ITALIC = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="19" y1="5" x2="11" y2="5"/><line x1="13" y1="19" x2="5" y2="19"/><line x1="15" y1="5" x2="9" y2="19"/></svg>`
const ICON_STRIKE = `<svg viewBox="0 0 24 24" ${STROKE}><path d="M16 5H9.5A2.5 2.5 0 0 0 7.4 8.8"/><path d="M13.5 12A3 3 0 0 1 14 18H7.5"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`
const ICON_CODE = `<svg viewBox="0 0 24 24" ${STROKE}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
const ICON_HIGHLIGHT = `<svg viewBox="0 0 24 24" ${STROKE}><path d="m7 11 6-6 6 6-6 6z"/><path d="m5 19 4-4"/><path d="M3 21h7"/><path d="m14 6 4 4"/></svg>`
const ICON_COMMENT = `<svg viewBox="0 0 24 24" ${STROKE}><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H11l-4.2 4v-4.2A3.5 3.5 0 0 1 5 10.7Z"/></svg>`
const ICON_BULLET = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none"/></svg>`
const ICON_ORDERED = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4.4 9.5V5L3 6"/><path d="M3.2 14.6a1.2 1.2 0 0 1 2 .8c0 .9-1.9 1.4-2 3.1h2.1"/></svg>`
const ICON_TASK = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="11" y1="6" x2="20" y2="6"/><line x1="11" y1="18" x2="20" y2="18"/><polyline points="3 6.5 4.6 8 7.5 4.5"/><polyline points="3 16.5 4.6 18 7.5 14.5"/></svg>`
const ICON_QUOTE = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="5" y1="5" x2="5" y2="19"/><line x1="10" y1="8" x2="19" y2="8"/><line x1="10" y1="12" x2="19" y2="12"/><line x1="10" y1="16" x2="16" y2="16"/></svg>`
const ICON_CODEBLOCK = `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="4" width="18" height="16" rx="2.5"/><polyline points="9 9.5 7 12 9 14.5"/><polyline points="15 9.5 17 12 15 14.5"/></svg>`
const ICON_TABLE = `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="4" x2="9" y2="20"/></svg>`
const ICON_DIVIDER = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="4" y1="12" x2="20" y2="12"/><circle cx="7" cy="7" r="0.6" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="0.6" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="0.6" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r="0.6" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>`
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" ${STROKE}><polyline points="6 9 12 15 18 9"/></svg>`
const ICON_UNDO = `<svg viewBox="0 0 24 24" ${STROKE}><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/></svg>`
const ICON_REDO = `<svg viewBox="0 0 24 24" ${STROKE}><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13"/></svg>`
// git-merge (auto-merge mode) vs refresh (reload-only mode).
const ICON_MERGE = `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="9" r="2.6"/><path d="M6 8.6v6.8"/><path d="M18 11.6a6 6 0 0 1-6 6H8.6"/></svg>`
const ICON_RELOAD = `<svg viewBox="0 0 24 24" ${STROKE}><path d="M3 11a8 8 0 0 1 13.7-5.4L21 9"/><polyline points="21 4 21 9 16 9"/><path d="M21 13a8 8 0 0 1-13.7 5.4L3 15"/><polyline points="3 20 3 15 8 15"/></svg>`

function divider(): HTMLElement {
  const d = document.createElement('span')
  d.className = 'fmt-sep'
  return d
}

/**
 * Build the formatting toolbar into `host`. Returns an update() the host calls
 * whenever the editor selection moves, to keep the active-state highlight in
 * sync with the caret.
 */
export function createFormatBar(host: HTMLElement, handlers: FormatBarHandlers): FormatBar {
  host.innerHTML = ''
  const emit = (a: FormatAction): void => handlers.onFormat(a)

  // Toggle buttons keyed by the ActiveFormats field they reflect, so update()
  // can flip their highlight without per-button branching.
  const toggleBtns = new Map<keyof ActiveFormats, HTMLButtonElement>()

  const makeBtn = (
    title: string,
    svg: string,
    onClick: () => void,
    stateKey?: keyof ActiveFormats,
  ): HTMLButtonElement => {
    const b = document.createElement('button')
    b.className = 'icon-btn fmt-btn'
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.innerHTML = svg
    // Don't steal the editor selection when pressing a toolbar control.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      onClick()
    })
    if (stateKey) toggleBtns.set(stateKey, b)
    return b
  }

  // --- Heading dropdown (paragraph + H1–H6) with a custom chevron so it isn't
  //     the raw OS <select>. -------------------------------------------------
  // Undo / redo. Multi-level — the editor's history stack (ProseMirror) holds
  // many steps; these buttons just drive it and disable when the stack is empty.
  const undoBtn = makeBtn('Undo', ICON_UNDO, () => emit({ type: 'undo' }))
  const redoBtn = makeBtn('Redo', ICON_REDO, () => emit({ type: 'redo' }))

  const headingWrap = document.createElement('div')
  headingWrap.className = 'fmt-heading-wrap'

  const headingSel = document.createElement('select')
  headingSel.className = 'fmt-heading'
  headingSel.title = 'Paragraph / heading level'
  headingSel.setAttribute('aria-label', 'Paragraph or heading level')
  const opts: Array<[string, string]> = [
    ['Paragraph', '0'],
    ['Heading 1', '1'],
    ['Heading 2', '2'],
    ['Heading 3', '3'],
    ['Heading 4', '4'],
    ['Heading 5', '5'],
    ['Heading 6', '6'],
  ]
  // Placeholder shown when the block is none of the above (e.g. a list item).
  const placeholder = document.createElement('option')
  placeholder.textContent = 'Style'
  placeholder.value = ''
  placeholder.hidden = true
  headingSel.append(placeholder)
  for (const [label, value] of opts) {
    const o = document.createElement('option')
    o.textContent = label
    o.value = value
    headingSel.append(o)
  }
  headingSel.value = ''
  headingSel.addEventListener('change', () => {
    const level = Number(headingSel.value)
    if (!Number.isNaN(level)) emit({ type: 'heading', level })
  })

  const chevron = document.createElement('span')
  chevron.className = 'fmt-chevron'
  chevron.innerHTML = ICON_CHEVRON
  headingWrap.append(headingSel, chevron)

  host.append(
    undoBtn,
    redoBtn,
    divider(),
    headingWrap,
    divider(),
    makeBtn('Bold', ICON_BOLD, () => emit({ type: 'bold' }), 'bold'),
    makeBtn('Italic', ICON_ITALIC, () => emit({ type: 'italic' }), 'italic'),
    makeBtn('Strikethrough', ICON_STRIKE, () => emit({ type: 'strike' }), 'strike'),
    makeBtn('Inline code', ICON_CODE, () => emit({ type: 'code' }), 'code'),
    makeBtn('Highlight', ICON_HIGHLIGHT, () => emit({ type: 'highlight' }), 'highlight'),
    makeBtn('Add comment', ICON_COMMENT, () => emit({ type: 'comment' })),
    divider(),
    makeBtn('Bullet list', ICON_BULLET, () => emit({ type: 'bulletList' }), 'bulletList'),
    makeBtn('Numbered list', ICON_ORDERED, () => emit({ type: 'orderedList' }), 'orderedList'),
    makeBtn('Task list', ICON_TASK, () => emit({ type: 'taskList' }), 'taskList'),
    divider(),
    makeBtn('Quote', ICON_QUOTE, () => emit({ type: 'quote' }), 'quote'),
    makeBtn('Code block', ICON_CODEBLOCK, () => emit({ type: 'codeBlock' }), 'codeBlock'),
    makeBtn('Table', ICON_TABLE, () => emit({ type: 'table' })),
    makeBtn('Divider', ICON_DIVIDER, () => emit({ type: 'divider' })),
  )

  // External-update mode toggle, pushed to the far right. Reflects how the app
  // reconciles changes made to the open file by another window or app.
  let mode: UpdateMode = handlers.updateMode
  const spacer = document.createElement('span')
  spacer.className = 'fmt-spacer'
  // Short label so the icon isn't cryptic about what the toggle controls.
  const modeLabel = document.createElement('span')
  modeLabel.className = 'fmt-mode-label'
  const modeBtn = makeBtn('', '', () => {
    mode = mode === 'merge' ? 'reload' : 'merge'
    handlers.onToggleUpdateMode(mode)
    syncMode()
  })
  modeBtn.classList.add('fmt-mode')
  function syncMode(): void {
    const merging = mode === 'merge'
    modeBtn.innerHTML = merging ? ICON_MERGE : ICON_RELOAD
    modeLabel.textContent = merging ? 'Auto-merge' : 'Reload only'
    const title = merging
      ? 'External changes: auto-merge (non-conflicting edits merge automatically; you’re still prompted on a true conflict)'
      : 'External changes: reload and prompt on any conflict'
    modeBtn.title = title
    modeBtn.setAttribute('aria-label', title)
    modeBtn.classList.toggle('is-active', merging)
  }
  syncMode()
  host.append(spacer, modeLabel, modeBtn)

  const update = (active: ActiveFormats): void => {
    undoBtn.disabled = !active.canUndo
    redoBtn.disabled = !active.canRedo
    for (const [key, btn] of toggleBtns) {
      let on = Boolean(active[key])
      // A task list is also a bullet_list under the hood — don't double-light.
      if (key === 'bulletList' && active.taskList) on = false
      btn.classList.toggle('is-active', on)
    }
    headingSel.value = active.heading != null ? String(active.heading) : ''
  }

  return { el: host, update }
}
