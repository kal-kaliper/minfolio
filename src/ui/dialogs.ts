// Minimalist modal primitives: confirm / prompt / confirmSave.
// Each resolves a Promise and tears its DOM down on close. Styling lives in
// ../styles/dialogs.css (imported by the host alongside theme.css).
//
// Behaviour: dimmed backdrop, Escape cancels, Enter confirms the primary
// action, focus moves into the dialog and is loosely trapped (Tab cycles
// within the card), and focus is restored to the prior element on close.

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** Style the confirm button as destructive. */
  danger?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  placeholder?: string
  value?: string
  confirmText?: string
  cancelText?: string
}

export interface ConfirmSaveOptions {
  title: string
  message?: string
}

export type SaveChoice = 'save' | 'discard' | 'cancel'

interface ButtonSpec<T> {
  label: string
  variant: 'primary' | 'danger' | 'ghost'
  /** Whether Enter triggers this button. */
  primary?: boolean
  /** Value to resolve with, or a getter to compute it (e.g. read the input). */
  value: T | (() => T)
}

interface DialogConfig<T> {
  title: string
  message?: string
  /** Optional text input; if present its value is available to button getters. */
  input?: { placeholder?: string; value?: string }
  buttons: (input: HTMLInputElement | null) => ButtonSpec<T>[]
  /** Result produced when dismissed via Escape / backdrop click. */
  cancelValue: T
}

/** Core builder shared by all three primitives. */
function openDialog<T>(config: DialogConfig<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null

    const backdrop = document.createElement('div')
    backdrop.className = 'dlg-backdrop'
    backdrop.setAttribute('role', 'presentation')

    const card = document.createElement('div')
    card.className = 'dlg-card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', config.title)

    const titleEl = document.createElement('h2')
    titleEl.className = 'dlg-title'
    titleEl.textContent = config.title
    card.append(titleEl)

    if (config.message) {
      const msg = document.createElement('p')
      msg.className = 'dlg-message'
      msg.textContent = config.message
      card.append(msg)
    }

    let input: HTMLInputElement | null = null
    if (config.input) {
      input = document.createElement('input')
      input.className = 'dlg-input'
      input.type = 'text'
      input.placeholder = config.input.placeholder ?? ''
      input.value = config.input.value ?? ''
      input.autocomplete = 'off'
      input.spellcheck = false
      card.append(input)
    }

    let closed = false
    function close(result: T): void {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey, true)
      backdrop.classList.remove('is-open')
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        backdrop.remove()
        if (previouslyFocused && document.contains(previouslyFocused)) {
          previouslyFocused.focus()
        }
        resolve(result)
      }
      backdrop.addEventListener('transitionend', finish, { once: true })
      setTimeout(finish, 240)
    }

    const resolveSpec = (spec: ButtonSpec<T>): void => {
      const v = typeof spec.value === 'function' ? (spec.value as () => T)() : spec.value
      close(v)
    }

    const actions = document.createElement('div')
    actions.className = 'dlg-actions'

    let primarySpec: ButtonSpec<T> | null = null
    for (const spec of config.buttons(input)) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `dlg-btn dlg-btn-${spec.variant}`
      b.textContent = spec.label
      b.addEventListener('click', () => resolveSpec(spec))
      if (spec.primary) primarySpec = spec
      actions.append(b)
    }
    card.append(actions)
    backdrop.append(card)
    document.body.append(backdrop)

    requestAnimationFrame(() => backdrop.classList.add('is-open'))

    function focusables(): HTMLElement[] {
      return Array.from(
        card.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled'))
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(config.cancelValue)
      } else if (e.key === 'Enter' && primarySpec) {
        e.preventDefault()
        resolveSpec(primarySpec)
      } else if (e.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey, true)

    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(config.cancelValue)
    })

    requestAnimationFrame(() => {
      if (input) {
        input.focus()
        input.select()
      } else {
        const items = focusables()
        items[items.length - 1]?.focus()
      }
    })
  })
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return openDialog<boolean>({
    title: opts.title,
    message: opts.message,
    cancelValue: false,
    buttons: () => [
      { label: opts.cancelText ?? 'Cancel', variant: 'ghost', value: false },
      {
        label: opts.confirmText ?? 'Confirm',
        variant: opts.danger ? 'danger' : 'primary',
        primary: true,
        value: true,
      },
    ],
  })
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return openDialog<string | null>({
    title: opts.title,
    message: opts.message,
    input: { placeholder: opts.placeholder, value: opts.value },
    cancelValue: null,
    buttons: (input) => [
      { label: opts.cancelText ?? 'Cancel', variant: 'ghost', value: null },
      {
        label: opts.confirmText ?? 'OK',
        variant: 'primary',
        primary: true,
        value: () => {
          const val = input ? input.value.trim() : ''
          return val.length ? val : null
        },
      },
    ],
  })
}

export function confirmSave(opts: ConfirmSaveOptions): Promise<SaveChoice> {
  return openDialog<SaveChoice>({
    title: opts.title,
    message: opts.message ?? 'You have unsaved changes.',
    cancelValue: 'cancel',
    buttons: () => [
      { label: 'Cancel', variant: 'ghost', value: 'cancel' },
      { label: "Don't save", variant: 'danger', value: 'discard' },
      { label: 'Save', variant: 'primary', primary: true, value: 'save' },
    ],
  })
}
