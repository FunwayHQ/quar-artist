import type { ToolType } from './engine.ts'

export type QuickMenuActionType =
  | { kind: 'tool'; tool: ToolType }
  | { kind: 'action'; action: string }

export interface QuickMenuSlot {
  label: string
  icon: string  // Lucide icon name
  actionType: QuickMenuActionType
}

export const DEFAULT_QUICK_MENU_SLOTS: QuickMenuSlot[] = [
  { label: 'Brush',       icon: 'Brush',         actionType: { kind: 'tool', tool: 'brush' } },
  { label: 'Eraser',      icon: 'Eraser',        actionType: { kind: 'tool', tool: 'eraser' } },
  { label: 'Undo',        icon: 'Undo2',         actionType: { kind: 'action', action: 'undo' } },
  { label: 'Redo',        icon: 'Redo2',         actionType: { kind: 'action', action: 'redo' } },
  { label: 'Eyedropper',  icon: 'Pipette',       actionType: { kind: 'tool', tool: 'eyedropper' } },
  { label: 'Fill',        icon: 'PaintBucket',   actionType: { kind: 'tool', tool: 'fill' } },
  { label: 'Selection',   icon: 'MousePointer2', actionType: { kind: 'tool', tool: 'selection' } },
  { label: 'Clear Layer', icon: 'Trash2',        actionType: { kind: 'action', action: 'clear-layer' } },
]
