import { useRef, useEffect, useCallback } from 'react'
import { TitleBar } from '@components/shell/TitleBar.tsx'
import { BrushControls } from '@components/shell/BrushControls.tsx'
import { CanvasViewport } from '@components/shell/CanvasViewport.tsx'
import { LayersPanel } from '@components/layers/LayersPanel.tsx'
import { ColorPanel } from '@components/color/ColorPanel.tsx'
import { FilterDialogRouter } from '@components/filters/FilterDialogRouter.tsx'
import { ExportDialog } from '@components/dialogs/ExportDialog.tsx'
import { NewProjectDialog } from '@components/dialogs/NewProjectDialog.tsx'
import { GalleryView } from '@components/gallery/GalleryView.tsx'
import { useEngine } from '@hooks/useEngine.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { useFilterStore } from '@stores/filterStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'
import { exportImage, downloadBlob } from './io/formats/image/ImageExporter.ts'
import { hsbToRgba, rgbaToHsb } from '@app-types/color.ts'
import type { ExportOptions } from '@app-types/project.ts'
import type { FilterType } from '@app-types/filter.ts'
import styles from './App.module.css'

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { manager, undo, redo } = useEngine(containerRef)
  const rightPanelTab = useUIStore((s) => s.rightPanelTab)
  const showExportDialog = useUIStore((s) => s.showExportDialog)
  const showNewProjectDialog = useUIStore((s) => s.showNewProjectDialog)
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
      const pixels = manager.getCompositePixels()
      if (!pixels) return
      if (options.format === 'png' || options.format === 'jpeg') {
        const blob = await exportImage(pixels, canvasWidth, canvasHeight, {
          format: options.format,
          quality: options.jpegQuality,
        })
        const ext = options.format === 'jpeg' ? 'jpg' : 'png'
        downloadBlob(blob, `${projectName}.${ext}`)
      }
      // PSD and QART exports can be added here when needed
    } catch (err) {
      console.error('Export failed:', err)
    }
    useUIStore.getState().setShowExportDialog(false)
  }, [manager, canvasWidth, canvasHeight, projectName])

  // New project handler
  const handleNewProject = useCallback((name: string, width: number, height: number, dpi: number) => {
    useProjectStore.getState().setCurrentProject(Date.now(), name, width, height, dpi)
    useUIStore.getState().setShowNewProjectDialog(false)
    // Engine reinit will happen via the view change
  }, [])

  // Gallery handlers
  const handleOpenProject = useCallback((id: number) => {
    useProjectStore.getState().setView('canvas')
  }, [])

  const handleGalleryNewProject = useCallback(() => {
    useUIStore.getState().setShowNewProjectDialog(true)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      if (mod && e.key === 'y') {
        e.preventDefault()
        redo()
      }
      // Select All — Ctrl+A
      if (mod && e.key === 'a') {
        e.preventDefault()
        manager?.selectAll()
      }
      // Deselect — Ctrl+D
      if (mod && e.key === 'd') {
        e.preventDefault()
        manager?.deselectAll()
      }
      // Invert Selection — Ctrl+Shift+I
      if (mod && e.key === 'I' && e.shiftKey) {
        e.preventDefault()
        manager?.invertSelection()
      }
      // Curves — Ctrl+M
      if (mod && e.key === 'm') {
        e.preventDefault()
        handleOpenFilter('curves')
      }
      // Export — Ctrl+E
      if (mod && e.key === 'e' && !e.shiftKey) {
        e.preventDefault()
        useUIStore.getState().setShowExportDialog(true)
      }
      // New — Ctrl+N
      if (mod && e.key === 'n') {
        e.preventDefault()
        useUIStore.getState().setShowNewProjectDialog(true)
      }
      // Save — Ctrl+S
      if (mod && e.key === 's') {
        e.preventDefault()
        // Auto-save is already active; this is a manual trigger
      }
      // Swap colors — X
      if (e.key === 'x' && !mod) {
        useColorStore.getState().swapColors()
      }
      // Tool shortcuts (single key, no modifier)
      if (!mod && !e.shiftKey && !e.altKey) {
        switch (e.key) {
          case 'b': useToolStore.getState().setTool('brush'); break
          case 'e': useToolStore.getState().setTool('eraser'); break
          case 'g': useToolStore.getState().setTool('fill'); break
          case 'i': useToolStore.getState().setTool('eyedropper'); break
          case 'v': useToolStore.getState().setTool('move'); break
          case 'm': useToolStore.getState().setTool('selection'); break
          case 't': useToolStore.getState().setTool('transform'); break
        }
      }
    }

    const handleKeyDown2 = (e: KeyboardEvent) => {
      // Alt hold → temporary eyedropper
      if (e.key === 'Alt' && !e.repeat) {
        const currentTool = useToolStore.getState().activeTool
        if (currentTool !== 'eyedropper') {
          useToolStore.getState().pushTool('eyedropper')
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        if (useToolStore.getState().activeTool === 'eyedropper') {
          useToolStore.getState().popTool()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keydown', handleKeyDown2)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keydown', handleKeyDown2)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [undo, redo, manager, handleOpenFilter])

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
        <NewProjectDialog
          open={showNewProjectDialog}
          onClose={() => useUIStore.getState().setShowNewProjectDialog(false)}
          onCreate={handleNewProject}
        />
      </div>
    )
  }

  // Canvas view
  return (
    <div className={styles.app}>
      <TitleBar
        onOpenFilter={handleOpenFilter}
        onUndo={undo}
        onRedo={redo}
        manager={manager}
      />
      <BrushControls />
      <div className={styles.workspace}>
        {/* Left: Layers panel */}
        <div className={styles.leftPanel}>
          <LayersPanel manager={manager} />
        </div>

        {/* Center: Canvas */}
        <CanvasViewport ref={containerRef} />

        {/* Right: Properties panel (Color / Brush) */}
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
      </div>
      <FilterDialogRouter onApply={handleFilterApply} onCancel={handleFilterCancel} />
      <ExportDialog
        open={showExportDialog}
        projectName={projectName}
        width={canvasWidth}
        height={canvasHeight}
        layerCount={manager?.layerManager.layers.length ?? 1}
        onClose={() => useUIStore.getState().setShowExportDialog(false)}
        onExport={handleExport}
      />
      <NewProjectDialog
        open={showNewProjectDialog}
        onClose={() => useUIStore.getState().setShowNewProjectDialog(false)}
        onCreate={handleNewProject}
      />
    </div>
  )
}
