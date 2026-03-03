import { useEffect, useCallback, useMemo } from 'react'
import { normalizeKeyEvent } from './shortcuts/keyMatcher.ts'
import { DEFAULT_SHORTCUTS, buildShortcutMap } from './shortcuts/shortcutRegistry.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useColorStore } from '@stores/colorStore.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { useFilterStore } from '@stores/filterStore.ts'
import type { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import type { ToolType } from '@app-types/engine.ts'
import type { FilterType } from '@app-types/filter.ts'

interface UseKeyboardShortcutsOptions {
  manager: CanvasManager | null
  undo: () => void
  redo: () => void
  onOpenFilter: (filterType: FilterType) => void
  onToggleRecording?: () => void
  onQuickMenu?: () => void
  onClearLayer?: () => void
  onCommitTransform?: () => void
  onCancelTransform?: () => void
  onFlipHorizontal?: () => void
  onFlipVertical?: () => void
  onRotateCW?: () => void
  onRotateCCW?: () => void
}

export function useKeyboardShortcuts({ manager, undo, redo, onOpenFilter, onToggleRecording, onQuickMenu, onClearLayer, onCommitTransform, onCancelTransform, onFlipHorizontal, onFlipVertical, onRotateCW, onRotateCCW }: UseKeyboardShortcutsOptions) {
  const shortcutMap = useMemo(() => buildShortcutMap(DEFAULT_SHORTCUTS), [])

  const dispatch = useCallback(
    (action: string) => {
      // Tool shortcuts
      if (action.startsWith('tool:')) {
        useToolStore.getState().setTool(action.slice(5) as ToolType)
        return
      }

      // Opacity shortcuts
      if (action.startsWith('opacity:')) {
        const pct = parseInt(action.slice(8), 10)
        useBrushStore.getState().setOpacity(pct / 100)
        return
      }

      // Filter shortcuts
      if (action.startsWith('open-filter:')) {
        onOpenFilter(action.slice(12) as FilterType)
        return
      }

      switch (action) {
        case 'undo':
          undo()
          break
        case 'redo':
          redo()
          break
        case 'swap-colors':
          useColorStore.getState().swapColors()
          break
        case 'reset-colors':
          useColorStore.getState().resetColors()
          break
        case 'size-up':
          useBrushStore.getState().setSize(useBrushStore.getState().size + 5)
          break
        case 'size-down':
          useBrushStore.getState().setSize(useBrushStore.getState().size - 5)
          break
        case 'select-all':
          manager?.selectAll()
          break
        case 'deselect':
          manager?.deselectAll()
          break
        case 'invert-selection':
          manager?.invertSelection()
          break
        case 'toggle-panels':
          useUIStore.getState().togglePanelsHidden()
          break
        case 'fullscreen':
          useUIStore.getState().toggleFullscreen()
          break
        case 'shortcuts-modal':
          useUIStore.getState().setShowShortcutsModal(true)
          break
        case 'fit-to-document':
          manager?.fitToDocument()
          break
        case 'export':
          useUIStore.getState().setShowExportDialog(true)
          break
        case 'new-project':
          useUIStore.getState().setShowNewProjectDialog(true)
          break
        case 'save':
          // Auto-save is already active; this is a manual trigger placeholder
          break
        case 'new-layer':
          if (manager) {
            manager.layerManager.createLayer()
            manager.syncBrushToActiveLayer()
          }
          break
        case 'brush-studio':
          useUIStore.getState().setShowBrushStudio(true)
          break
        case 'toggle-guides':
          useUIStore.getState().setShowDrawingGuidesDialog(true)
          break
        case 'toggle-recording':
          onToggleRecording?.()
          break
        case 'quick-menu':
          onQuickMenu?.()
          break
        case 'clear-layer':
          onClearLayer?.()
          break
        case 'commit-transform':
          if (useToolStore.getState().activeTool === 'transform') {
            onCommitTransform?.()
          }
          break
        case 'cancel-transform':
          if (useToolStore.getState().activeTool === 'transform') {
            onCancelTransform?.()
          }
          break
        case 'flip-horizontal':
          onFlipHorizontal?.()
          break
        case 'flip-vertical':
          onFlipVertical?.()
          break
        case 'rotate-cw':
          onRotateCW?.()
          break
        case 'rotate-ccw':
          onRotateCCW?.()
          break
      }
    },
    [manager, undo, redo, onOpenFilter, onToggleRecording, onQuickMenu, onClearLayer, onCommitTransform, onCancelTransform, onFlipHorizontal, onFlipVertical, onRotateCW, onRotateCCW],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const normalized = normalizeKeyEvent(e)
      if (!normalized) return

      const def = shortcutMap.get(normalized)
      if (def) {
        e.preventDefault()
        dispatch(def.action)
      }
    }

    // Alt hold → temporary eyedropper
    const handleAltDown = (e: KeyboardEvent) => {
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

    // Reset Alt-hold eyedropper if window loses focus (Alt+Tab, etc.)
    const handleBlur = () => {
      if (useToolStore.getState().activeTool === 'eyedropper') {
        useToolStore.getState().popTool()
      }
    }
    const handleVisibilityChange = () => {
      if (document.hidden && useToolStore.getState().activeTool === 'eyedropper') {
        useToolStore.getState().popTool()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keydown', handleAltDown)
    document.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keydown', handleAltDown)
      document.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [shortcutMap, dispatch])
}
