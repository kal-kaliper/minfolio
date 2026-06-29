import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { $command, $inputRule, $markSchema, $remark } from '@milkdown/kit/utils'

const HIGHLIGHT_NODE = 'highlight'

function splitHighlightText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  const pattern = /==([^=\n](?:.*?[^=\n])?)==/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) } as MarkdownNode)
    }
    nodes.push({
      type: HIGHLIGHT_NODE,
      children: [{ type: 'text', value: match[1] ?? '' }],
    } as MarkdownNode)
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) } as MarkdownNode)
  }
  return nodes.length ? nodes : [{ type: 'text', value } as MarkdownNode]
}

function walkMarkdown(node: MarkdownNode): void {
  const children = node.children
  if (!children) return
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    if (child.type === 'text' && typeof child.value === 'string') {
      const split = splitHighlightText(child.value)
      if (split.length !== 1 || split[0]?.value !== child.value) {
        children.splice(i, 1, ...split)
        i += split.length - 1
      }
      continue
    }
    walkMarkdown(child)
  }
}

const highlightRemarkPlugin = $remark<'folioHighlightRemark', undefined>(
  'folioHighlightRemark',
  () => () => (tree) => {
    walkMarkdown(tree as MarkdownNode)
  },
)

export const highlightSchema = $markSchema('highlight', () => ({
  priority: 70,
  parseDOM: [
    { tag: 'mark' },
    { tag: 'span[data-type="highlight"]' },
  ],
  toDOM: () => ['mark', { 'data-type': 'highlight' }, 0],
  parseMarkdown: {
    match: (node) => node.type === HIGHLIGHT_NODE,
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, _mark, node) => {
      state.addNode('text', undefined, `==${node.text ?? node.textContent}==`)
      return true
    },
  },
}))

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () => {
  return toggleMark(highlightSchema.type(ctx))
})

const highlightInputRule = $inputRule((ctx) => {
  return markRule(/(?<![\w:/])==([^=\n](?:.*?[^=\n])?)==(?![\w/])$/, highlightSchema.type(ctx))
})

export const highlightPlugins: MilkdownPlugin[] = [
  ...highlightRemarkPlugin,
  ...highlightSchema,
  highlightInputRule,
  toggleHighlightCommand,
]
