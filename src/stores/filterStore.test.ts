import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from './filterStore.ts'

describe('filterStore', () => {
  beforeEach(() => {
    useFilterStore.setState({ activeFilter: null, params: null })
  })

  it('starts with no active filter', () => {
    const { activeFilter, params } = useFilterStore.getState()
    expect(activeFilter).toBeNull()
    expect(params).toBeNull()
  })

  describe('openFilter', () => {
    it('sets activeFilter and default params for gaussianBlur', () => {
      useFilterStore.getState().openFilter('gaussianBlur')
      const { activeFilter, params } = useFilterStore.getState()
      expect(activeFilter).toBe('gaussianBlur')
      expect(params).not.toBeNull()
      expect(params!.type).toBe('gaussianBlur')
    })

    it('sets activeFilter and default params for curves', () => {
      useFilterStore.getState().openFilter('curves')
      const { activeFilter, params } = useFilterStore.getState()
      expect(activeFilter).toBe('curves')
      expect(params!.type).toBe('curves')
    })
  })

  describe('updateParams', () => {
    it('replaces the params', () => {
      useFilterStore.getState().openFilter('gaussianBlur')
      useFilterStore.getState().updateParams({ type: 'gaussianBlur', radius: 50 })
      expect(useFilterStore.getState().params).toEqual({ type: 'gaussianBlur', radius: 50 })
    })
  })

  describe('closeFilter', () => {
    it('clears activeFilter and params', () => {
      useFilterStore.getState().openFilter('sharpen')
      useFilterStore.getState().closeFilter()
      const { activeFilter, params } = useFilterStore.getState()
      expect(activeFilter).toBeNull()
      expect(params).toBeNull()
    })
  })

  describe('lifecycle', () => {
    it('supports open → update → close cycle', () => {
      const store = useFilterStore.getState()
      store.openFilter('hsbAdjustment')
      expect(useFilterStore.getState().activeFilter).toBe('hsbAdjustment')

      store.updateParams({ type: 'hsbAdjustment', hueShift: 90, saturation: 50, brightness: -10 })
      expect(useFilterStore.getState().params).toEqual({
        type: 'hsbAdjustment',
        hueShift: 90,
        saturation: 50,
        brightness: -10,
      })

      store.closeFilter()
      expect(useFilterStore.getState().activeFilter).toBeNull()
    })
  })
})
