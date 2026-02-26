import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus, Merge, Lock, Scissors, Trash2 } from 'lucide-react'
import { useLayerStore } from '@stores/layerStore.ts'
import { LayerRow } from './LayerRow.tsx'
import type { BlendMode } from '../../types/layer.ts'
import type { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import styles from './LayersPanel.module.css'

interface LayersPanelProps {
  manager: CanvasManager | null
}

export function LayersPanel({ manager }: LayersPanelProps) {
  const layers = useLayerStore((s) => s.layers)
  const activeLayerId = useLayerStore((s) => s.activeLayerId)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  // Layers are stored bottom-to-top in engine, but displayed top-to-bottom in UI
  const displayLayers = [...layers].reverse()

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!manager) return
      const { active, over } = event
      if (!over || active.id === over.id) return

      // Convert display order back to engine order
      const currentIds = displayLayers.map((l) => l.id)
      const oldIndex = currentIds.indexOf(active.id as string)
      const newIndex = currentIds.indexOf(over.id as string)

      if (oldIndex < 0 || newIndex < 0) return

      const reordered = [...currentIds]
      const [moved] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, moved)

      // Reverse back to bottom-to-top for engine
      manager.layerManager.reorderLayers([...reordered].reverse())
      manager.recomposite()
    },
    [manager, displayLayers],
  )

  const handleAddLayer = useCallback(() => {
    if (!manager) return
    manager.layerManager.createLayer()
    manager.syncBrushToActiveLayer()
  }, [manager])

  const handleDeleteLayer = useCallback(() => {
    if (!manager || !activeLayerId) return
    manager.layerManager.deleteLayer(activeLayerId)
    manager.syncBrushToActiveLayer()
    manager.recomposite()
  }, [manager, activeLayerId])

  const handleMergeDown = useCallback(() => {
    if (!manager || !activeLayerId) return
    manager.layerManager.mergeDown(activeLayerId)
    manager.syncBrushToActiveLayer()
    manager.recomposite()
  }, [manager, activeLayerId])

  const handleSelectLayer = useCallback(
    (id: string) => {
      if (!manager) return
      manager.layerManager.setActiveLayer(id)
      manager.syncBrushToActiveLayer()
    },
    [manager],
  )

  const handleToggleVisibility = useCallback(
    (id: string) => {
      if (!manager) return
      const layer = layers.find((l) => l.id === id)
      if (layer) {
        manager.layerManager.setVisibility(id, !layer.visible)
        manager.recomposite()
      }
    },
    [manager, layers],
  )

  const handleOpacityChange = useCallback(
    (id: string, opacity: number) => {
      if (!manager) return
      manager.layerManager.setLayerOpacity(id, opacity)
      manager.recomposite()
    },
    [manager],
  )

  const handleBlendModeChange = useCallback(
    (id: string, mode: BlendMode) => {
      if (!manager) return
      manager.layerManager.setBlendMode(id, mode)
      manager.recomposite()
    },
    [manager],
  )

  const handleRename = useCallback(
    (id: string, name: string) => {
      if (!manager) return
      manager.layerManager.renameLayer(id, name)
    },
    [manager],
  )

  const handleToggleAlphaLock = useCallback(
    (id: string) => {
      if (!manager) return
      manager.layerManager.toggleAlphaLock(id)
    },
    [manager],
  )

  const handleToggleClippingMask = useCallback(
    (id: string) => {
      if (!manager) return
      manager.layerManager.toggleClippingMask(id)
      manager.recomposite()
    },
    [manager],
  )

  return (
    <div className={`glass ${styles.panel}`} role="tree" aria-label="Layers">
      <div className={styles.header}>
        <span className={styles.title}>Layers</span>
        <div className={styles.headerActions}>
          <button
            className={styles.headerBtn}
            onClick={handleAddLayer}
            aria-label="Add layer"
            title="Add layer"
          >
            <Plus size={16} />
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleMergeDown}
            aria-label="Merge down"
            title="Merge down"
            disabled={
              !activeLayerId ||
              layers.findIndex((l) => l.id === activeLayerId) === 0
            }
          >
            <Merge size={16} />
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleDeleteLayer}
            aria-label="Delete layer"
            title="Delete layer"
            disabled={layers.length <= 1}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className={styles.list}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayLayers.map((l) => l.id)}
            strategy={verticalListSortingStrategy}
          >
            {displayLayers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                isActive={layer.id === activeLayerId}
                onSelect={() => handleSelectLayer(layer.id)}
                onToggleVisibility={() => handleToggleVisibility(layer.id)}
                onOpacityChange={(op) => handleOpacityChange(layer.id, op)}
                onBlendModeChange={(mode) =>
                  handleBlendModeChange(layer.id, mode)
                }
                onRename={(name) => handleRename(layer.id, name)}
                onToggleAlphaLock={() => handleToggleAlphaLock(layer.id)}
                onToggleClippingMask={() =>
                  handleToggleClippingMask(layer.id)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <div className={styles.footer}>
        <span className={styles.layerCount}>
          {layers.length} / 20 layers
        </span>
      </div>
    </div>
  )
}
