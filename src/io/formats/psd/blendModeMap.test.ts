import { describe, it, expect } from 'vitest'
import { quarToPsdBlendMode, psdToQuarBlendMode } from './blendModeMap.ts'
import { ALL_BLEND_MODES } from '../../../types/layer.ts'
import type { BlendMode } from '../../../types/layer.ts'

describe('blendModeMap', () => {
  describe('quarToPsdBlendMode', () => {
    it('maps normal → normal', () => {
      expect(quarToPsdBlendMode('normal')).toBe('normal')
    })

    it('maps multiply → multiply', () => {
      expect(quarToPsdBlendMode('multiply')).toBe('multiply')
    })

    it('maps screen → screen', () => {
      expect(quarToPsdBlendMode('screen')).toBe('screen')
    })

    it('maps overlay → overlay', () => {
      expect(quarToPsdBlendMode('overlay')).toBe('overlay')
    })

    it('maps softLight → soft light', () => {
      expect(quarToPsdBlendMode('softLight')).toBe('soft light')
    })

    it('maps add → linear dodge', () => {
      expect(quarToPsdBlendMode('add')).toBe('linear dodge')
    })

    it('maps color → color', () => {
      expect(quarToPsdBlendMode('color')).toBe('color')
    })

    it('maps luminosity → luminosity', () => {
      expect(quarToPsdBlendMode('luminosity')).toBe('luminosity')
    })

    it('every QUAR blend mode has a PSD mapping', () => {
      for (const mode of ALL_BLEND_MODES) {
        const result = quarToPsdBlendMode(mode)
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }
    })
  })

  describe('psdToQuarBlendMode', () => {
    it('maps soft light → softLight', () => {
      expect(psdToQuarBlendMode('soft light')).toBe('softLight')
    })

    it('maps linear dodge → add', () => {
      expect(psdToQuarBlendMode('linear dodge')).toBe('add')
    })

    it('returns normal for unknown PSD mode', () => {
      expect(psdToQuarBlendMode('dissolve')).toBe('normal')
    })

    it('round-trips all QUAR blend modes', () => {
      for (const mode of ALL_BLEND_MODES) {
        const psd = quarToPsdBlendMode(mode)
        const back = psdToQuarBlendMode(psd)
        expect(back).toBe(mode)
      }
    })
  })
})
