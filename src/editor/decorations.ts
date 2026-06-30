import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

interface Segment {
  from: number
  to: number
  start: number
  end: number
}

export interface TextRange {
  from: number
  to: number
}

export interface FolioDecorationMeta {
  searchQuery: string
  searchIndex: number
  updateSnippets: string[]
  showExternalUpdates: boolean
}

export interface FolioDecorationState extends FolioDecorationMeta {
  decorations: DecorationSet
  searchMatches: TextRange[]
  currentMatch: TextRange | null
  currentSearchIndex: number
}

export const folioDecorationKey = new PluginKey<FolioDecorationState>('FOLIO_DECORATIONS')

const EMPTY_META: FolioDecorationMeta = {
  searchQuery: '',
  searchIndex: 0,
  updateSnippets: [],
  showExternalUpdates: false,
}

function normalize(value: string): string {
  return value.toLocaleLowerCase()
}

function buildTextIndex(doc: ProseNode): { text: string; segments: Segment[] } {
  const chunks: string[] = []
  const segments: Segment[] = []
  let offset = 0

  doc.descendants((node, pos) => {
    if (!node.isText) return true
    const value = node.text ?? ''
    if (!value) return false
    const start = offset
    offset += value.length
    chunks.push(value)
    segments.push({ from: pos, to: pos + value.length, start, end: offset })
    return false
  })

  return { text: chunks.join(''), segments }
}

function findMatches(text: string, query: string, limit = 800): TextRange[] {
  const needle = normalize(query.trim())
  if (!needle) return []
  const haystack = normalize(text)
  const out: TextRange[] = []
  let from = 0
  while (out.length < limit) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) break
    out.push({ from: index, to: index + needle.length })
    from = index + Math.max(needle.length, 1)
  }
  return out
}

function toDocRanges(match: TextRange, segments: Segment[]): TextRange[] {
  const ranges: TextRange[] = []
  for (const segment of segments) {
    if (segment.end <= match.from) continue
    if (segment.start >= match.to) break
    const from = segment.from + Math.max(0, match.from - segment.start)
    const to = segment.from + Math.min(segment.end, match.to) - segment.start
    if (to > from) ranges.push({ from, to })
  }
  return ranges
}

function uniqueSnippets(snippets: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of snippets) {
    const value = raw.replace(/\s+/g, ' ').trim()
    const key = normalize(value)
    if (value.length < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= 40) break
  }
  return out
}

function buildState(doc: ProseNode, meta: FolioDecorationMeta): FolioDecorationState {
  const index = buildTextIndex(doc)
  const decorations: Decoration[] = []
  const searchMatches = findMatches(index.text, meta.searchQuery)
  const currentSearchIndex =
    searchMatches.length === 0
      ? 0
      : ((meta.searchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length

  let currentMatch: TextRange | null = null
  searchMatches.forEach((match, i) => {
    const cls = i === currentSearchIndex ? 'folio-find-hit folio-find-hit-current' : 'folio-find-hit'
    const docRanges = toDocRanges(match, index.segments)
    if (i === currentSearchIndex && docRanges.length > 0) {
      currentMatch = { from: docRanges[0].from, to: docRanges[docRanges.length - 1].to }
    }
    for (const range of docRanges) {
      decorations.push(Decoration.inline(range.from, range.to, { class: cls }))
    }
  })

  if (meta.showExternalUpdates) {
    for (const snippet of uniqueSnippets(meta.updateSnippets)) {
      for (const match of findMatches(index.text, snippet, 120)) {
        for (const range of toDocRanges(match, index.segments)) {
          decorations.push(
            Decoration.inline(range.from, range.to, { class: 'folio-external-update-hit' }),
          )
        }
      }
    }
  }

  return {
    ...meta,
    currentSearchIndex,
    currentMatch,
    decorations: DecorationSet.create(doc, decorations),
    searchMatches,
  }
}

export const folioDecorationPlugins: MilkdownPlugin[] = [
  $prose(() => {
    return new Plugin<FolioDecorationState>({
      key: folioDecorationKey,
      state: {
        init: (_config, state) => buildState(state.doc, EMPTY_META),
        apply: (tr, value) => {
          const meta = tr.getMeta(folioDecorationKey) as Partial<FolioDecorationMeta> | undefined
          const nextMeta: FolioDecorationMeta = {
            searchQuery: meta?.searchQuery ?? value.searchQuery,
            searchIndex: meta?.searchIndex ?? value.searchIndex,
            updateSnippets: meta?.updateSnippets ?? value.updateSnippets,
            showExternalUpdates: meta?.showExternalUpdates ?? value.showExternalUpdates,
          }
          return buildState(tr.doc, nextMeta)
        },
      },
      props: {
        decorations(state) {
          return folioDecorationKey.getState(state)?.decorations ?? null
        },
      },
    })
  }),
]
