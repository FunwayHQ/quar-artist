import { describe, it, expect, beforeEach } from 'vitest'
import { useLayerStore } from './layerStore.ts'
import type { LayerInfo } from '../types/layer.ts'

const layer1: LayerInfo = {
  id: 'l1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  alphaLock: false,
  clippingMask: false,
  locked: false,
}

const layer2: LayerInfo = {
  id: 'l2',
  name: 'Layer 2',
  visible: true,
  opacity: 0.8,
  blendMode: 'multiply',
  alphaLock: false,
  clippingMask: false,
  locked: false,
}

describe('layerStore', () => {
  beforeEach(() => {
    useLayerStore.setState({
      layers: [],
      activeLayerId: '',
    })
  })

  it('starts with empty layers', () => {
    expect(useLayerStore.getState().layers).toHaveLength(0)
    expect(useLayerStore.getState().activeLayerId).toBe('')
  })

  describe('syncFromEngine', () => {
    it('updates layers and active id', () => {
      useLayerStore.getState().syncFromEngine([layer1, layer2], 'l2')
      const state = useLayerStore.getState()
      expect(state.layers).toHaveLength(2)
      expect(state.activeLayerId).toBe('l2')
    })

    it('replaces existing layers', () => {
      useLayerStore.getState().syncFromEngine([layer1], 'l1')
      useLayerStore.getState().syncFromEngine([layer2], 'l2')
      expect(useLayerStore.getState().layers).toHaveLength(1)
      expect(useLayerStore.getState().layers[0].id).toBe('l2')
    })
  })

  describe('setActiveLayer', () => {
    it('updates the active layer id', () => {
      useLayerStore.getState().syncFromEngine([layer1, layer2], 'l1')
      useLayerStore.getState().setActiveLayer('l2')
      expect(useLayerStore.getState().activeLayerId).toBe('l2')
    })
  })
})
