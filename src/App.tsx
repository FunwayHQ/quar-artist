import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
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
import { EngineErrorScreen } from '@components/ui/EngineErrorScreen.tsx'
import { QuickMenu } from '@components/shell/QuickMenu.tsx'
import { TextInputOverlay } from '@components/shell/TextInputOverlay.tsx'
import { CookieConsentBanner } from '@components/shell/CookieConsentBanner.tsx'
import { ErrorBoundary } from '@components/ui/ErrorBoundary.tsx'

// Lazy-loaded dialogs — only fetched when opened
const ExportDialog = lazy(() => import('@components/dialogs/ExportDialog.tsx').then(m => ({ default: m.ExportDialog })))
const NewProjectDialog = lazy(() => import('@components/dialogs/NewProjectDialog.tsx').then(m => ({ default: m.NewProjectDialog })))
const CanvasSizeDialog = lazy(() => import('@components/dialogs/CanvasSizeDialog.tsx').then(m => ({ default: m.CanvasSizeDialog })))
const ShortcutsModal = lazy(() => import('@components/dialogs/ShortcutsModal.tsx').then(m => ({ default: m.ShortcutsModal })))
const AboutModal = lazy(() => import('@components/dialogs/AboutModal.tsx').then(m => ({ default: m.AboutModal })))
const BrushStudio = lazy(() => import('@components/dialogs/BrushStudio.tsx').then(m => ({ default: m.BrushStudio })))
const DrawingGuidesDialog = lazy(() => import('@components/dialogs/DrawingGuidesDialog.tsx').then(m => ({ default: m.DrawingGuidesDialog })))
const TimelapseExportDialog = lazy(() => import('@components/dialogs/TimelapseExportDialog.tsx').then(m => ({ default: m.TimelapseExportDialog })))
const QuickMenuSettingsDialog = lazy(() => import('@components/dialogs/QuickMenuSettingsDialog.tsx').then(m => ({ default: m.QuickMenuSettingsDialog })))
import { useEngine } from '@hooks/useEngine.ts'
import { getBackend } from '@engine/renderer.ts'
import { projectService, sortDroppedFiles } from './io/persistence/ProjectService.ts'
import type { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import type { GalleryActions } from '@components/gallery/GalleryView.tsx'
import { useKeyboardShortcuts } from '@hooks/useKeyboardShortcuts.ts'
import { useGlobalErrorToasts } from '@hooks/useGlobalErrorToasts.ts'
import { useFileDrop } from '@hooks/useFileDrop.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { useFilterStore } from '@stores/filterStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'
import { useGuideStore } from '@stores/guideStore.ts'
import { useTimelapseStore } from '@stores/timelapseStore.ts'
import { useTextStore } from '@stores/textStore.ts'
import { useQuickMenuStore } from '@stores/quickMenuStore.ts'
import { useTransformStore } from '@stores/transformStore.ts'
import { exportImage, downloadBlob } from './io/formats/image/ImageExporter.ts'
import { getImageFromClipboard, decodeImageBlob, pickImageFile } from './io/importImage.ts'
import { hsbToRgba, rgbaToHsb } from '@app-types/color.ts'
import { isGoogleFontsConsented, isGoogleFontsDeclined, setGoogleFontsConsent, preloadGoogleFonts, GOOGLE_FONTS_POPULAR } from './utils/googleFonts.ts'
import { WEB_SAFE_FONTS } from '@app-types/text.ts'
import type { ExportOptions, NewProjectConfig } from '@app-types/project.ts'
import type { FilterType } from '@app-types/filter.ts'
import type { QuickMenuSlot } from '@app-types/quickmenu.ts'
import styles from './App.module.css'

/** The Gallery's actions, all handled by the project service. */
const GALLERY_ACTIONS: GalleryActions = {
  openProject: (id) => void projectService.openProject(id),
  newProject: () => useUIStore.getState().setShowNewProjectDialog(true),
  renameProject: (id, name) => void projectService.renameProject(id, name),
  duplicateProject: (id) => void projectService.duplicateProject(id),
  deleteProject: (id) => void projectService.deleteProject(id),
  moveToStack: (projectId, stackId) => void projectService.moveToStack(projectId, stackId),
  createStack: (name, projectIds) => void projectService.createStack(name, projectIds),
  renameStack: (id, name) => void projectService.renameStack(id, name),
  unstack: (id) => void projectService.unstack(id),
  openStack: (id) => projectService.openStack(id),
  setSort: (sort) => void projectService.setSort(sort),
  importFiles: (files) => void projectService.importFiles(files),
}

/** Add an image file to the canvas as a new layer, and say how it went. */
async function addImageLayer(manager: CanvasManager, file: File) {
  try {
    const { pixels, width, height } = await decodeImageBlob(file)
    const layerName = manager.importImageToNewLayer(pixels, width, height, file.name.replace(/\.[^.]+$/, ''))
    if (layerName) {
      useUIStore.getState().addToast(`Imported "${file.name}" (${width}×${height})`, 'success')
    }
  } catch (err) {
    console.error('Import failed:', err)
    useUIStore.getState().addToast(`Couldn't import \u201c${file.name}\u201d`, 'error')
  }
}

export default function App() {
  const {
    containerRef, manager, ready, error: engineError, undo, redo,
    commitTransform, cancelTransform,
    flipLayerHorizontal, flipLayerVertical,
    rotateLayer90CW, rotateLayer90CCW,
  } = useEngine()
  useGlobalErrorToasts()
  const rightPanelTab = useUIStore((s) => s.rightPanelTab)
  const showExportDialog = useUIStore((s) => s.showExportDialog)
  const showNewProjectDialog = useUIStore((s) => s.showNewProjectDialog)
  const showShortcutsModal = useUIStore((s) => s.showShortcutsModal)
  const showAboutModal = useUIStore((s) => s.showAboutModal)
  const showCanvasSizeDialog = useUIStore((s) => s.showCanvasSizeDialog)
  const showBrushStudio = useUIStore((s) => s.showBrushStudio)
  const showDrawingGuidesDialog = useUIStore((s) => s.showDrawingGuidesDialog)
  const showTimelapseExportDialog = useUIStore((s) => s.showTimelapseExportDialog)
  const showQuickMenuSettings = useUIStore((s) => s.showQuickMenuSettings)
  const timelapseVideoBlob = useTimelapseStore((s) => s.videoBlob)
  const timelapseFrameCount = useTimelapseStore((s) => s.frameCount)
  const fullscreen = useUIStore((s) => s.fullscreen)
  const panelsHidden = useUIStore((s) => s.panelsHidden)
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const appView = useProjectStore((s) => s.view)
  const canvasWidth = useProjectStore((s) => s.canvasWidth)
  const canvasHeight = useProjectStore((s) => s.canvasHeight)
  const projectName = useProjectStore((s) => s.currentProjectName)
  const sessionId = useProjectStore((s) => s.sessionId)
  const openProgress = useProjectStore((s) => s.openProgress)

  // Open the Gallery, or a new project when there are none (M1.1)
  useEffect(() => {
    void projectService.start()
  }, [])

  // Hand each document's engine to the project service, which loads the document and saves it
  useEffect(() => (manager ? projectService.attachEngine(manager) : undefined), [manager])

  // Google Fonts consent state
  // Ask until the user has either consented or declined
  const [showConsentBanner, setShowConsentBanner] = useState(
    () => !isGoogleFontsConsented() && !isGoogleFontsDeclined(),
  )

  useEffect(() => {
    // If already consented, preload fonts and update text store
    if (isGoogleFontsConsented()) {
      preloadGoogleFonts()
      const merged = [...new Set([...WEB_SAFE_FONTS, ...GOOGLE_FONTS_POPULAR])].sort((a, b) => a.localeCompare(b))
      useTextStore.getState().setAvailableFonts(merged)
    }
  }, [])

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

  // Sync document size to engine, and show the document: as it was last
  // viewed when it opens with a saved view (plan M1.4), otherwise fitted
  useEffect(() => {
    if (!manager || !ready) return
    manager.setDocumentSize(canvasWidth, canvasHeight)
    // Use double-RAF to ensure the browser has fully laid out the container
    // before we measure its dimensions for fit-to-document calculation
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const view = useProjectStore.getState().takeInitialView()
        if (!view || !manager.restoreView(view)) manager.fitToDocument()
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
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

  // Sync guide store to engine
  useEffect(() => {
    if (!manager) return
    const syncGuides = () => manager.applyGuideSettings(useGuideStore.getState())
    syncGuides()
    const unsub = useGuideStore.subscribe(syncGuides)
    return unsub
  }, [manager])

  // Sync modifier keys for selection constraint (Shift) and mode (Shift/Alt)
  useEffect(() => {
    if (!manager) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        manager.setSelectionConstrained(true)
        manager.transformController.setConstrained(true)
      }
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
      if (e.key === 'Shift') {
        manager.setSelectionConstrained(false)
        manager.transformController.setConstrained(false)
      }
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
    if (options.format === 'qart') {
      // Within the click, which lets the browser show its picker (plan M1.5).
      useUIStore.getState().setShowExportDialog(false)
      void projectService.saveAsFile()
      return
    }
    if (options.format === 'psd') {
      useUIStore.getState().setShowExportDialog(false)
      void projectService.exportPsd()
      return
    }
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
    } catch (err) {
      console.error('Export failed:', err)
      useUIStore.getState().addToast('Export failed', 'error')
    }
    useUIStore.getState().setShowExportDialog(false)
  }, [manager, projectName])

  // New project: saves and closes the open one, then opens a fresh document
  const handleNewProject = useCallback((config: NewProjectConfig) => {
    useUIStore.getState().setShowNewProjectDialog(false)
    void projectService.createProject(config)
  }, [])

  // Ctrl+S and File › Save; Save as .qart… and Open… (plan M1.5). Each runs
  // within the key press or click, which lets the browser show a picker.
  const handleSave = useCallback(() => {
    void projectService.saveNow()
  }, [])
  const handleSaveAs = useCallback(() => {
    void projectService.saveAsFile()
  }, [])
  const handleOpen = useCallback(() => {
    void projectService.openFile()
  }, [])

  // Canvas resize handler
  const handleCanvasResize = useCallback((width: number, height: number) => {
    useProjectStore.getState().setCanvasSize(width, height)
    useUIStore.getState().setShowCanvasSizeDialog(false)
    useUIStore.getState().addToast(`Canvas resized to ${width}×${height}`, 'success')
  }, [])

  // ── Image import: clipboard paste (Ctrl+V) ──
  useEffect(() => {
    if (!manager) return
    const handlePaste = async (e: ClipboardEvent) => {
      // A document still opening would lose the layer when its saved layers come in.
      if (useProjectStore.getState().openProgress !== null) return
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

  // ── Files dropped on the canvas view (plan M1.5): images become layers, a .qart file opens ──
  const handleDropFiles = useCallback((files: File[]) => {
    if (!manager) return
    const { images, project, refused } = sortDroppedFiles(files)
    for (const message of refused) useUIStore.getState().addToast(message, 'error')
    void (async () => {
      for (const file of images) await addImageLayer(manager, file)
      if (project) await projectService.openFromFile(project)
    })()
  }, [manager])

  // ── Image import: file picker (File > Import Image) ──
  const handleImportImage = useCallback(async () => {
    if (!manager) return
    const file = await pickImageFile()
    if (file) await addImageLayer(manager, file)
  }, [manager])

  // ── Timelapse recording ──
  const handleStartRecording = useCallback(() => {
    if (!manager) return
    manager.timelapseRecorder.startRecording()
    useTimelapseStore.getState().setState('recording')
    useTimelapseStore.getState().setFrameCount(0)
    useUIStore.getState().addToast('Recording started', 'info')
  }, [manager])

  const handleStopRecording = useCallback(async () => {
    if (!manager) return
    try {
      const blob = await manager.timelapseRecorder.stopRecording()
      useTimelapseStore.getState().setVideoBlob(blob)
      useTimelapseStore.getState().setState('idle')
      useUIStore.getState().setShowTimelapseExportDialog(true)
    } catch {
      useUIStore.getState().addToast('Failed to stop recording', 'error')
    }
  }, [manager])

  const handleDiscardRecording = useCallback(() => {
    if (!manager) return
    manager.timelapseRecorder.discard()
    useTimelapseStore.getState().reset()
    useUIStore.getState().addToast('Recording discarded', 'info')
  }, [manager])

  const handleToggleRecording = useCallback(() => {
    const state = useTimelapseStore.getState().state
    if (state === 'idle') handleStartRecording()
    else handleStopRecording()
  }, [handleStartRecording, handleStopRecording])

  const handleTimelapseDownload = useCallback(() => {
    const blob = useTimelapseStore.getState().videoBlob
    if (blob) {
      downloadBlob(blob, `${projectName}-timelapse.webm`)
      useUIStore.getState().addToast('Timelapse downloaded', 'success')
    }
    useUIStore.getState().setShowTimelapseExportDialog(false)
    useTimelapseStore.getState().reset()
  }, [projectName])

  const handleTimelapseDiscard = useCallback(() => {
    useUIStore.getState().setShowTimelapseExportDialog(false)
    useTimelapseStore.getState().reset()
  }, [])

  // Sync timelapse frame count from engine to store via callback
  useEffect(() => {
    if (!manager) return
    manager.timelapseRecorder.setFrameCountCallback((count) => {
      useTimelapseStore.getState().setFrameCount(count)
    })
    return () => manager.timelapseRecorder.setFrameCountCallback(null)
  }, [manager])

  // ── Guides moved on the canvas: the store keeps them, and the project saves them ──
  useEffect(() => {
    if (!manager) return
    manager.setSymmetryCenterChangedCallback((cx, cy) => {
      useGuideStore.setState({ symmetryCenterX: cx, symmetryCenterY: cy })
    })
    manager.setVanishingPointsChangedCallback((points) => useGuideStore.getState().setVanishingPoints(points))
    return () => manager.setVanishingPointsChangedCallback(null)
  }, [manager])

  // ── Transform tool actions ──
  useEffect(() => {
    useTransformStore.getState().setActions({
      commitTransform,
      cancelTransform,
      flipHorizontal: flipLayerHorizontal,
      flipVertical: flipLayerVertical,
      rotateCW: rotateLayer90CW,
      rotateCCW: rotateLayer90CCW,
    })
  }, [commitTransform, cancelTransform, flipLayerHorizontal, flipLayerVertical, rotateLayer90CW, rotateLayer90CCW])

  // Sync transform active state to store via callback
  useEffect(() => {
    if (!manager) return
    manager.transformController.setActiveChangeCallback((active) => {
      useTransformStore.getState().setIsActive(active)
    })
    return () => manager.transformController.setActiveChangeCallback(null)
  }, [manager])

  // ── Text tool ──
  useEffect(() => {
    if (!manager) return
    manager.setTextInputCallback((screenX, screenY, canvasX, canvasY) => {
      useTextStore.getState().beginEditing(screenX, screenY, canvasX, canvasY)
    })
  }, [manager])

  // Sync text color from color store
  useEffect(() => {
    const unsub = useColorStore.subscribe((state) => {
      const rgba = hsbToRgba(state.primary)
      const hex = '#' + [rgba.r, rgba.g, rgba.b].map(c => c.toString(16).padStart(2, '0')).join('')
      useTextStore.getState().setColor(hex)
    })
    return unsub
  }, [])

  const handleTextCommit = useCallback(async (text: string) => {
    if (!manager) return
    const pos = useTextStore.getState().editPosition
    if (!pos) return
    const props = useTextStore.getState().properties
    // Ensure Google Font is loaded before rasterizing
    await manager.textTool.ensureFontLoaded(props.fontFamily)
    manager.commitText(text, props, pos.canvasX, pos.canvasY)
    useTextStore.getState().endEditing()
  }, [manager])

  const handleTextCancel = useCallback(() => {
    useTextStore.getState().endEditing()
  }, [])

  // ── Google Fonts consent ──
  const handleFontConsentAccept = useCallback(() => {
    setGoogleFontsConsent(true)
    setShowConsentBanner(false)
    preloadGoogleFonts()
    const merged = [...new Set([...WEB_SAFE_FONTS, ...GOOGLE_FONTS_POPULAR])].sort((a, b) => a.localeCompare(b))
    useTextStore.getState().setAvailableFonts(merged)
  }, [])

  const handleFontConsentDecline = useCallback(() => {
    setGoogleFontsConsent(false)
    setShowConsentBanner(false)
  }, [])

  // ── Quick Menu ──
  const handleQuickMenuAction = useCallback((slot: QuickMenuSlot) => {
    if (slot.actionType.kind === 'tool') {
      useToolStore.getState().setTool(slot.actionType.tool)
    } else {
      switch (slot.actionType.action) {
        case 'undo': undo(); break
        case 'redo': redo(); break
        case 'clear-layer': manager?.clearActiveLayer(); break
      }
    }
  }, [manager, undo, redo])

  const handleShowQuickMenu = useCallback(() => {
    const vw = window.innerWidth / 2
    const vh = window.innerHeight / 2
    useQuickMenuStore.getState().show(vw, vh)
  }, [])

  const handleClearLayer = useCallback(() => {
    manager?.clearActiveLayer()
  }, [manager])

  // Keyboard shortcuts (declarative registry-based system)
  useKeyboardShortcuts({
    manager,
    undo,
    redo,
    onOpenFilter: handleOpenFilter,
    onToggleRecording: handleToggleRecording,
    onQuickMenu: handleShowQuickMenu,
    onClearLayer: handleClearLayer,
    onCommitTransform: commitTransform,
    onCancelTransform: cancelTransform,
    onFlipHorizontal: flipLayerHorizontal,
    onFlipVertical: flipLayerVertical,
    onRotateCW: rotateLayer90CW,
    onRotateCCW: rotateLayer90CCW,
    onSave: handleSave,
    onSaveAs: handleSaveAs,
    onOpen: handleOpen,
  })

  // Files dropped anywhere never open in the browser instead (plan M1.5). The
  // canvas view takes them once its document is all in: dropped on a document
  // still opening, they would be lost when its saved layers come in.
  useFileDrop(appView === 'canvas' && ready && openProgress === null && !engineError ? handleDropFiles : null)

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

  // Deciding where to start, or reading a project before it opens
  if (appView === 'loading') {
    return (
      <div className={styles.app}>
        <LoadingOverlay label="Loading…" />
        <ToastContainer />
      </div>
    )
  }

  // Gallery view
  if (appView === 'gallery') {
    return (
      <div className={styles.app}>
        <GalleryView actions={GALLERY_ACTIONS} />
        <Suspense fallback={null}>
          {showNewProjectDialog && (
            <NewProjectDialog
              open={showNewProjectDialog}
              onClose={() => useUIStore.getState().setShowNewProjectDialog(false)}
              onCreate={handleNewProject}
            />
          )}
        </Suspense>
        <ToastContainer />
      </div>
    )
  }

  const showPanels = !fullscreen && !panelsHidden

  // Canvas view
  return (
    <>
    {engineError ? (
      <EngineErrorScreen error={engineError} />
    ) : openProgress !== null ? (
      // Opening a saved project: nothing on the canvas can be used until it is all in (plan M1.4).
      <LoadingOverlay label={`Opening \u201c${projectName}\u201d`} progress={ready ? openProgress : undefined} />
    ) : (
      !ready && <LoadingOverlay />
    )}
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
            onSave={handleSave}
            onSaveAs={handleSaveAs}
            onOpen={handleOpen}
            onImportImage={handleImportImage}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onDiscardRecording={handleDiscardRecording}
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
        <div onContextMenu={handleCanvasContextMenu} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <CanvasViewport
            key={sessionId ?? 'unsaved'}
            ref={containerRef}
            engineReady={ready && openProgress === null}
            renderer={(ready && getBackend()) || undefined}
          />
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
      {fullscreen && <FullscreenHud />}
      <FilterDialogRouter onApply={handleFilterApply} onCancel={handleFilterCancel} />
      <ErrorBoundary>
      <Suspense fallback={null}>
        {showExportDialog && (
          <ExportDialog
            open={showExportDialog}
            projectName={projectName}
            width={canvasWidth}
            height={canvasHeight}
            layerCount={manager?.layerManager.count ?? 1}
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
        {showDrawingGuidesDialog && (
          <DrawingGuidesDialog
            open={showDrawingGuidesDialog}
            onClose={() => useUIStore.getState().setShowDrawingGuidesDialog(false)}
          />
        )}
        {showTimelapseExportDialog && timelapseVideoBlob && (
          <TimelapseExportDialog
            open={showTimelapseExportDialog}
            videoBlob={timelapseVideoBlob}
            frameCount={timelapseFrameCount}
            onDownload={handleTimelapseDownload}
            onDiscard={handleTimelapseDiscard}
            onClose={() => useUIStore.getState().setShowTimelapseExportDialog(false)}
          />
        )}
        {showQuickMenuSettings && (
          <QuickMenuSettingsDialog
            open={showQuickMenuSettings}
            onClose={() => useUIStore.getState().setShowQuickMenuSettings(false)}
          />
        )}
      </Suspense>
      </ErrorBoundary>
      {ctxMenu && (
        <ContextMenu
          items={canvasContextItems}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <QuickMenu onAction={handleQuickMenuAction} />
      <TextInputOverlay onCommit={handleTextCommit} onCancel={handleTextCancel} />
      {showConsentBanner && (
        <CookieConsentBanner onAccept={handleFontConsentAccept} onDecline={handleFontConsentDecline} />
      )}
      <ToastContainer />
    </div>
    </>
  )
}
