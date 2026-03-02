import { describe, it, expect, beforeEach } from 'vitest'
import { useQuickMenuStore } from './quickMenuStore.ts'
import { DEFAULT_QUICK_MENU_SLOTS } from '../types/quickmenu.ts'

describe('quickMenuStore', () => {
  beforeEach(() => {
    useQuickMenuStore.getState().resetToDefaults()
    useQuickMenuStore.getState().hide()
  })

  it('has 8 default slots', () => {
    expect(useQuickMenuStore.getState().slots).toHaveLength(8)
    expect(useQuickMenuStore.getState().slots[0].label).toBe('Brush')
    expect(useQuickMenuStore.getState().slots[7].label).toBe('Clear Layer')
  })

  it('starts hidden', () => {
    expect(useQuickMenuStore.getState().visible).toBe(false)
  })

  it('shows at given position', () => {
    useQuickMenuStore.getState().show(300, 400)
    const s = useQuickMenuStore.getState()
    expect(s.visible).toBe(true)
    expect(s.position).toEqual({ x: 300, y: 400 })
    expect(s.activeSlotIndex).toBeNull()
  })

  it('hides and resets active slot', () => {
    useQuickMenuStore.getState().show(100, 100)
    useQuickMenuStore.getState().setActiveSlotIndex(3)
    useQuickMenuStore.getState().hide()

    const s = useQuickMenuStore.getState()
    expect(s.visible).toBe(false)
    expect(s.activeSlotIndex).toBeNull()
  })

  it('tracks active slot index', () => {
    useQuickMenuStore.getState().setActiveSlotIndex(5)
    expect(useQuickMenuStore.getState().activeSlotIndex).toBe(5)

    useQuickMenuStore.getState().setActiveSlotIndex(null)
    expect(useQuickMenuStore.getState().activeSlotIndex).toBeNull()
  })

  it('updates a specific slot', () => {
    useQuickMenuStore.getState().setSlot(0, {
      label: 'Text',
      icon: 'Type',
      actionType: { kind: 'tool', tool: 'text' },
    })
    expect(useQuickMenuStore.getState().slots[0].label).toBe('Text')
    // Other slots unchanged
    expect(useQuickMenuStore.getState().slots[1].label).toBe('Eraser')
  })

  it('resets to defaults', () => {
    useQuickMenuStore.getState().setSlot(0, {
      label: 'Custom',
      icon: 'Star',
      actionType: { kind: 'action', action: 'custom' },
    })
    useQuickMenuStore.getState().resetToDefaults()
    expect(useQuickMenuStore.getState().slots).toEqual(DEFAULT_QUICK_MENU_SLOTS)
  })

  it('sets all slots at once', () => {
    const newSlots = DEFAULT_QUICK_MENU_SLOTS.map((s) => ({ ...s, label: 'X' }))
    useQuickMenuStore.getState().setSlots(newSlots)
    expect(useQuickMenuStore.getState().slots.every((s) => s.label === 'X')).toBe(true)
  })
})
