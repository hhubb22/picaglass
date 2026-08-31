const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

export function bindDialogFocus(
  root: HTMLElement,
  onCancel: () => void,
  initial: 'dialog' | 'first' = 'dialog'
): () => void {
  const previouslyFocused = document.activeElement
  if (initial === 'dialog') {
    root.tabIndex = -1
    root.focus()
  } else {
    const first = root.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') {
      return
    }
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) {
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (first === undefined || last === undefined) {
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  root.addEventListener('keydown', onKeydown)
  return () => {
    root.removeEventListener('keydown', onKeydown)
    if (previouslyFocused instanceof HTMLElement) {
      previouslyFocused.focus()
    }
  }
}
