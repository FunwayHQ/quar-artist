import { useRef, useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { TitleBar } from '@components/shell/TitleBar.tsx'
import { BrushControls } from '@components/shell/BrushControls.tsx'
import { CanvasViewport } from '@components/shell/CanvasViewport.tsx'
import { LayersPanel } from '@components/layers/LayersPanel.tsx'
import { ColorPanel } from '@components/color/ColorPanel.tsx'
import { FilterDialogRouter } from '@components/filters/FilterDialogRouter.tsx'
import { GalleryView } from '@components/gallery/GalleryView.tsx'
import { FullscreenHud } from '@components/shell/FullscreenHud.tsx'
import { ToastContainer } from '@components/ui/ToastContainer.tsx'
import { ContextMenu, type ContextMenuItem } from '@components/ui/ContextMenu.tsx'
import { LoadingOverlay } from '@components/ui/LoadingOverlay.tsx'

// Lazy-loaded dialogs — only fetched when opened
const ExportDialog = lazy(() => import('@components/dialogs/ExportDialog.tsx').then(m => ({ default: m.ExportDialog })))
const NewProjectDialog = lazy(() => import('@components/dialogs/NewProjectDialog.tsx').then(m => ({ default: m.NewProjectDialog })))
const CanvasSizeDialog = lazy(() => import('@components/dialogs/CanvasSizeDialog.tsx').then(m => ({ default: m.CanvasSizeDialog })))
const ShortcutsModal = lazy(() => import('@components/dialogs/ShortcutsModal.tsx').then(m => ({ default: m.ShortcutsModal })))
const AboutModal = lazy(() => import('@components/dialogs/AboutModal.tsx').then(m => ({ default: m.AboutModal })))
const BrushStudio = lazy(() => import('@components/dialogs/BrushStudio.tsx').then(m => ({ default: m.BrushStudio })))
import { useEngine } from '@hooks/useEngine.ts'
import { useKeyboardShortcuts } from '@hooks/useKeyboardShortcuts.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { useFilterStore } from '@stores/filterStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'
import { exportImage, downloadBlob } from './io/formats/image/ImageExporter.ts'
import { getImageFromClipboard, getImageFromDrop, decodeImageBlob, pickImageFile } from './io/importImage.ts'
import { hsbToRgba, rgbaToHsb } from '@app-types/color.ts'
import type { ExportOptions } from '@app-types/project.ts'
import type { FilterType } from '@app-types/filter.ts'
import styles from './App.module.css'

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { manager, ready, undo, redo } = useEngine(containerRef)
  const rightPanelTab = useUIStore((s) => s.rightPanelTab)
  const showExportDialog = useUIStore((s) => s.showExportDialog)
  const showNewProjectDialog = useUIStore((s) => s.showNewProjectDialog)
  const showShortcutsModal = useUIStore((s) => s.showShortcutsModal)
  const showAboutModal = useUIStore((s) => s.showAboutModal)
  const showCanvasSizeDialog = useUIStore((s) => s.showCanvasSizeDialog)
  const showBrushStudio = useUIStore((s) => s.showBrushStudio)
  const fullscreen = useUIStore((s) => s.fullscreen)
  const panelsHidden = useUIStore((s) => s.panelsHidden)
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const appView = useProjectStore((s) => s.view)
  const canvasWidth = useProjectStore((s) => s.canvasWidth)
  const canvasHeight = useProjectStore((s) => s.canvasHeight)
  const projectName = useProjectStore((s) => s.currentProjectName)

  // Sync brush preset changes to the engine
  useEffect(() => {
    if (!manager) return
    const unsub = useBrushStore.subscribe((state) => {
      const preset = state.getActivePreset()
      manager.brushEngine.setPreset(preset)
    })
    const preset = useBrushStore.getState().getActivePreset()
    manager.brushEngine.setPreset(preset)
    return unsub
  }, [manager])

  // Sync color changes to the engine
  useEffect(() => {
    if (!manager) return
    const unsub = useColorStore.subscribe((state) => {
      const rgba = hsbToRgba(state.primary)
      manager.brushEngine.setColor(rgba)
    })
    const rgba = hsbToRgba(useColorStore.getState().primary)
    manager.brushEngine.setColor(rgba)
    return unsub
  }, [manager])

  // Sync active tool to engine
  useEffect(() => {
    if (!manager) return
    const unsub = useToolStore.subscribe((state) => {
      manager.setActiveTool(state.activeTool)
      manager.setFillTolerance(state.fillTolerance)
    })
    manager.setActiveTool(useToolStore.getState().activeTool)
    manager.setFillTolerance(useToolStore.getState().fillTolerance)
    return unsub
  }, [manager])

  // Sync selection store to engine
  useEffect(() => {
    if (!manager) return
    const unsub = useSelectionStore.subscribe((state) => {
      manager.setSelectionSubTool(state.activeSubTool)
      manager.setSelectionMode(state.selectionMode)
      manager.selectionController.magicWandTool.setOptions(state.magicWandOptions)
    })
    // Initial sync
    const s = useSelectionStore.getState()
    manager.setSelectionSubTool(s.activeSubTool)
    manager.setSelectionMode(s.selectionMode)
    manager.selectionController.magicWandTool.setOptions(s.magicWandOptions)

    // Wire selection state back to store
    manager.setSelectionChangeCallback((hasSelection, bounds) => {
      useSelectionStore.getState().setHasSelection(hasSelection, bounds)
    })
    return unsub
  }, [manager])

  // Wire eyedropper callback
  useEffect(() => {
    if (!manager) return
    manager.setColorSampledCallback((rgba) => {
      useColorStore.getState().setPrimary(rgbaToHsb(rgba))
    })
  }, [manager])

  // Wire view transform → zoom display
  useEffect(() => {
    if (!manager) return
    manager.setViewChangeCallback((state) => {
      useUIStore.getState().setZoom(state.zoom)
    })
  }, [manager])

  // Sync document size to engine and fit to viewport
  useEffect(() => {
    if (!manager || !ready) return
    manager.setDocumentSize(canvasWidth, canvasHeight)
    // Use double-RAF to ensure the browser has fully laid out the container
    // before we measure its dimensions for fit-to-document calculation
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        manager.fitToDocument()
      })
    })
    return () => cancelAnimationFrame(rafId)
  }, [manager, ready, canvasWidth, canvasHeight])

  // Wire filter store to engine: begin/update/apply/cancel
  useEffect(() => {
    if (!manager) return
    const unsub = useFilterStore.subscribe((state, prev) => {
      // Filter opened
      if (state.activeFilter && !prev.activeFilter) {
        manager.beginFilterPreview()
      }
      // Params changed while filter is active
      if (state.params && state.activeFilter) {
        manager.updateFilterPreview(state.params)
      }
    })
    return unsub
  }, [manager])

  // Sync modifier keys for selection constraint (Shift) and mode (Shift/Alt)
  useEffect(() => {
    if (!manager) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') manager.setSelectionConstrained(true)
      // Modifier-based selection mode switching
      if (useToolStore.getState().activeTool === 'selection') {
        if (e.shiftKey && e.altKey) {
          manager.setSelectionMode('intersect')
        } else if (e.shiftKey) {
          manager.setSelectionMode('add')
        } else if (e.altKey) {
          manager.setSelectionMode('subtract')
        }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') manager.setSelectionConstrained(false)
      // Reset selection mode when modifiers released
      if (!e.shiftKey && !e.altKey) {
        manager.setSelectionMode(useSelectionStore.getState().selectionMode)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [manager])

  // Open filter callback for TitleBar menu
  const handleOpenFilter = useCallback((filterType: FilterType) => {
    useFilterStore.getState().openFilter(filterType)
  }, [])

  // Filter dialog apply/cancel
  const handleFilterApply = useCallback(() => {
    manager?.applyFilter()
    useFilterStore.getState().closeFilter()
  }, [manager])

  const handleFilterCancel = useCallback(() => {
    manager?.cancelFilter()
    useFilterStore.getState().closeFilter()
  }, [manager])

  // Export handler
  const handleExport = useCallback(async (options: ExportOptions) => {
    if (!manager) return
    try {
      const result = manager.getCompositePixels()
      if (!result) return
      if (options.format === 'png' || options.format === 'jpeg') {
        const blob = await exportImage(result.pixels, result.width, result.height, {
          format: options.format,
          quality: options.jpegQuality,
        })
        const ext = options.format === 'jpeg' ? 'jpg' : 'png'
        downloadBlob(blob, `${projectName}.${ext}`)
        useUIStore.getState().addToast(`Exported ${projectName}.${ext}`, 'success')
      }
      // PSD and QART exports can be added here when needed
    } catch (err) {
      console.error('Export failed:', err)
      useUIStore.getState().addToast('Export failed', 'error')
    }
    useUIStore.getState().setShowExportDialog(false)
  }, [manager, projectName])

  // New project handler
  const handleNewProject = useCallback((name: string, width: number, height: number, dpi: number) => {
    useProjectStore.getState().setCurrentProject(Date.now(), name, width, height, dpi)
    useUIStore.getState().setShowNewProjectDialog(false)
    // Engine reinit will happen via the view change
  }, [])

  // Canvas resize handler
  const handleCanvasResize = useCallback((width: number, height: number) => {
    useProjectStore.getState().setCanvasSize(width, height)
    useUIStore.getState().setShowCanvasSizeDialog(false)
    useUIStore.getState().addToast(`Canvas resized to ${width}×${height}`, 'success')
  }, [])

  // Gallery handlers
  const handleOpenProject = useCallback((id: number) => {
    useProjectStore.getState().setView('canvas')
  }, [])

  const handleGalleryNewProject = useCallback(() => {
    useUIStore.getState().setShowNewProjectDialog(true)
  }, [])

  // ── Image import: clipboard paste (Ctrl+V) ──
  useEffect(() => {
    if (!manager) return
    const handlePaste = async (e: ClipboardEvent) => {
      const blob = getImageFromClipboard(e)
      if (!blob) return
      e.preventDefault()
      try {
        const { pixels, width, height } = await decodeImageBlob(blob)
        const layerName = manager.importImageToNewLayer(pixels, width, height, 'Pasted Image')
        if (layerName) {
          useUIStore.getState().addToast(`Pasted image (${width}×${height}) as new layer`, 'success')
        }
      } catch (err) {
        console.error('Paste failed:', err)
        useUIStore.getState().addToast('Failed to paste image', 'error')
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [manager])

  // ── Image import: drag-and-drop ──
  useEffect(() => {
    if (!manager) return
    const container = containerRef.current
    if (!container) return

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const handleDrop = async (e: DragEvent) => {
      const file = getImageFromDrop(e)
      if (!file) return
      e.preventDefault()
      try {
        const { pixels, width, height } = await decodeImageBlob(file)
        const layerName = manager.importImageToNewLayer(pixels, width, height, file.name.replace(/\.[^.]+$/, ''))
        if (layerName) {
          useUIStore.getState().addToast(`Imported "${file.name}" (${width}×${height})`, 'success')
        }
      } catch (err) {
        console.error('Drop import failed:', err)
        useUIStore.getState().addToast('Failed to import dropped image', 'error')
      }
    }
    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)
    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
    }
  }, [manager])

  // ── Image import: file picker (File > Import Image) ──
  const handleImportImage = useCallback(async () => {
    if (!manager) return
    try {
      const file = await pickImageFile()
      if (!file) return
      const { pixels, width, height } = await decodeImageBlob(file)
      const layerName = manager.importImageToNewLayer(pixels, width, height, file.name.replace(/\.[^.]+$/, ''))
      if (layerName) {
        useUIStore.getState().addToast(`Imported "${file.name}" (${width}×${height})`, 'success')
      }
    } catch (err) {
      console.error('Import failed:', err)
      useUIStore.getState().addToast('Failed to import image', 'error')
    }
  }, [manager])

  // Keyboard shortcuts (declarative registry-based system)
  useKeyboardShortcuts({ manager, undo, redo, onOpenFilter: handleOpenFilter })

  // Canvas context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const canvasContextItems: ContextMenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: undo },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: redo },
    { label: '', separator: true },
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => manager?.selectAll() },
    { label: 'Deselect', shortcut: 'Ctrl+D', action: () => manager?.deselectAll() },
    { label: '', separator: true },
    { label: 'Fit to Document', shortcut: 'Ctrl+0', action: () => manager?.fitToDocument() },
  ]

  // Gallery view
  if (appView === 'gallery') {
    return (
      <div className={styles.app}>
        <GalleryView
          onOpenProject={handleOpenProject}
          onNewProject={handleGalleryNewProject}
          onDeleteProject={() => {}}
          onDuplicateProject={() => {}}
          onRenameProject={() => {}}
        />
        <Suspense fallback={null}>
          {showNewProjectDialog && (
            <NewProjectDialog
              open={showNewProjectDialog}
              onClose={() => useUIStore.getState().setShowNewProjectDialog(false)}
              onCreate={handleNewProject}
            />
          )}
        </Suspense>
      </div>
    )
  }

  const showPanels = !fullscreen && !panelsHidden

  // Canvas view
  return (
    <>
    {!ready && <LoadingOverlay />}
    <div
      className={styles.app}
      data-fullscreen={fullscreen || undefined}
      data-panels-hidden={panelsHidden || undefined}
    >
      {!fullscreen && (
        <>
          <TitleBar
            onOpenFilter={handleOpenFilter}
            onUndo={undo}
            onRedo={redo}
            onImportImage={handleImportImage}
            manager={manager}
          />
          <BrushControls />
        </>
      )}
      <div className={styles.workspace}>
        {showPanels && leftPanelOpen && (
          <div className={styles.leftPanel}>
            <LayersPanel manager={manager} />
          </div>
        )}

        {/* Center: Canvas */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onContextMenu={handleCanvasContextMenu} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <CanvasViewport ref={containerRef} />
        </div>

        {showPanels && rightPanelOpen && (
          <div className={styles.rightPanel}>
            <div className={styles.rightPanelHeader}>
              <button
                className={styles.rightPanelTab}
                data-active={rightPanelTab === 'color'}
                onClick={() => useUIStore.getState().setRightPanelTab('color')}
              >
                Color
              </button>
              <button
                className={styles.rightPanelTab}
                data-active={rightPanelTab === 'brush'}
                onClick={() => useUIStore.getState().setRightPanelTab('brush')}
              >
                Brush
              </button>
            </div>
            <div className={styles.rightPanelContent}>
              {rightPanelTab === 'color' && <ColorPanel />}
            </div>
          </div>
        )}
      </div>
      {fullscreen && <FullscreenHud manager={manager} />}
      <FilterDialogRouter onApply={handleFilterApply} onCancel={handleFilterCancel} />
      <Suspense fallback={null}>
        {showExportDialog && (
          <ExportDialog
            open={showExportDialog}
            projectName={projectName}
            width={canvasWidth}
            height={canvasHeight}
            layerCount={manager?.layerManager.layers.length ?? 1}
            onClose={() => useUIStore.getState().setShowExportDialog(false)}
            onExport={handleExport}
          />
        )}
        {showNewProjectDialog && (
          <NewProjectDialog
            open={showNewProjectDialog}
            onClose={() => useUIStore.getState().setShowNewProjectDialog(false)}
            onCreate={handleNewProject}
          />
        )}
        {showCanvasSizeDialog && (
          <CanvasSizeDialog
            open={showCanvasSizeDialog}
            currentWidth={canvasWidth}
            currentHeight={canvasHeight}
            onClose={() => useUIStore.getState().setShowCanvasSizeDialog(false)}
            onResize={handleCanvasResize}
          />
        )}
        {showShortcutsModal && (
          <ShortcutsModal
            open={showShortcutsModal}
            onClose={() => useUIStore.getState().setShowShortcutsModal(false)}
          />
        )}
        {showAboutModal && (
          <AboutModal
            open={showAboutModal}
            onClose={() => useUIStore.getState().setShowAboutModal(false)}
          />
        )}
        {showBrushStudio && (
          <BrushStudio
            open={showBrushStudio}
            onClose={() => useUIStore.getState().setShowBrushStudio(false)}
          />
        )}
      </Suspense>
      {ctxMenu && (
        <ContextMenu
          items={canvasContextItems}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <ToastContainer />
    </div>
    </>
  )
}
