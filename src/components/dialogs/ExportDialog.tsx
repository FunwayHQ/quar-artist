import { useState } from 'react'
import type { ExportOptions } from '@app-types/project.ts'
import styles from './ExportDialog.module.css'

interface ExportDialogProps {
  open: boolean
  projectName: string
  width: number
  height: number
  layerCount: number
  onClose: () => void
  onExport: (options: ExportOptions) => void
}

type ExportFormat = ExportOptions['format']

/** Formats the app can't write yet: PSD export comes with plan M1.7, .qart with M1.5 and M1.6. */
const NOT_YET: Partial<Record<ExportFormat, string>> = { psd: 'PSD', qart: '.qart' }

const JPEG_PRESETS = [
  { label: 'Low', value: 0.3 },
  { label: 'Medium', value: 0.6 },
  { label: 'High', value: 0.85 },
  { label: 'Max', value: 1.0 },
]

export function ExportDialog({
  open,
  projectName,
  width,
  height,
  layerCount,
  onClose,
  onExport,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [jpegQuality, setJpegQuality] = useState(0.85)

  if (!open) return null

  const notYet = NOT_YET[format]
  const handleExport = () => {
    if (!notYet) onExport({ format, jpegQuality })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Export">
        <h2 className={styles.title}>Export</h2>

        <div className={styles.tabs}>
          {(['png', 'jpeg', 'psd', 'qart'] as ExportFormat[]).map((f) => (
            <button
              key={f}
              className={styles.tab}
              data-active={format === f}
              onClick={() => setFormat(f)}
              type="button"
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Project</span>
            <span className={styles.detailValue}>{projectName}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Dimensions</span>
            <span className={styles.detailValue}>{width} × {height}</span>
          </div>
          {(format === 'psd' || format === 'qart') && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Layers</span>
              <span className={styles.detailValue}>{layerCount}</span>
            </div>
          )}
        </div>

        {notYet && (
          <p className={styles.notYet} role="note">
            {notYet} export isn't available yet. PNG keeps the picture with its transparency, as one layer.
          </p>
        )}

        {format === 'jpeg' && (
          <div className={styles.qualitySection}>
            <span className={styles.qualityLabel}>
              Quality: {Math.round(jpegQuality * 100)}%
            </span>
            <div className={styles.qualityPresets}>
              {JPEG_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={styles.qualityBtn}
                  data-active={jpegQuality === p.value}
                  onClick={() => setJpegQuality(p.value)}
                  type="button"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              className={styles.qualitySlider}
              min={10}
              max={100}
              value={Math.round(jpegQuality * 100)}
              onChange={(e) => setJpegQuality(Number(e.target.value) / 100)}
              aria-label="JPEG quality"
            />
          </div>
        )}

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Cancel</button>
          <button className={styles.exportBtn} onClick={handleExport} type="button" disabled={notYet !== undefined}>
            Export {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  )
}
