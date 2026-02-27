import { create } from 'zustand'
import type { ToolType } from '@app-types/engine.ts'

interface ToolStore {
  activeTool: ToolType
  previousTool: ToolType
  fillTolerance: number
  setTool: (tool: ToolType) => void
  pushTool: (tool: ToolType) => void
  popTool: () => void
  setFillTolerance: (tolerance: number) => void
}

export const useToolStore = create<ToolStore>((set, get) => ({
  activeTool: 'brush',
  previousTool: 'brush',
  fillTolerance: 32,

  setTool: (tool) => set({ activeTool: tool, previousTool: get().activeTool }),

  /** Temporary tool switch (e.g., hold Alt for eyedropper) */
  pushTool: (tool) => set({ activeTool: tool, previousTool: get().activeTool }),

  /** Return to previous tool after temporary switch */
  popTool: () => set((s) => ({ activeTool: s.previousTool })),

  setFillTolerance: (tolerance) => set({ fillTolerance: Math.max(0, Math.min(255, tolerance)) }),
}))
