import { describe, it, expect } from 'vitest'
import {
  defaultGaussianBlurParams,
  defaultSharpenParams,
  defaultHSBAdjustmentParams,
  defaultCurvesParams,
  defaultParamsForFilter,
} from './filter.ts'
import type { FilterType, FilterParams, CurveChannel } from './filter.ts'

describe('filter types', () => {
  describe('defaultGaussianBlurParams', () => {
    it('returns correct type and default radius', () => {
      const params = defaultGaussianBlurParams()
      expect(params.type).toBe('gaussianBlur')
      expect(params.radius).toBe(5)
    })
  })

  describe('defaultSharpenParams', () => {
    it('returns correct type and defaults', () => {
      const params = defaultSharpenParams()
      expect(params.type).toBe('sharpen')
      expect(params.amount).toBe(100)
      expect(params.radius).toBe(1)
      expect(params.threshold).toBe(0)
    })
  })

  describe('defaultHSBAdjustmentParams', () => {
    it('returns correct type with zeroed values', () => {
      const params = defaultHSBAdjustmentParams()
      expect(params.type).toBe('hsbAdjustment')
      expect(params.hueShift).toBe(0)
      expect(params.saturation).toBe(0)
      expect(params.brightness).toBe(0)
    })
  })

  describe('defaultCurvesParams', () => {
    it('returns correct type with identity curves', () => {
      const params = defaultCurvesParams()
      expect(params.type).toBe('curves')
      const channels: CurveChannel[] = ['rgb', 'red', 'green', 'blue']
      for (const ch of channels) {
        expect(params.channels[ch]).toHaveLength(2)
        expect(params.channels[ch][0]).toEqual({ x: 0, y: 0 })
        expect(params.channels[ch][1]).toEqual({ x: 255, y: 255 })
      }
    })

    it('returns independent channel arrays', () => {
      const params = defaultCurvesParams()
      params.channels.rgb.push({ x: 128, y: 200 })
      expect(params.channels.red).toHaveLength(2)
    })
  })

  describe('defaultParamsForFilter', () => {
    it('routes each filter type to correct defaults', () => {
      const types: FilterType[] = ['gaussianBlur', 'sharpen', 'hsbAdjustment', 'curves']
      for (const t of types) {
        const params = defaultParamsForFilter(t)
        expect(params.type).toBe(t)
      }
    })
  })

  describe('discriminated union', () => {
    it('narrows correctly via type field', () => {
      const params: FilterParams = defaultGaussianBlurParams()
      if (params.type === 'gaussianBlur') {
        expect(params.radius).toBeDefined()
      }
    })
  })
})
