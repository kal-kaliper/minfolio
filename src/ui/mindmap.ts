// Mindmap view — embeds the vendored mindmap engine (public/mindmap/) in an
// iframe and answers its bridge protocol over postMessage. The engine treats
// Minfolio as a tiny "server": it asks for the active file's markdown and writes
// edits back. Saves are persisted through the `onSave` callback, which Minfolio
// wires to its real filesystem.
//
// Protocol:
//   iframe -> host : { source:'mindmap', callId, action, ...params }
//   host -> iframe : { source:'mindmap-host', callId, payload }        (replies)
//   host -> iframe : { source:'mindmap-host', event:{...} }            (changes)

// The engine addresses files by path; we expose the active buffer under one
// stable virtual name. Minfolio owns the real filesystem path.
const VIRTUAL_FILE = 'note.md'

export interface MindmapViewOptions {
  /** Persist edited markdown to the active file. Resolves when written. */
  onSave: (markdown: string) => Promise<void>
  /** Current app theme, read when the iframe is (re)created so the embedded
   *  engine boots in the matching palette. */
  getTheme?: () => 'light' | 'dark'
}

export interface MindmapView {
  /** The container element (already in the DOM); caller controls visibility. */
  readonly el: HTMLElement
  /** Reveal the view and (re)load it with the given markdown. */
  show(markdown: string): void
  /** Hide the view. */
  hide(): void
  /** Push new markdown into a visible map (e.g. after switching tabs). */
  setMarkdown(markdown: string): void
  /** Markdown currently held by the view (reflects saved mindmap edits). */
  getMarkdown(): string
  /** Push the app's day/night theme into the embedded engine. */
  applyTheme(theme: 'light' | 'dark'): void
}

export function createMindmapView(host: HTMLElement, options: MindmapViewOptions): MindmapView {
  host.classList.add('mindmap-host')

  let iframe: HTMLIFrameElement | null = null
  let currentMarkdown = ''
  let revision = 1
  let currentTheme: 'light' | 'dark' = options.getTheme?.() ?? 'dark'

  function reply(callId: number, payload: unknown): void {
    iframe?.contentWindow?.postMessage({ source: 'mindmap-host', callId, payload }, '*')
  }

  function notifyChanged(): void {
    iframe?.contentWindow?.postMessage(
      {
        source: 'mindmap-host',
        event: { type: 'changed', filePath: VIRTUAL_FILE, revision: String(revision) },
      },
      '*',
    )
  }

  async function handleSave(markdown: string): Promise<void> {
    // Persist first; only advance the revision once the write succeeds so a
    // failed save doesn't desync the engine's conflict tracking.
    currentMarkdown = markdown
    await options.onSave(markdown)
    revision += 1
  }

  function onMessage(event: MessageEvent): void {
    if (!iframe || event.source !== iframe.contentWindow) return
    const data = event.data
    if (!data || data.source !== 'mindmap') return

    switch (data.action) {
      case 'getConfig':
        reply(data.callId, { defaultFile: VIRTUAL_FILE })
        break
      case 'loadFile':
        reply(data.callId, {
          exists: true,
          filePath: VIRTUAL_FILE,
          revision: String(revision),
          markdown: currentMarkdown,
        })
        break
      case 'saveFile':
        void handleSave(typeof data.markdown === 'string' ? data.markdown : currentMarkdown)
          .then(() => reply(data.callId, { filePath: VIRTUAL_FILE, revision: String(revision), ok: true }))
          .catch(() =>
            // Report failure as a conflict so the engine keeps the user's edits
            // (dirty) rather than assuming a clean save.
            reply(data.callId, { _status: 409, filePath: VIRTUAL_FILE, revision: String(revision) }),
          )
        break
      case 'watchFile':
      case 'unwatchFile':
      case 'importFile':
      case 'toggleFullscreen':
        reply(data.callId, { ok: true })
        break
      case 'listDir':
        reply(data.callId, { files: [], dirs: [] })
        break
      default:
        reply(data.callId, { error: `Unknown action: ${data.action}` })
    }
  }

  window.addEventListener('message', onMessage)

  function ensureIframe(): void {
    if (iframe) return
    iframe = document.createElement('iframe')
    iframe.className = 'mindmap-frame'
    iframe.title = 'Mindmap'
    // Resolved relative to the app document; the engine lives in dist/mindmap/.
    // The theme param boots the engine in the matching palette.
    iframe.src = `mindmap/index.html?view=mindmap&theme=${currentTheme}`
    host.append(iframe)
  }

  return {
    el: host,
    show(markdown: string): void {
      currentMarkdown = markdown
      revision += 1
      ensureIframe()
      host.style.display = ''
      // If the engine already booted, force a reload to the new content.
      notifyChanged()
    },
    hide(): void {
      host.style.display = 'none'
    },
    setMarkdown(markdown: string): void {
      currentMarkdown = markdown
      revision += 1
      if (iframe) notifyChanged()
    },
    getMarkdown(): string {
      return currentMarkdown
    },
    applyTheme(theme: 'light' | 'dark'): void {
      currentTheme = theme
      iframe?.contentWindow?.postMessage({ source: 'mindmap-host', theme }, '*')
    },
  }
}
