import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useGuideStore, type SymmetryType, type PerspectiveType } from '@stores/guideStore.ts'
import styles from './DrawingGuidesDialog.module.css'

interface DrawingGuidesDialogProps {
  open: boolean
  onClose: () => void
}

type GuideSection = 'grid' | 'isometric' | 'perspective' | 'symmetry' | 'quickshape'

const SECTIONS: { id: GuideSection; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'perspective', label: 'Perspective' },
  { id: 'symmetry', label: 'Symmetry' },
  { id: 'quickshape', label: 'QuickShape' },
]

export function DrawingGuidesDialog({ open, onClose }: DrawingGuidesDialogProps) {
  const [activeSection, setActiveSection] = useState<GuideSection>('grid')

  // Grid state
  const gridEnabled = useGuideStore((s) => s.gridEnabled)
  const gridSpacing = useGuideStore((s) => s.gridSpacing)
  const gridSnap = useGuideStore((s) => s.gridSnap)
  const gridOpacity = useGuideStore((s) => s.gridOpacity)

  // Isometric state
  const isometricEnabled = useGuideStore((s) => s.isometricEnabled)
  const isometricSpacing = useGuideStore((s) => s.isometricSpacing)

  // Perspective state
  const perspectiveEnabled = useGuideStore((s) => s.perspectiveEnabled)
  const perspectiveType = useGuideStore((s) => s.perspectiveType)
  const perspectiveLineCount = useGuideStore((s) => s.perspectiveLineCount)

  // Symmetry state
  const symmetryEnabled = useGuideStore((s) => s.symmetryEnabled)
  const symmetryType = useGuideStore((s) => s.symmetryType)
  const symmetryAxes = useGuideStore((s) => s.symmetryAxes)
  const symmetryRotation = useGuideStore((s) => s.symmetryRotation)

  // QuickShape state
  const quickShapeEnabled = useGuideStore((s) => s.quickShapeEnabled)

  // Escape key handler
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const store = useGuideStore.getState()

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onClick={onClose} onKeyDown={(e) => e.stopPropagation()}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className={styles.dialog} role="dialog" aria-label="Drawing Guides" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>Drawing Guides</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close" type="button">
            <X size={18} />
          </button>
        </div>

        {/* Body: Sidebar + Content */}
        <div className={styles.body}>
          <div className={styles.sidebar}>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                className={styles.sidebarItem}
                data-active={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                {section.label}
              </button>
            ))}
          </div>

          <div className={styles.content}>
            {/* Grid section */}
            {activeSection === 'grid' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span>Grid</span>
                  <input
                    type="checkbox"
                    className={styles.paramToggle}
                    checked={gridEnabled}
                    onChange={(e) => store.setGridEnabled(e.target.checked)}
                    aria-label="Enable grid"
                  />
                </div>

                <div className={styles.paramGroup}>
                  <span className={styles.paramLabel}>Spacing</span>
                  <div className={styles.paramRow}>
                    <input
                      type="range"
                      className={styles.paramSlider}
                      min={4}
                      max={256}
                      value={gridSpacing}
                      onChange={(e) => store.setGridSpacing(Number(e.target.value))}
                    />
                    <span className={styles.paramValue}>{gridSpacing}px</span>
                  </div>
                </div>

                <div className={styles.paramGroup}>
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Snap to Grid</span>
                    <input
                      type="checkbox"
                      className={styles.paramToggle}
                      checked={gridSnap}
                      onChange={(e) => store.setGridSnap(e.target.checked)}
                    />
                  </div>
                </div>

                <div className={styles.paramGroup}>
                  <span className={styles.paramLabel}>Opacity</span>
                  <div className={styles.paramRow}>
                    <input
                      type="range"
                      className={styles.paramSlider}
                      min={0.01}
                      max={1}
                      step={0.01}
                      value={gridOpacity}
                      onChange={(e) => store.setGridOpacity(Number(e.target.value))}
                    />
                    <span className={styles.paramValue}>{Math.round(gridOpacity * 100)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Isometric section */}
            {activeSection === 'isometric' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span>Isometric Grid</span>
                  <input
                    type="checkbox"
                    className={styles.paramToggle}
                    checked={isometricEnabled}
                    onChange={(e) => store.setIsometricEnabled(e.target.checked)}
                    aria-label="Enable isometric grid"
                  />
                </div>

                <div className={styles.paramGroup}>
                  <span className={styles.paramLabel}>Spacing</span>
                  <div className={styles.paramRow}>
                    <input
                      type="range"
                      className={styles.paramSlider}
                      min={8}
                      max={256}
                      value={isometricSpacing}
                      onChange={(e) => store.setIsometricSpacing(Number(e.target.value))}
                    />
                    <span className={styles.paramValue}>{isometricSpacing}px</span>
                  </div>
                </div>
              </div>
            )}

            {/* Perspective section */}
            {activeSection === 'perspective' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span>Perspective Guides</span>
                  <input
                    type="checkbox"
                    className={styles.paramToggle}
                    checked={perspectiveEnabled}
                    onChange={(e) => store.setPerspectiveEnabled(e.target.checked)}
                    aria-label="Enable perspective guides"
                  />
                </div>

                <div className={styles.paramGroup}>
                  <span className={styles.paramLabel}>Type</span>
                  <div className={styles.typeSelector}>
                    {(['1-point', '2-point'] as PerspectiveType[]).map((t) => (
                      <button
                        key={t}
                        className={styles.typeBtn}
                        data-active={perspectiveType === t}
                        onClick={() => store.setPerspectiveType(t)}
                        type="button"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.paramGroup}>
                  <span className={styles.paramLabel}>Line Count</span>
                  <div className={styles.paramRow}>
                    <input
                      type="range"
                      className={styles.paramSlider}
                      min={4}
                      max={48}
                      value={perspectiveLineCount}
                      onChange={(e) => store.setPerspectiveLineCount(Number(e.target.value))}
                    />
                    <span className={styles.paramValue}>{perspectiveLineCount}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Symmetry section */}
            {activeSection === 'symmetry' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span>Symmetry</span>
                  <input
                    type="checkbox"
                    className={styles.paramToggle}
                    checked={symmetryEnabled}
                    onChange={(e) => store.setSymmetryEnabled(e.target.checked)}
                    aria-label="Enable symmetry"
                  />
                </div>

                <div className={styles.paramGroup}>
                  <span className={styles.paramLabel}>Type</span>
                  <div className={styles.typeSelector}>
                    {(['vertical', 'horizontal', 'quadrant', 'radial'] as SymmetryType[]).map((t) => (
                      <button
                        key={t}
                        className={styles.typeBtn}
                        data-active={symmetryType === t}
                        onClick={() => store.setSymmetryType(t)}
                        type="button"
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {symmetryType === 'radial' && (
                  <div className={styles.paramGroup}>
                    <span className={styles.paramLabel}>Axes</span>
                    <div className={styles.paramRow}>
                      <input
                        type="range"
                        className={styles.paramSlider}
                        min={2}
                        max={24}
                        value={symmetryAxes}
                        onChange={(e) => store.setSymmetryAxes(Number(e.target.value))}
                      />
                      <span className={styles.paramValue}>{symmetryAxes}</span>
                    </div>
                  </div>
                )}

                {symmetryType === 'radial' && (
                  <div className={styles.paramGroup}>
                    <span className={styles.paramLabel}>Rotation</span>
                    <div className={styles.paramRow}>
                      <input
                        type="range"
                        className={styles.paramSlider}
                        min={0}
                        max={360}
                        value={Math.round(symmetryRotation * (180 / Math.PI))}
                        onChange={(e) => store.setSymmetryRotation(Number(e.target.value) * (Math.PI / 180))}
                      />
                      <span className={styles.paramValue}>{Math.round(symmetryRotation * (180 / Math.PI))}&deg;</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* QuickShape section */}
            {activeSection === 'quickshape' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span>QuickShape</span>
                  <input
                    type="checkbox"
                    className={styles.paramToggle}
                    checked={quickShapeEnabled}
                    onChange={(e) => store.setQuickShapeEnabled(e.target.checked)}
                    aria-label="Enable QuickShape"
                  />
                </div>
                <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
                  Hold at the end of a stroke to snap it to a detected shape
                  (line, rectangle, ellipse, or triangle).
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.footerBtn} onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
