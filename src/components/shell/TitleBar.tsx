import { useState, useRef, useCallback } from 'react'
import { DropdownMenu, type MenuItem } from './DropdownMenu.tsx'
import { useUIStore } from '@stores/uiStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'
import { useGuideStore } from '@stores/guideStore.ts'
import { useTimelapseStore } from '@stores/timelapseStore.ts'
import type { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import type { FilterType } from '@app-types/filter.ts'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  onOpenFilter?: (filterType: FilterType) => void
  onUndo?: () => void
  onRedo?: () => void
  onSave?: () => void
  onImportImage?: () => void
  onStartRecording?: () => void
  onStopRecording?: () => void
  onDiscardRecording?: () => void
  manager?: CanvasManager | null
}

type MenuName = 'file' | 'edit' | 'view' | 'adjustments' | 'selection' | 'help'

export function TitleBar({ onOpenFilter, onUndo, onRedo, onSave, onImportImage, onStartRecording, onStopRecording, onDiscardRecording, manager }: TitleBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const zoom = useUIStore((s) => s.zoom)
  const projectName = useProjectStore((s) => s.currentProjectName)
  const recordingState = useTimelapseStore((s) => s.state)
  const frameCount = useTimelapseStore((s) => s.frameCount)

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  const toggleMenu = (name: MenuName) => {
    setOpenMenu((prev) => (prev === name ? null : name))
  }

  const getMenuItems = (name: MenuName): MenuItem[] => {
    switch (name) {
      case 'file':
        return [
          { label: 'New', shortcut: 'Ctrl+N', action: () => useUIStore.getState().setShowNewProjectDialog(true) },
          { separator: true, label: '' },
          { label: 'Canvas Size...', action: () => useUIStore.getState().setShowCanvasSizeDialog(true) },
          { label: 'Import Image...', action: () => onImportImage?.() },
          { separator: true, label: '' },
          { label: 'Export...', shortcut: 'Ctrl+E', action: () => useUIStore.getState().setShowExportDialog(true) },
          { label: 'Save', shortcut: 'Ctrl+S', action: () => onSave?.() },
          { separator: true, label: '' },
          ...(recordingState === 'idle'
            ? [{ label: 'Start Recording', shortcut: 'Ctrl+Shift+R', action: () => onStartRecording?.() }]
            : [
                { label: 'Stop Recording', shortcut: 'Ctrl+Shift+R', action: () => onStopRecording?.() },
                { label: 'Discard Recording', action: () => onDiscardRecording?.() },
              ]),
          { separator: true, label: '' },
          { label: 'Gallery', action: () => useProjectStore.getState().setView('gallery') },
        ]
      case 'edit':
        return [
          { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo },
          { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: onRedo },
          { separator: true, label: '' },
          { label: 'Brush Studio...', shortcut: 'Shift+B', action: () => useUIStore.getState().setShowBrushStudio(true) },
        ]
      case 'view': {
        const gs = useGuideStore.getState()
        return [
          { label: gs.gridEnabled ? 'Hide Grid' : 'Show Grid', action: () => useGuideStore.getState().setGridEnabled(!gs.gridEnabled) },
          { label: gs.isometricEnabled ? 'Hide Isometric Grid' : 'Show Isometric Grid', action: () => useGuideStore.getState().setIsometricEnabled(!gs.isometricEnabled) },
          { label: gs.perspectiveEnabled ? 'Hide Perspective Guides' : 'Show Perspective Guides', action: () => useGuideStore.getState().setPerspectiveEnabled(!gs.perspectiveEnabled) },
          { label: gs.symmetryEnabled ? 'Hide Symmetry' : 'Show Symmetry', action: () => useGuideStore.getState().setSymmetryEnabled(!gs.symmetryEnabled) },
          { separator: true, label: '' },
          { label: 'Drawing Guides...', shortcut: 'Shift+G', action: () => useUIStore.getState().setShowDrawingGuidesDialog(true) },
        ]
      }
      case 'adjustments':
        return [
          { label: 'Gaussian Blur...', action: () => onOpenFilter?.('gaussianBlur') },
          { label: 'Sharpen...', action: () => onOpenFilter?.('sharpen') },
          { separator: true, label: '' },
          { label: 'HSB Adjustment...', action: () => onOpenFilter?.('hsbAdjustment') },
          { label: 'Curves...', shortcut: 'Ctrl+M', action: () => onOpenFilter?.('curves') },
        ]
      case 'selection':
        return [
          { label: 'Select All', shortcut: 'Ctrl+A', action: () => manager?.selectAll() },
          { label: 'Deselect', shortcut: 'Ctrl+D', action: () => manager?.deselectAll() },
          { label: 'Invert', shortcut: 'Ctrl+Shift+I', action: () => manager?.invertSelection() },
        ]
      case 'help':
        return [
          { label: 'Keyboard Shortcuts', shortcut: '?', action: () => useUIStore.getState().setShowShortcutsModal(true) },
          { separator: true, label: '' },
          { label: 'About QUAR Artist', action: () => useUIStore.getState().setShowAboutModal(true) },
        ]
    }
  }

  const menus: { name: MenuName; label: string }[] = [
    { name: 'file', label: 'File' },
    { name: 'edit', label: 'Edit' },
    { name: 'view', label: 'View' },
    { name: 'adjustments', label: 'Adjustments' },
    { name: 'selection', label: 'Selection' },
    { name: 'help', label: 'Help' },
  ]

  return (
    <header className={`glass ${styles.titleBar}`} data-testid="title-bar">
      <div className={styles.brand}>
        <img src="/logo.svg" alt="QUAR Artist" className={styles.logo} />
      </div>
      <nav className={styles.menu}>
        {menus.map(({ name, label }) => (
          <button
            key={name}
            ref={(el) => { buttonRefs.current[name] = el }}
            className={styles.menuItem}
            data-active={openMenu === name}
            data-testid={`menu-${name}`}
            onClick={() => toggleMenu(name)}
            onMouseEnter={() => {
              if (openMenu && openMenu !== name) setOpenMenu(name)
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.projectName}>{projectName}</div>
      {recordingState === 'recording' && (
        <div className={styles.recordIndicator} data-testid="record-indicator">
          <span className={styles.recordDot} />
          <span className={styles.frameCount}>{frameCount} frames</span>
          <button
            className={styles.stopBtn}
            onClick={onStopRecording}
            title="Stop recording"
            type="button"
          >
            Stop
          </button>
        </div>
      )}
      <button
        className={styles.zoomIndicator}
        onClick={() => manager?.viewTransform.reset()}
        title="Reset zoom to 100%"
        type="button"
      >
        {Math.round(zoom * 100)}%
      </button>
      {openMenu && (
        <DropdownMenu
          items={getMenuItems(openMenu)}
          onClose={closeMenu}
          anchorEl={buttonRefs.current[openMenu] ?? null}
        />
      )}
    </header>
  )
}
