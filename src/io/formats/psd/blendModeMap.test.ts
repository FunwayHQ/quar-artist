import { describe, it, expect } from 'vitest'
import { quarToPsdBlendMode, psdToQuarBlendMode } from './blendModeMap.ts'
import { ALL_BLEND_MODES } from '../../../types/layer.ts'

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

    it('maps new blend modes correctly', () => {
      expect(quarToPsdBlendMode('darken')).toBe('darken')
      expect(quarToPsdBlendMode('lighten')).toBe('lighten')
      expect(quarToPsdBlendMode('colorDodge')).toBe('color dodge')
      expect(quarToPsdBlendMode('colorBurn')).toBe('color burn')
      expect(quarToPsdBlendMode('hardLight')).toBe('hard light')
      expect(quarToPsdBlendMode('difference')).toBe('difference')
      expect(quarToPsdBlendMode('exclusion')).toBe('exclusion')
      expect(quarToPsdBlendMode('hue')).toBe('hue')
      expect(quarToPsdBlendMode('saturation')).toBe('saturation')
      expect(quarToPsdBlendMode('vividLight')).toBe('vivid light')
      expect(quarToPsdBlendMode('linearLight')).toBe('linear light')
      expect(quarToPsdBlendMode('pinLight')).toBe('pin light')
      expect(quarToPsdBlendMode('hardMix')).toBe('hard mix')
      expect(quarToPsdBlendMode('subtract')).toBe('subtract')
      expect(quarToPsdBlendMode('divide')).toBe('divide')
      expect(quarToPsdBlendMode('darkerColor')).toBe('darker color')
      expect(quarToPsdBlendMode('lighterColor')).toBe('lighter color')
      expect(quarToPsdBlendMode('dissolve')).toBe('dissolve')
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

    it('maps dissolve → dissolve', () => {
      expect(psdToQuarBlendMode('dissolve')).toBe('dissolve')
    })

    it('returns normal for unknown PSD mode', () => {
      expect(psdToQuarBlendMode('unknown-mode')).toBe('normal')
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
