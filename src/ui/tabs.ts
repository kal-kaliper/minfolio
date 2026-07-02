// Tab bar. Renders store.tabs as a horizontally-scrolling row, with a dirty
// dot, a per-tab close button, and active-tab highlighting. Stateless beyond
// the store: it re-renders on the relevant store events.

import { bus, store } from '../store'

export interface TabBarDeps {
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** Reveal the tab's file in Finder/Explorer (desktop). Omitted off-desktop. */
  onReveal?: (id: string) => void
  /** Copy the tab's fully resolved on-disk path (desktop). Omitted off-desktop. */
  onCopyPath?: (id: string) => void
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
  let measureRaf: number | null = null
  let tooltipEl: HTMLElement | null = null

  function ensureTooltip(): HTMLElement {
    if (tooltipEl) return tooltipEl
    tooltipEl = document.createElement('div')
    tooltipEl.className = 'tab-tooltip'
    tooltipEl.hidden = true
    document.body.append(tooltipEl)
    return tooltipEl
  }

  function hideTooltip(): void {
    if (tooltipEl) tooltipEl.hidden = true
  }

  function showTooltipFor(tabEl: HTMLElement, text: string): void {
    const tooltip = ensureTooltip()
    tooltip.textContent = text
    tooltip.hidden = false

    const tabRect = tabEl.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const viewportPad = 8
    const left = Math.max(
      viewportPad,
      Math.min(
        tabRect.left + (tabRect.width - tooltipRect.width) / 2,
        window.innerWidth - tooltipRect.width - viewportPad,
      ),
    )
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${tabRect.bottom + 6}px`
  }

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

  function markTooltipTabs(): void {
    measureRaf = null
    el.querySelectorAll<HTMLElement>('.tab').forEach((tabEl) => {
      const title = tabEl.dataset.fullTitle ?? ''
      tabEl.classList.toggle('has-title-tooltip', Boolean(title))
      if (title) {
        tabEl.setAttribute('aria-label', title)
      } else {
        tabEl.removeAttribute('aria-label')
      }
    })
  }

  function scheduleTitleMeasurement(): void {
    if (measureRaf !== null) cancelAnimationFrame(measureRaf)
    measureRaf = requestAnimationFrame(markTooltipTabs)
  }

  function render(): void {
    el.innerHTML = ''
    for (const tab of store.tabs) {
      const tabEl = document.createElement('div')
      tabEl.className = 'tab'
      tabEl.setAttribute('role', 'tab')
      tabEl.dataset.tabId = tab.id
      const title = tab.title || 'Untitled'
      const path = tab.absPath ?? tab.path ?? ''
      tabEl.dataset.fullTitle = path ? `${title}\n${path}` : title
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
      titleEl.textContent = title
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
      tabEl.addEventListener('mouseenter', () => {
        const tooltip = tabEl.dataset.fullTitle ?? title
        if (tabEl.classList.contains('has-title-tooltip')) showTooltipFor(tabEl, tooltip)
      })
      tabEl.addEventListener('mouseleave', hideTooltip)
      tabEl.addEventListener('blur', hideTooltip)

      // Middle-click closes, matching common editor conventions.
      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault()
          deps.onClose(tab.id)
        }
      })

      // Right-click → context menu (desktop): file actions, or close.
      if (deps.onReveal || deps.onCopyPath) {
        tabEl.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          const items: Array<{ label: string; onClick: () => void }> = []
          if (tab.path || tab.absPath) {
            if (deps.onReveal) items.push({ label: 'Reveal in Finder', onClick: () => deps.onReveal!(tab.id) })
            if (deps.onCopyPath) items.push({ label: 'Copy Final Path', onClick: () => deps.onCopyPath!(tab.id) })
          }
          items.push({ label: 'Close tab', onClick: () => deps.onClose(tab.id) })
          showContextMenu(e.clientX, e.clientY, items)
        })
      }

      el.append(tabEl)
    }
    scheduleActiveTabScroll()
    scheduleTitleMeasurement()
  }

  const offTabs = bus.on('tabs:changed', render)
  const offActive = bus.on('active:changed', render)
  const offDirty = bus.on('dirty:changed', render)
  const resizeObserver = new ResizeObserver(() => {
    hideTooltip()
    scheduleActiveTabScroll()
    scheduleTitleMeasurement()
  })
  resizeObserver.observe(el)
  el.addEventListener('scroll', hideTooltip)

  render()

  return {
    render,
    dispose() {
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf)
      if (measureRaf !== null) cancelAnimationFrame(measureRaf)
      tooltipEl?.remove()
      resizeObserver.disconnect()
      el.removeEventListener('scroll', hideTooltip)
      offTabs()
      offActive()
      offDirty()
    },
  }
}
