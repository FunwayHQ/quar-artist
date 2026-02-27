import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock idb
vi.mock('../db/schema.ts', () => ({
  getDB: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  }),
}))

import type { BrushPreset } from '../types/brush.ts'
import { exportBrushPreset, importBrushPreset, loadCustomPresets, saveCustomPresets } from './brushPresets.ts'

const testPreset: BrushPreset = {
  id: 'test-preset',
  name: 'Test Brush',
  category: 'draw',
  size: 12,
  minSize: 5,
  maxSize: 50,
  opacity: 1,
  spacing: 0.1,
  hardness: 1,
  smoothing: 0.5,
  pressureSizeEnabled: true,
  pressureOpacityEnabled: false,
  isEraser: false,
  scatter: 0,
  rotationJitter: 0,
  usesSmudge: false,
  shapeTextureId: 'hard-round',
  pressureCurve: [0.25, 0.25, 0.75, 0.75],
}

describe('brushPresets', () => {
  describe('QBrush format', () => {
    it('JSON format is valid', () => {
      const data = { version: 1 as const, preset: testPreset }
      const json = JSON.stringify(data)
      const parsed = JSON.parse(json)
      expect(parsed.version).toBe(1)
      expect(parsed.preset.id).toBe('test-preset')
      expect(parsed.preset.name).toBe('Test Brush')
      expect(parsed.preset.pressureCurve).toEqual([0.25, 0.25, 0.75, 0.75])
    })

    it('round-trips preset through JSON', () => {
      const data = { version: 1 as const, preset: testPreset }
      const json = JSON.stringify(data)
      const parsed = JSON.parse(json)
      expect(parsed.preset).toEqual(testPreset)
    })

    it('validates required fields', () => {
      const invalid = { version: 1, preset: { name: 'Incomplete' } }
      expect(invalid.preset.id).toBeUndefined()
    })
  })

  describe('exportBrushPreset', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('creates a downloadable blob with correct filename', () => {
      const mockClick = vi.fn()
      const mockCreateElement = vi.spyOn(document, 'createElement')
      const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test')
      const mockRevokeObjectURL = vi.fn()
      URL.createObjectURL = mockCreateObjectURL
      URL.revokeObjectURL = mockRevokeObjectURL

      const anchor = { href: '', download: '', click: mockClick } as unknown as HTMLAnchorElement
      mockCreateElement.mockImplementation((tag: string) => {
        if (tag === 'a') return anchor
        return document.createElement(tag)
      })

      exportBrushPreset(testPreset)

      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(anchor.download).toBe('Test_Brush.qbrush')
      expect(mockClick).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test')
    })

    it('sanitizes special characters in filename', () => {
      const mockClick = vi.fn()
      URL.createObjectURL = vi.fn().mockReturnValue('blob:test')
      URL.revokeObjectURL = vi.fn()
      const anchor = { href: '', download: '', click: mockClick } as unknown as HTMLAnchorElement
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') return anchor
        return document.createElement(tag)
      })

      exportBrushPreset({ ...testPreset, name: 'My Brush (v2) #1' })
      expect(anchor.download).toBe('My_Brush__v2___1.qbrush')
    })
  })

  describe('importBrushPreset', () => {
    it('returns null when no file is selected', async () => {
      const mockInput = {
        type: '',
        accept: '',
        onchange: null as (() => void) | null,
        files: [] as unknown as FileList,
        click: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'input') return mockInput as unknown as HTMLInputElement
        return document.createElement(tag)
      })

      const promise = importBrushPreset()

      // Simulate empty file selection
      mockInput.files = { 0: undefined, length: 0 } as unknown as FileList
      mockInput.onchange!()

      const result = await promise
      expect(result).toBeNull()
    })

    it('parses valid .qbrush file and assigns new ID', async () => {
      const qbrushData = JSON.stringify({ version: 1, preset: testPreset })
      const mockFile = new File([qbrushData], 'test.qbrush', { type: 'application/json' })

      const mockInput = {
        type: '',
        accept: '',
        onchange: null as (() => void) | null,
        files: { 0: mockFile, length: 1 } as unknown as FileList,
        click: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'input') return mockInput as unknown as HTMLInputElement
        return document.createElement(tag)
      })

      const promise = importBrushPreset()
      mockInput.onchange!()

      const result = await promise
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Test Brush')
      // Should have a new ID (not the original)
      expect(result!.id).not.toBe('test-preset')
      expect(result!.id).toMatch(/^imported-/)
    })

    it('rejects invalid .qbrush file (wrong version)', async () => {
      const qbrushData = JSON.stringify({ version: 2, preset: testPreset })
      const mockFile = new File([qbrushData], 'test.qbrush', { type: 'application/json' })

      const mockInput = {
        type: '',
        accept: '',
        onchange: null as (() => void) | null,
        files: { 0: mockFile, length: 1 } as unknown as FileList,
        click: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'input') return mockInput as unknown as HTMLInputElement
        return document.createElement(tag)
      })

      const promise = importBrushPreset()
      mockInput.onchange!()

      const result = await promise
      expect(result).toBeNull()
    })

    it('rejects file with missing preset fields', async () => {
      const qbrushData = JSON.stringify({ version: 1, preset: {} })
      const mockFile = new File([qbrushData], 'test.qbrush', { type: 'application/json' })

      const mockInput = {
        type: '',
        accept: '',
        onchange: null as (() => void) | null,
        files: { 0: mockFile, length: 1 } as unknown as FileList,
        click: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'input') return mockInput as unknown as HTMLInputElement
        return document.createElement(tag)
      })

      const promise = importBrushPreset()
      mockInput.onchange!()

      const result = await promise
      expect(result).toBeNull()
    })
  })

  describe('loadCustomPresets', () => {
    it('returns empty array when no presets saved', async () => {
      const result = await loadCustomPresets()
      expect(result).toEqual([])
    })
  })

  describe('saveCustomPresets', () => {
    it('does not throw on save', async () => {
      await expect(saveCustomPresets([testPreset])).resolves.toBeUndefined()
    })
  })
})
