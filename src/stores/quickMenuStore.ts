import { create } from 'zustand'
import type { QuickMenuSlot } from '../types/quickmenu.ts'
import { DEFAULT_QUICK_MENU_SLOTS } from '../types/quickmenu.ts'

interface QuickMenuStore {
  slots: QuickMenuSlot[]
  visible: boolean
  position: { x: number; y: number }
  activeSlotIndex: number | null

  show: (x: number, y: number) => void
  hide: () => void
  setActiveSlotIndex: (index: number | null) => void
  setSlot: (index: number, slot: QuickMenuSlot) => void
  resetToDefaults: () => void
  setSlots: (slots: QuickMenuSlot[]) => void
}

export const useQuickMenuStore = create<QuickMenuStore>((set) => ({
  slots: [...DEFAULT_QUICK_MENU_SLOTS],
  visible: false,
  position: { x: 0, y: 0 },
  activeSlotIndex: null,

  show: (x, y) => set({ visible: true, position: { x, y }, activeSlotIndex: null }),
  hide: () => set({ visible: false, activeSlotIndex: null }),
  setActiveSlotIndex: (index) => set({ activeSlotIndex: index }),
  setSlot: (index, slot) =>
    set((s) => {
      const slots = [...s.slots]
      slots[index] = slot
      return { slots }
    }),
  resetToDefaults: () => set({ slots: [...DEFAULT_QUICK_MENU_SLOTS] }),
  setSlots: (slots) => set({ slots }),
}))
