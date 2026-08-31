import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const SCROLLBACK = 10_000

type TerminalInstance = {
  term: Terminal
  fit: FitAddon
  host: HTMLElement
  writableSessionId: string | null
  decorations: Array<{ dispose: () => void }>
  observer: ResizeObserver
}

export type TerminalRegistry = {
  attach: (profileId: string, host: HTMLElement) => void
  writeRemote: (profileId: string, chunk: Uint8Array) => void
  writeLocal: (profileId: string, text: string) => void
  setWritable: (profileId: string, sessionId: string | null) => void
  clear: (profileId: string) => void
  focus: (profileId: string) => void
  fit: (profileId: string) => void
  size: (profileId: string) => { cols: number; rows: number } | undefined
  forget: (profileId: string) => void
  dispose: () => void
}

function stripEscapes(text: string): string {
  return text.split('\u001b').join('')
}

function darkTerminal(): Terminal {
  return new Terminal({
    cursorBlink: true,
    scrollback: SCROLLBACK,
    disableStdin: true,
    theme: {
      background: '#111111',
      foreground: '#d0d0d0',
      cursor: '#d0d0d0',
      selectionBackground: '#444444'
    }
  })
}

export function createTerminalRegistry(handlers: {
  onInput: (profileId: string, data: Uint8Array) => void
  onResize: (profileId: string, cols: number, rows: number) => void
}): TerminalRegistry {
  const instances = new Map<string, TerminalInstance>()
  const encoder = new TextEncoder()

  function sizeOf(inst: TerminalInstance): { cols: number; rows: number } {
    return { cols: inst.term.cols, rows: inst.term.rows }
  }

  function queueFit(profileId: string): void {
    requestAnimationFrame(() => {
      const inst = instances.get(profileId)
      if (inst === undefined) {
        return
      }
      inst.fit.fit()
      const sessionId = inst.writableSessionId
      if (sessionId !== null) {
        handlers.onResize(profileId, inst.term.cols, inst.term.rows)
      }
    })
  }

  return {
    attach(profileId, host) {
      const existing = instances.get(profileId)
      if (existing !== undefined) {
        return
      }
      const term = darkTerminal()
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      term.onData((data) => {
        const inst = instances.get(profileId)
        if (inst === undefined || inst.writableSessionId === null) {
          return
        }
        handlers.onInput(profileId, encoder.encode(data))
      })
      const observer = new ResizeObserver(() => {
        queueFit(profileId)
      })
      observer.observe(host)
      instances.set(profileId, {
        term,
        fit,
        host,
        writableSessionId: null,
        decorations: [],
        observer
      })
      queueFit(profileId)
    },

    writeRemote(profileId, chunk) {
      instances.get(profileId)?.term.write(chunk)
    },

    writeLocal(profileId, text) {
      const inst = instances.get(profileId)
      if (inst === undefined) {
        return
      }
      inst.term.write('\r\n')
      const marker = inst.term.registerMarker(0)
      if (marker === undefined) {
        inst.term.writeln(stripEscapes(text))
        return
      }
      const decoration = inst.term.registerDecoration({
        marker,
        layer: 'top'
      })
      if (decoration === undefined) {
        inst.term.writeln(stripEscapes(text))
        return
      }
      decoration.onRender((element) => {
        element.textContent = text
        element.style.color = '#9a9a9a'
        element.style.background = '#1a1a1a'
        element.style.fontStyle = 'italic'
        element.style.pointerEvents = 'none'
        element.style.userSelect = 'none'
        element.style.width = '100%'
      })
      inst.decorations.push(decoration)
    },

    setWritable(profileId, sessionId) {
      const inst = instances.get(profileId)
      if (inst === undefined) {
        return
      }
      inst.writableSessionId = sessionId
      inst.term.options.disableStdin = sessionId === null
      if (sessionId !== null) {
        queueFit(profileId)
      }
    },

    clear(profileId) {
      const inst = instances.get(profileId)
      if (inst === undefined) {
        return
      }
      for (const decoration of inst.decorations) {
        decoration.dispose()
      }
      inst.decorations = []
      inst.term.clear()
    },

    focus(profileId) {
      instances.get(profileId)?.term.focus()
    },

    fit(profileId) {
      queueFit(profileId)
    },

    size(profileId) {
      const inst = instances.get(profileId)
      if (inst === undefined) {
        return undefined
      }
      return sizeOf(inst)
    },

    forget(profileId) {
      const inst = instances.get(profileId)
      if (inst === undefined) {
        return
      }
      inst.observer.disconnect()
      for (const decoration of inst.decorations) {
        decoration.dispose()
      }
      inst.term.dispose()
      instances.delete(profileId)
    },

    dispose() {
      for (const inst of instances.values()) {
        inst.observer.disconnect()
        for (const decoration of inst.decorations) {
          decoration.dispose()
        }
        inst.term.dispose()
      }
      instances.clear()
    }
  }
}
