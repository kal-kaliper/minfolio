// Tab bar. Renders store.tabs as a horizontally-scrolling row, with a dirty
// dot, a per-tab close button, and active-tab highlighting. Stateless beyond
// the store: it re-renders on the relevant store events.

import { bus, store } from '../store'

export interface TabBarDeps {
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** Reveal the tab's file in Finder/Explorer (desktop). Omitted off-desktop. */
  onReveal?: (id: string) => void
}

/** A minimal one-off context menu anchored at (x, y). Dismisses on any outside
 *  interaction. */
function showContextMenu(x: number, y: number, items: Array<{ label: string; onClick: () => void }>): void {
  document.querySelector('.ctx-menu')?.remove()
  const menu = document.createElement('div')
  menu.className = 'ctx-menu'
  for (const item of items) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ctx-item'
    b.textContent = item.label
    b.addEventListener('click', () => {
      item.onClick()
      menu.remove()
    })
    menu.append(b)
  }
  document.body.append(menu)
  // Clamp to the viewport.
  const r = menu.getBoundingClientRect()
  menu.style.left = `${Math.round(Math.min(x, window.innerWidth - r.width - 6))}px`
  menu.style.top = `${Math.round(Math.min(y, window.innerHeight - r.height - 6))}px`
  const dismiss = (e: Event): void => {
    if (e instanceof MouseEvent && menu.contains(e.target as Node)) return
    menu.remove()
    document.removeEventListener('pointerdown', dismiss, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', dismiss)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss(e)
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', dismiss)
  }, 0)
}

const ICON_X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

export interface TabBarHandle {
  render: () => void
  dispose: () => void
}

export function createTabBar(el: HTMLElement, deps: TabBarDeps): TabBarHandle {
  let scrollRaf: number | null = null

  function ensureActiveTabVisible(): void {
    scrollRaf = null
    const activeEl = el.querySelector<HTMLElement>('.tab.is-active')
    if (!activeEl || el.clientWidth <= 0) return

    const pad = 8
    const containerRect = el.getBoundingClientRect()
    const activeRect = activeEl.getBoundingClientRect()
    let nextLeft = el.scrollLeft

    if (activeRect.left < containerRect.left + pad) {
      nextLeft += activeRect.left - containerRect.left - pad
    } else if (activeRect.right > containerRect.right - pad) {
      nextLeft += activeRect.right - containerRect.right + pad
    }

    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    nextLeft = Math.max(0, Math.min(maxLeft, nextLeft))
    if (Math.abs(nextLeft - el.scrollLeft) > 0.5) el.scrollTo({ left: nextLeft, behavior: 'auto' })
  }

  function scheduleActiveTabScroll(): void {
    if (scrollRaf !== null) cancelAnimationFrame(scrollRaf)
    scrollRaf = requestAnimationFrame(ensureActiveTabVisible)
  }

  function render(): void {
    el.innerHTML = ''
    for (const tab of store.tabs) {
      const tabEl = document.createElement('div')
      tabEl.className = 'tab'
      tabEl.setAttribute('role', 'tab')
      tabEl.dataset.tabId = tab.id
      if (tab.id === store.activeTabId) {
        tabEl.classList.add('is-active')
        tabEl.setAttribute('aria-selected', 'true')
      }

      if (tab.dirty) {
        const dot = document.createElement('span')
        dot.className = 'tab-dirty'
        dot.title = 'Unsaved changes'
        tabEl.append(dot)
      }

      const titleEl = document.createElement('span')
      titleEl.className = 'tab-title'
      const title = tab.title || 'Untitled'
      titleEl.textContent = title
      titleEl.title = title
      tabEl.append(titleEl)

      const closeBtn = document.createElement('button')
      closeBtn.className = 'tab-close'
      closeBtn.type = 'button'
      closeBtn.title = 'Close tab'
      closeBtn.setAttribute('aria-label', `Close ${title}`)
      closeBtn.innerHTML = ICON_X
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        deps.onClose(tab.id)
      })
      tabEl.append(closeBtn)

      tabEl.addEventListener('click', () => {
        if (tab.id !== store.activeTabId) deps.onActivate(tab.id)
      })

      // Middle-click closes, matching common editor conventions.
      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault()
          deps.onClose(tab.id)
        }
      })

      // Right-click → context menu (desktop): reveal the file, or close.
      if (deps.onReveal) {
        tabEl.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          const items: Array<{ label: string; onClick: () => void }> = []
          if (tab.path || tab.absPath) {
            items.push({ label: 'Reveal in Finder', onClick: () => deps.onReveal!(tab.id) })
          }
          items.push({ label: 'Close tab', onClick: () => deps.onClose(tab.id) })
          showContextMenu(e.clientX, e.clientY, items)
        })
      }

      el.append(tabEl)
    }
    scheduleActiveTabScroll()
  }

  const offTabs = bus.on('tabs:changed', render)
  const offActive = bus.on('active:changed', render)
  const offDirty = bus.on('dirty:changed', render)
  const resizeObserver = new ResizeObserver(scheduleActiveTabScroll)
  resizeObserver.observe(el)

  render()

  return {
    render,
    dispose() {
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf)
      resizeObserver.disconnect()
      offTabs()
      offActive()
      offDirty()
    },
  }
}
