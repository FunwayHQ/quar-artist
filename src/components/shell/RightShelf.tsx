import { Layers, Palette, SlidersHorizontal } from 'lucide-react'
import { useUIStore } from '@stores/uiStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
import { hsbToHex } from '../../types/color.ts'
import styles from './RightShelf.module.css'

export function RightShelf() {
  const rightPanelTab = useUIStore((s) => s.rightPanelTab)
  const setRightPanelTab = useUIStore((s) => s.setRightPanelTab)
  const primary = useColorStore((s) => s.primary)

  return (
    <aside className={`glass ${styles.shelf}`} role="tablist" aria-label="Right panel">
      <button
        className={styles.colorSwatch}
        style={{ background: hsbToHex(primary) }}
        onClick={() => setRightPanelTab('color')}
        aria-label="Primary color"
        title="Primary color"
      />
      <div className={styles.divider} />
      <button
        className={styles.shelfButton}
        data-active={rightPanelTab === 'color'}
        onClick={() => setRightPanelTab('color')}
        aria-label="Color picker"
        title="Color"
      >
        <Palette size={18} />
      </button>
      <button
        className={styles.shelfButton}
        data-active={rightPanelTab === 'layers'}
        onClick={() => setRightPanelTab('layers')}
        aria-label="Layers panel"
        title="Layers"
      >
        <Layers size={18} />
      </button>
      <button
        className={styles.shelfButton}
        data-active={rightPanelTab === 'brush'}
        onClick={() => setRightPanelTab('brush')}
        aria-label="Brush settings"
        title="Brush"
      >
        <SlidersHorizontal size={18} />
      </button>
    </aside>
  )
}
