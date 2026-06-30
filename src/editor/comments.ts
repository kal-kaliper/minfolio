import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { $nodeSchema, $remark, $view } from '@milkdown/kit/utils'

export const FOLIO_COMMENT_NODE = 'folio_comment'

const MDAST_COMMENT_TYPE = 'folioComment'
const COMMENT_PREFIX = 'folio-comment:'

export interface FolioCommentAttrs {
  id: string
  text: string
  createdAt: string
  updatedAt: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createCommentAttrs(text = ''): FolioCommentAttrs {
  const now = nowIso()
  return {
    id: randomId(),
    text,
    createdAt: now,
    updatedAt: now,
  }
}

// Comments live inside an HTML comment so they stay invisible when the markdown
// is rendered elsewhere, but the body is plain, human- and LLM-readable text —
// no encoding. The one sequence that can't appear literally is the comment
// terminator `-->`, which we escape reversibly; newlines collapse to spaces so
// the marker stays inline. Metadata (id, timestamps) is intentionally not
// persisted: the id is only needed in-session and is regenerated on load.
function escapeCommentText(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/-->/g, '--&gt;')
}

function unescapeCommentText(text: string): string {
  return text.replace(/--&gt;/g, '-->')
}

function commentToken(attrs: FolioCommentAttrs): string {
  return `<!-- ${COMMENT_PREFIX} ${escapeCommentText(attrs.text)} -->`
}

// Match the readable form `<!-- folio-comment: ... -->`. The required space
// after `<!--` distinguishes it from the obsolete base64 form, which is no
// longer read.
const COMMENT_PATTERN = /^<!--\s+folio-comment:\s?([\s\S]*?)\s*-->$/

function parseCommentToken(value: unknown): FolioCommentAttrs | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(COMMENT_PATTERN)
  if (!match) return null
  const now = nowIso()
  return {
    id: randomId(),
    text: unescapeCommentText(match[1] ?? '').trim(),
    createdAt: now,
    updatedAt: now,
  }
}

function walkMarkdown(node: MarkdownNode): void {
  const children = node.children
  if (!children) return
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    const attrs = child.type === 'html' ? parseCommentToken(child.value) : null
    if (attrs) {
      children[i] = {
        type: MDAST_COMMENT_TYPE,
        id: attrs.id,
        text: attrs.text,
        createdAt: attrs.createdAt,
        updatedAt: attrs.updatedAt,
      } as MarkdownNode
      continue
    }
    walkMarkdown(child)
  }
}

const commentRemarkPlugin = $remark<'folioCommentRemark', undefined>(
  'folioCommentRemark',
  () => () => (tree) => {
    walkMarkdown(tree as MarkdownNode)
  },
)

export const commentSchema = $nodeSchema(FOLIO_COMMENT_NODE, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  marks: '',
  attrs: {
    id: { default: '' },
    text: { default: '' },
    createdAt: { default: '' },
    updatedAt: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-type="folio-comment"]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          id: el.dataset.id ?? '',
          text: el.dataset.text ?? '',
          createdAt: el.dataset.createdAt ?? '',
          updatedAt: el.dataset.updatedAt ?? '',
        }
      },
    },
  ],
  toDOM: (node) => [
    'span',
    {
      'data-type': 'folio-comment',
      'data-id': node.attrs.id,
      'data-text': node.attrs.text,
      'data-created-at': node.attrs.createdAt,
      'data-updated-at': node.attrs.updatedAt,
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === MDAST_COMMENT_TYPE,
    runner: (state, node, type) => {
      state.addNode(type, {
        id: typeof node.id === 'string' ? node.id : randomId(),
        text: typeof node.text === 'string' ? node.text : '',
        createdAt: typeof node.createdAt === 'string' ? node.createdAt : nowIso(),
        updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : nowIso(),
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === FOLIO_COMMENT_NODE,
    runner: (state, node) => {
      state.addNode('html', undefined, commentToken(node.attrs as FolioCommentAttrs))
    },
  },
}))

class CommentNodeView implements NodeView {
  dom: HTMLElement
  private node: ProseNode
  private view: EditorView
  private getPos: () => number | undefined
  private open = false
  private chip: HTMLButtonElement | null = null
  private popover: HTMLElement | null = null
  private preview: HTMLElement | null = null
  private textarea: HTMLTextAreaElement | null = null
  private readonly reposition = () => this.positionPopover()
  private readonly repositionPreview = () => this.positionPreview()
  private readonly closeOnOutsidePointer = (event: PointerEvent) => {
    const target = event.target as globalThis.Node | null
    if (!target) return
    if (this.dom.contains(target) || this.popover?.contains(target)) return
    this.closeEditor()
  }

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('span')
    this.dom.className = 'folio-comment-node'
    this.dom.contentEditable = 'false'
    this.render()
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode(): void {
    this.openEditor()
  }

  stopEvent(event: Event): boolean {
    const target = event.target as globalThis.Node
    return this.dom.contains(target) || Boolean(this.popover?.contains(target)) || Boolean(this.preview?.contains(target))
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.removePopover()
    this.removePreview()
  }

  private attrs(): FolioCommentAttrs {
    return {
      id: String(this.node.attrs.id || randomId()),
      text: String(this.node.attrs.text || ''),
      createdAt: String(this.node.attrs.createdAt || nowIso()),
      updatedAt: String(this.node.attrs.updatedAt || nowIso()),
    }
  }

  private render(): void {
    this.removePreview()
    this.dom.innerHTML = ''
    this.dom.classList.toggle('is-open', this.open)
    const button = document.createElement('button')
    button.className = 'folio-comment-chip'
    button.type = 'button'
    button.setAttribute('aria-label', 'Open comment')
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H11l-4.2 4v-4.2A3.5 3.5 0 0 1 5 10.7Z"/></svg>'
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => this.openEditor())
    button.addEventListener('pointerenter', () => this.showPreview())
    button.addEventListener('pointerleave', () => this.removePreview())
    button.addEventListener('pointerover', () => this.showPreview())
    button.addEventListener('mouseenter', () => this.showPreview())
    button.addEventListener('mouseleave', () => this.removePreview())
    button.addEventListener('mouseover', () => this.showPreview())
    button.addEventListener('mousemove', () => this.showPreview())
    button.addEventListener('focus', () => this.showPreview())
    button.addEventListener('blur', () => this.removePreview())
    this.chip = button
    this.dom.append(button)
    if (this.open) this.renderEditor()
    else this.removePopover()
  }

  private renderEditor(): void {
    if (this.popover) {
      this.applyPopoverTheme()
      requestAnimationFrame(this.reposition)
      return
    }

    const wrap = document.createElement('div')
    wrap.className = 'folio-comment-popover'
    wrap.setAttribute('role', 'dialog')
    wrap.setAttribute('aria-label', 'Comment')

    const input = document.createElement('textarea')
    input.className = 'folio-comment-input'
    input.rows = 1
    input.placeholder = 'Comment'
    input.value = this.attrs().text
    input.addEventListener('input', () => {
      this.growInput()
      this.positionPopover()
    })
    input.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        this.save()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.closeEditor()
        this.view.focus()
      }
    })
    this.textarea = input

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'folio-comment-action folio-comment-delete'
    del.textContent = 'Delete'
    del.addEventListener('mousedown', (event) => event.preventDefault())
    del.addEventListener('click', () => this.delete())

    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'folio-comment-action folio-comment-save'
    save.textContent = 'Save'
    save.addEventListener('mousedown', (event) => event.preventDefault())
    save.addEventListener('click', () => this.save())

    wrap.append(del, input, save)
    this.popover = wrap
    this.removePreview()
    this.applyPopoverTheme()
    document.body.append(wrap)
    window.addEventListener('resize', this.reposition)
    window.addEventListener('scroll', this.reposition, true)
    document.addEventListener('pointerdown', this.closeOnOutsidePointer)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      this.growInput()
      this.positionPopover()
    })
  }

  private openEditor(): void {
    this.open = true
    this.removePreview()
    this.render()
  }

  private growInput(): void {
    if (!this.textarea) return
    this.textarea.style.height = 'auto'
    this.textarea.style.height = `${this.textarea.scrollHeight}px`
  }

  private closeEditor(): void {
    if (!this.attrs().text.trim() && !this.textarea?.value.trim()) {
      this.delete()
      return
    }
    this.open = false
    this.render()
  }

  private applyPopoverTheme(): void {
    if (!this.popover) return
    const themeRoot = this.view.dom.closest<HTMLElement>('[data-theme]')
    this.popover.dataset.theme = themeRoot?.dataset.theme || 'light'
  }

  private applyPreviewTheme(): void {
    if (!this.preview) return
    const themeRoot = this.view.dom.closest<HTMLElement>('[data-theme]')
    this.preview.dataset.theme = themeRoot?.dataset.theme || 'light'
  }

  private positionPopover(): void {
    if (!this.popover || !this.chip?.isConnected) return

    this.applyPopoverTheme()
    const chipRect = this.chip.getBoundingClientRect()
    const popoverRect = this.popover.getBoundingClientRect()
    const margin = 10
    const viewportPadding = 12
    const idealLeft = chipRect.left + chipRect.width / 2 - popoverRect.width / 2
    const maxLeft = window.innerWidth - popoverRect.width - viewportPadding
    const left = Math.max(viewportPadding, Math.min(idealLeft, maxLeft))
    const above = chipRect.top - popoverRect.height - margin
    const below = chipRect.bottom + margin
    const placeBelow = above < viewportPadding
    const top = placeBelow ? Math.min(below, window.innerHeight - popoverRect.height - viewportPadding) : above
    const arrowLeft = chipRect.left + chipRect.width / 2 - left

    this.popover.style.left = `${left}px`
    this.popover.style.top = `${Math.max(viewportPadding, top)}px`
    this.popover.style.setProperty('--folio-comment-arrow-left', `${Math.max(16, Math.min(arrowLeft, popoverRect.width - 16))}px`)
    this.popover.classList.toggle('is-below', placeBelow)
  }

  private showPreview(): void {
    if (this.open || this.preview) return
    const text = this.attrs().text.trim()
    if (!text) return

    const preview = document.createElement('div')
    preview.className = 'folio-comment-preview'
    preview.textContent = text
    preview.setAttribute('role', 'tooltip')
    this.preview = preview
    this.applyPreviewTheme()
    document.body.append(preview)
    window.addEventListener('resize', this.repositionPreview)
    window.addEventListener('scroll', this.repositionPreview, true)
    requestAnimationFrame(this.repositionPreview)
  }

  private positionPreview(): void {
    if (!this.preview || !this.chip?.isConnected) return

    this.applyPreviewTheme()
    const chipRect = this.chip.getBoundingClientRect()
    const previewRect = this.preview.getBoundingClientRect()
    const margin = 8
    const viewportPadding = 12
    const idealLeft = chipRect.left + chipRect.width / 2 - previewRect.width / 2
    const maxLeft = window.innerWidth - previewRect.width - viewportPadding
    const left = Math.max(viewportPadding, Math.min(idealLeft, maxLeft))
    const above = chipRect.top - previewRect.height - margin
    const below = chipRect.bottom + margin
    const placeBelow = above < viewportPadding
    const top = placeBelow ? Math.min(below, window.innerHeight - previewRect.height - viewportPadding) : above
    const arrowLeft = chipRect.left + chipRect.width / 2 - left

    this.preview.style.left = `${left}px`
    this.preview.style.top = `${Math.max(viewportPadding, top)}px`
    this.preview.style.setProperty('--folio-comment-arrow-left', `${Math.max(14, Math.min(arrowLeft, previewRect.width - 14))}px`)
    this.preview.classList.toggle('is-below', placeBelow)
  }

  private removePopover(): void {
    if (!this.popover) return
    this.popover.remove()
    this.popover = null
    this.textarea = null
    window.removeEventListener('resize', this.reposition)
    window.removeEventListener('scroll', this.reposition, true)
    document.removeEventListener('pointerdown', this.closeOnOutsidePointer)
  }

  private removePreview(): void {
    if (!this.preview) return
    this.preview.remove()
    this.preview = null
    window.removeEventListener('resize', this.repositionPreview)
    window.removeEventListener('scroll', this.repositionPreview, true)
  }

  private save(): void {
    const pos = this.getPos()
    if (typeof pos !== 'number' || !this.textarea) return
    const text = this.textarea.value.trim()
    if (!text) {
      this.delete()
      return
    }
    const attrs = {
      ...this.attrs(),
      text,
      updatedAt: nowIso(),
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, attrs)
    this.open = false
    this.removePopover()
    this.view.dispatch(tr)
    requestAnimationFrame(() => this.view.focus())
  }

  private delete(): void {
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    this.removePopover()
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
    requestAnimationFrame(() => this.view.focus())
  }
}

const commentView = $view(commentSchema.node, () => (node, view, getPos) => {
  return new CommentNodeView(node, view, getPos as () => number | undefined)
})

export const folioCommentPlugins: MilkdownPlugin[] = [
  ...commentRemarkPlugin,
  ...commentSchema,
  commentView,
]
