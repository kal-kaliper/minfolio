// Global custom tooltips for the app's icon controls.
//
// Native HTML `title` tooltips are unreliable in a frameless Electron window
// (window-drag regions and the borderless chrome interfere on macOS), so we
// render our own from each control's accessible label. We read `aria-label`
// (every icon button sets it and keeps it current), strip the native `title`
// to avoid a double tooltip, and show a small positioned bubble after a short
// hover delay.

const SHOW_DELAY_MS = 350
const SELECTOR = '.icon-btn, .fmt-heading'

let tipEl: HTMLElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let current: HTMLElement | null = null

function ensureTip(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'app-tooltip'
    tipEl.setAttribute('role', 'tooltip')
    document.body.appendChild(tipEl)
  }
  return tipEl
}

function labelOf(el: HTMLElement): string {
  // Move any native title onto a data attr so the OS doesn't also show one.
  const title = el.getAttribute('title')
  if (title) {
    el.setAttribute('data-tip', title)
    el.removeAttribute('title')
  }
  return el.getAttribute('aria-label') || el.getAttribute('data-tip') || ''
}

function place(el: HTMLElement, text: string): void {
  const tip = ensureTip()
  tip.textContent = text
  tip.classList.add('is-visible')
  const r = el.getBoundingClientRect()
  const t = tip.getBoundingClientRect()
  let left = r.left + r.width / 2 - t.width / 2
  left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6))
  let top = r.bottom + 6
  if (top + t.height > window.innerHeight - 6) top = r.top - t.height - 6
  tip.style.left = `${Math.round(left)}px`
  tip.style.top = `${Math.round(top)}px`
}

function hide(): void {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  current = null
  tipEl?.classList.remove('is-visible')
}

/** Install the delegated hover listeners. Call once at startup. */
export function initTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>(SELECTOR)
    if (!el || el === current) return
    const text = labelOf(el)
    if (!text) return
    current = el
    if (showTimer) clearTimeout(showTimer)
    showTimer = setTimeout(() => place(el, text), SHOW_DELAY_MS)
  })
  document.addEventListener('pointerout', (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>(SELECTOR)
    if (el && el === current) hide()
  })
  // Any press / scroll / focus loss dismisses immediately.
  document.addEventListener('pointerdown', hide, true)
  window.addEventListener('blur', hide)
  document.addEventListener('scroll', hide, true)
}
