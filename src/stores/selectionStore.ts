import { create } from 'zustand'
import type { SelectionToolType, SelectionMode, BoundingBox, MagicWandOptions, FeatherOptions } from '@app-types/selection.ts'

interface SelectionStore {
  /** Which sub-tool is active within the selection tool group */
  activeSubTool: SelectionToolType
  /** Current selection mode (how new operations combine with existing selection) */
  selectionMode: SelectionMode
  /** Whether the canvas currently has a selection */
  hasSelection: boolean
  /** Bounding box of the current selection */
  selectionBounds: BoundingBox | null
  /** Magic wand options */
  magicWandOptions: MagicWandOptions
  /** Feather options */
  featherOptions: FeatherOptions

  setSubTool: (tool: SelectionToolType) => void
  setSelectionMode: (mode: SelectionMode) => void
  setHasSelection: (has: boolean, bounds: BoundingBox | null) => void
  setMagicWandTolerance: (tolerance: number) => void
  setMagicWandContiguous: (contiguous: boolean) => void
  setFeatherRadius: (radius: number) => void
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  activeSubTool: 'rectangle',
  selectionMode: 'replace',
  hasSelection: false,
  selectionBounds: null,
  magicWandOptions: { tolerance: 10, contiguous: true },
  featherOptions: { radius: 0 },

  setSubTool: (tool) => set({ activeSubTool: tool }),
  setSelectionMode: (mode) => set({ selectionMode: mode }),
  setHasSelection: (has, bounds) => set({ hasSelection: has, selectionBounds: bounds }),
  setMagicWandTolerance: (tolerance) =>
    set((s) => ({ magicWandOptions: { ...s.magicWandOptions, tolerance: Math.max(0, Math.min(255, tolerance)) } })),
  setMagicWandContiguous: (contiguous) =>
    set((s) => ({ magicWandOptions: { ...s.magicWandOptions, contiguous } })),
  setFeatherRadius: (radius) =>
    set({ featherOptions: { radius: Math.max(0, radius) } }),
}))
