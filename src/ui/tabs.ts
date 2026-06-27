// Tab bar. Renders store.tabs as a horizontally-scrolling row, with a dirty
// dot, a per-tab close button, and active-tab highlighting. Stateless beyond
// the store: it re-renders on the relevant store events.

import { bus, store } from '../store'

export interface TabBarDeps {
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

const ICON_X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

export interface TabBarHandle {
  render: () => void
  dispose: () => void
}

export function createTabBar(el: HTMLElement, deps: TabBarDeps): TabBarHandle {
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
      titleEl.textContent = tab.title || 'Untitled'
      tabEl.append(titleEl)

      const closeBtn = document.createElement('button')
      closeBtn.className = 'tab-close'
      closeBtn.type = 'button'
      closeBtn.title = 'Close tab'
      closeBtn.setAttribute('aria-label', `Close ${tab.title || 'tab'}`)
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

      el.append(tabEl)
    }
  }

  const offTabs = bus.on('tabs:changed', render)
  const offActive = bus.on('active:changed', render)
  const offDirty = bus.on('dirty:changed', render)

  render()

  return {
    render,
    dispose() {
      offTabs()
      offActive()
      offDirty()
    },
  }
}
