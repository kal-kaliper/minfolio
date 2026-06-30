export interface FindResult {
  count: number
  index: number
}

export interface FindBarHandlers {
  onQuery: (query: string) => FindResult
  onNext: () => FindResult
  onPrevious: () => FindResult
  onClose: () => void
}

export interface FindBar {
  open: () => void
  close: () => void
  focus: () => void
  isOpen: () => boolean
}

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
const ICON_SEARCH = `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`
const ICON_UP = `<svg viewBox="0 0 24 24" ${STROKE}><polyline points="18 15 12 9 6 15"/></svg>`
const ICON_DOWN = `<svg viewBox="0 0 24 24" ${STROKE}><polyline points="6 9 12 15 18 9"/></svg>`
const ICON_X = `<svg viewBox="0 0 24 24" ${STROKE}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

export function createFindBar(host: HTMLElement, handlers: FindBarHandlers): FindBar {
  host.innerHTML = ''
  host.hidden = true

  const icon = document.createElement('span')
  icon.className = 'find-icon'
  icon.innerHTML = ICON_SEARCH

  const input = document.createElement('input')
  input.className = 'find-input'
  input.type = 'search'
  input.placeholder = 'Find in note'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('aria-label', 'Find in note')

  const count = document.createElement('span')
  count.className = 'find-count'

  const previous = document.createElement('button')
  previous.className = 'icon-btn find-btn'
  previous.type = 'button'
  previous.title = 'Previous match'
  previous.setAttribute('aria-label', 'Previous match')
  previous.innerHTML = ICON_UP

  const next = document.createElement('button')
  next.className = 'icon-btn find-btn'
  next.type = 'button'
  next.title = 'Next match'
  next.setAttribute('aria-label', 'Next match')
  next.innerHTML = ICON_DOWN

  const close = document.createElement('button')
  close.className = 'icon-btn find-btn'
  close.type = 'button'
  close.title = 'Close find'
  close.setAttribute('aria-label', 'Close find')
  close.innerHTML = ICON_X

  for (const button of [previous, next, close]) {
    button.addEventListener('mousedown', (event) => event.preventDefault())
  }

  host.append(icon, input, count, previous, next, close)

  function render(result: FindResult): void {
    const hasQuery = input.value.trim().length > 0
    const hasMatches = result.count > 0
    count.textContent = !hasQuery ? '' : hasMatches ? `${result.index + 1} of ${result.count}` : 'No results'
    previous.disabled = !hasMatches
    next.disabled = !hasMatches
  }

  input.addEventListener('input', () => render(handlers.onQuery(input.value)))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      api.close()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      render(event.shiftKey ? handlers.onPrevious() : handlers.onNext())
    }
  })
  previous.addEventListener('click', () => render(handlers.onPrevious()))
  next.addEventListener('click', () => render(handlers.onNext()))
  close.addEventListener('click', () => api.close())

  const api: FindBar = {
    open() {
      host.hidden = false
      render(handlers.onQuery(input.value))
      api.focus()
    },
    close() {
      input.value = ''
      render(handlers.onQuery(''))
      host.hidden = true
      handlers.onClose()
    },
    focus() {
      requestAnimationFrame(() => {
        input.focus()
        input.select()
      })
    },
    isOpen() {
      return !host.hidden
    },
  }

  return api
}
