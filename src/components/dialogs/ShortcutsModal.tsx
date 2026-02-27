import { useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import { DEFAULT_SHORTCUTS, CATEGORY_LABELS, type ShortcutDef } from '@hooks/shortcuts/shortcutRegistry.ts'
import { formatShortcutDisplay } from '@hooks/shortcuts/keyMatcher.ts'
import styles from './ShortcutsModal.module.css'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

// Filter out duplicate entries (e.g., redo has two keybindings — show the primary one)
const VISIBLE_SHORTCUTS = DEFAULT_SHORTCUTS.filter((s) => s.id !== 'redo-y')

const CATEGORY_ORDER: ShortcutDef['category'][] = [
  'tools', 'edit', 'selection', 'view', 'file', 'filters', 'layers',
]

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const [search, setSearch] = useState('')

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  if (!open) return null

  const query = search.toLowerCase().trim()
  const filtered = query
    ? VISIBLE_SHORTCUTS.filter(
        (s) =>
          s.label.toLowerCase().includes(query) ||
          s.keys.toLowerCase().includes(query) ||
          CATEGORY_LABELS[s.category].toLowerCase().includes(query),
      )
    : VISIBLE_SHORTCUTS

  // Group by category
  const grouped = new Map<ShortcutDef['category'], ShortcutDef[]>()
  for (const def of filtered) {
    const list = grouped.get(def.category) || []
    list.push(def)
    grouped.set(def.category, list)
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-label="Keyboard Shortcuts">
        <div className={styles.header}>
          <h2 className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        <div className={styles.list}>
          {grouped.size === 0 && (
            <div className={styles.empty}>No shortcuts match "{search}"</div>
          )}
          {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((category) => (
            <div key={category} className={styles.category}>
              <div className={styles.categoryLabel}>
                {CATEGORY_LABELS[category]}
              </div>
              {grouped.get(category)!.map((def) => (
                <div key={def.id} className={styles.shortcutRow}>
                  <span className={styles.shortcutLabel}>{def.label}</span>
                  <div className={styles.shortcutKeys}>
                    {formatShortcutDisplay(def.keys)
                      .split('+')
                      .map((part, i) => (
                        <kbd key={i} className={styles.kbd}>
                          {part}
                        </kbd>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
