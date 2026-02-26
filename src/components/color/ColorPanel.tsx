import { useState, useCallback } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useColorStore } from '@stores/colorStore.ts'
import { hsbToHex } from '../../types/color.ts'
import { ColorDisc } from './ColorDisc.tsx'
import { ClassicPicker } from './ClassicPicker.tsx'
import { ValueSliders } from './ValueSliders.tsx'
import { ColorHarmony } from './ColorHarmony.tsx'
import { PaletteManager } from './PaletteManager.tsx'
import { RecentColors } from './RecentColors.tsx'
import styles from './ColorPanel.module.css'

type ColorTab = 'disc' | 'classic' | 'harmony' | 'palettes'

/**
 * Full color panel: tabs for Disc / Classic / Harmony / Palettes,
 * plus value sliders and recent colors.
 */
export function ColorPanel() {
  const [tab, setTab] = useState<ColorTab>('disc')

  const primary = useColorStore((s) => s.primary)
  const secondary = useColorStore((s) => s.secondary)
  const harmonyMode = useColorStore((s) => s.harmonyMode)
  const recentColors = useColorStore((s) => s.recentColors)
  const palettes = useColorStore((s) => s.palettes)
  const activePaletteId = useColorStore((s) => s.activePaletteId)

  const setPrimary = useColorStore((s) => s.setPrimary)
  const swapColors = useColorStore((s) => s.swapColors)
  const setHarmonyMode = useColorStore((s) => s.setHarmonyMode)
  const setActivePalette = useColorStore((s) => s.setActivePalette)
  const addSwatch = useColorStore((s) => s.addSwatch)
  const removeSwatch = useColorStore((s) => s.removeSwatch)
  const createPalette = useColorStore((s) => s.createPalette)
  const deletePalette = useColorStore((s) => s.deletePalette)
  const importPalette = useColorStore((s) => s.importPalette)

  const handleCreatePalette = useCallback(() => {
    createPalette(`Palette ${palettes.length + 1}`)
  }, [createPalette, palettes.length])

  const handleAddSwatch = useCallback((paletteId: string) => {
    addSwatch(paletteId, { color: primary })
  }, [addSwatch, primary])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Color</span>
        <div className={styles.swatchPair}>
          <div
            className={styles.primarySwatch}
            style={{ background: hsbToHex(primary) }}
            title="Primary"
          />
          <div
            className={styles.secondarySwatch}
            style={{ background: hsbToHex(secondary) }}
            title="Secondary"
          />
          <button
            className={styles.swapBtn}
            onClick={swapColors}
            aria-label="Swap primary and secondary colors"
            title="Swap (X)"
          >
            <ArrowLeftRight size={12} />
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        {(['disc', 'classic', 'harmony', 'palettes'] as ColorTab[]).map((t) => (
          <button
            key={t}
            className={styles.tab}
            data-active={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'disc' ? 'Disc' : t === 'classic' ? 'Classic' : t === 'harmony' ? 'Harmony' : 'Palettes'}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {tab === 'disc' && (
          <div className={styles.centered}>
            <ColorDisc
              color={primary}
              harmonyMode={harmonyMode}
              onChange={setPrimary}
            />
          </div>
        )}

        {tab === 'classic' && (
          <div className={styles.centered}>
            <ClassicPicker
              color={primary}
              onChange={setPrimary}
            />
          </div>
        )}

        {tab === 'harmony' && (
          <div className={styles.section}>
            <ColorDisc
              color={primary}
              harmonyMode={harmonyMode}
              onChange={setPrimary}
            />
            <ColorHarmony
              color={primary}
              harmonyMode={harmonyMode}
              onHarmonyModeChange={setHarmonyMode}
              onSelectHarmonyColor={setPrimary}
            />
          </div>
        )}

        {tab === 'palettes' && (
          <PaletteManager
            palettes={palettes}
            activePaletteId={activePaletteId}
            currentColor={primary}
            onSetActivePalette={setActivePalette}
            onAddSwatch={handleAddSwatch}
            onRemoveSwatch={removeSwatch}
            onSelectColor={setPrimary}
            onCreatePalette={handleCreatePalette}
            onDeletePalette={deletePalette}
            onImportPalette={importPalette}
          />
        )}
      </div>

      <div className={styles.footer}>
        <ValueSliders color={primary} onChange={setPrimary} />
        <RecentColors colors={recentColors} onSelect={setPrimary} />
      </div>
    </div>
  )
}
