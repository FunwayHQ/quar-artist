const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

/**
 * Normalize a KeyboardEvent into a canonical shortcut string.
 * Format: "ctrl+shift+a", always lowercase, modifiers sorted.
 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  let key = e.key.toLowerCase()
  // Map special keys
  if (key === '[') key = 'bracketleft'
  else if (key === ']') key = 'bracketright'
  else if (key === '/') key = 'slash'
  else if (key === '?') key = 'question'
  else if (key === ' ') key = 'space'
  else if (key === 'escape') key = 'escape'
  else if (key === 'tab') key = 'tab'
  else if (key === 'delete' || key === 'backspace') key = 'delete'

  // Don't include modifier keys as the main key
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return ''

  parts.push(key)
  return parts.join('+')
}

/**
 * Format a shortcut keys string for display.
 * "ctrl+shift+n" → "Ctrl+Shift+N" (Windows) or "⌘⇧N" (Mac)
 */
export function formatShortcutDisplay(keys: string): string {
  const parts = keys.split('+')

  if (isMac) {
    return parts
      .map((p) => {
        switch (p) {
          case 'ctrl': return '⌘'
          case 'shift': return '⇧'
          case 'alt': return '⌥'
          case 'bracketleft': return '['
          case 'bracketright': return ']'
          case 'question': return '?'
          case 'space': return 'Space'
          case 'tab': return '⇥'
          case 'escape': return 'Esc'
          case 'delete': return '⌫'
          default: return p.toUpperCase()
        }
      })
      .join('')
  }

  return parts
    .map((p) => {
      switch (p) {
        case 'ctrl': return 'Ctrl'
        case 'shift': return 'Shift'
        case 'alt': return 'Alt'
        case 'bracketleft': return '['
        case 'bracketright': return ']'
        case 'question': return '?'
        case 'space': return 'Space'
        case 'tab': return 'Tab'
        case 'escape': return 'Esc'
        case 'delete': return 'Del'
        default: return p.toUpperCase()
      }
    })
    .join('+')
}
