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

  const handleExport = () => {
    onExport({ format, jpegQuality })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
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
          <button className={styles.exportBtn} onClick={handleExport} type="button">
            Export {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  )
}
