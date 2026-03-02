import { create } from 'zustand'

interface TransformActions {
  commitTransform: (() => void) | null
  cancelTransform: (() => void) | null
  flipHorizontal: (() => void) | null
  flipVertical: (() => void) | null
  rotateCW: (() => void) | null
  rotateCCW: (() => void) | null
}

interface TransformStore extends TransformActions {
  /** Whether a freeform transform is currently active on a layer. */
  isActive: boolean
  setIsActive: (active: boolean) => void
  setActions: (actions: Partial<TransformActions>) => void
}

export const useTransformStore = create<TransformStore>((set) => ({
  isActive: false,
  commitTransform: null,
  cancelTransform: null,
  flipHorizontal: null,
  flipVertical: null,
  rotateCW: null,
  rotateCCW: null,
  setIsActive: (active) => set({ isActive: active }),
  setActions: (actions) => set(actions),
}))
