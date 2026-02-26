import { useCallback } from 'react'
import { Plus, Trash2, Download, Upload } from 'lucide-react'
import type { HSBColor, ColorPalette } from '../../types/color.ts'
import { hsbToHex } from '../../types/color.ts'
import styles from './PaletteManager.module.css'

interface PaletteManagerProps {
  palettes: ColorPalette[]
  activePaletteId: string
  currentColor: HSBColor
  onSetActivePalette: (id: string) => void
  onAddSwatch: (paletteId: string) => void
  onRemoveSwatch: (paletteId: string, index: number) => void
  onSelectColor: (color: HSBColor) => void
  onCreatePalette: () => void
  onDeletePalette: (id: string) => void
  onImportPalette: (palette: ColorPalette) => void
}

/**
 * Color palette manager — grid of swatches with CRUD operations.
 */
export function PaletteManager({
  palettes,
  activePaletteId,
  currentColor,
  onSetActivePalette,
  onAddSwatch,
  onRemoveSwatch,
  onSelectColor,
  onCreatePalette,
  onDeletePalette,
  onImportPalette,
}: PaletteManagerProps) {
  const activePalette = palettes.find((p) => p.id === activePaletteId)

  const handleExport = useCallback(() => {
    if (!activePalette) return
    const json = JSON.stringify(activePalette, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activePalette.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [activePalette])

  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const palette = JSON.parse(reader.result as string) as ColorPalette
          if (palette.id && palette.name && Array.isArray(palette.swatches)) {
            onImportPalette({ ...palette, id: `imported_${Date.now()}` })
          }
        } catch { /* invalid JSON */ }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [onImportPalette])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <select
          className={styles.paletteSelect}
          value={activePaletteId}
          onChange={(e) => onSetActivePalette(e.target.value)}
          aria-label="Active palette"
        >
          {palettes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={onCreatePalette}
            aria-label="New palette"
            title="New palette"
          >
            <Plus size={14} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => activePaletteId && onDeletePalette(activePaletteId)}
            aria-label="Delete palette"
            title="Delete palette"
            disabled={palettes.length <= 1}
          >
            <Trash2 size={14} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={handleExport}
            aria-label="Export palette"
            title="Export"
          >
            <Download size={14} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={handleImport}
            aria-label="Import palette"
            title="Import"
          >
            <Upload size={14} />
          </button>
        </div>
      </div>

      {activePalette && (
        <div className={styles.grid} role="listbox" aria-label="Color swatches">
          {activePalette.swatches.map((swatch, i) => (
            <button
              key={i}
              className={styles.swatch}
              style={{ background: hsbToHex(swatch.color) }}
              onClick={() => onSelectColor(swatch.color)}
              onContextMenu={(e) => {
                e.preventDefault()
                onRemoveSwatch(activePaletteId, i)
              }}
              role="option"
              aria-label={swatch.name ?? `Swatch ${i + 1}: ${hsbToHex(swatch.color)}`}
              title={swatch.name ?? hsbToHex(swatch.color)}
            />
          ))}
          <button
            className={styles.addSwatch}
            onClick={() => onAddSwatch(activePaletteId)}
            aria-label="Add current color to palette"
            title="Add color"
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
