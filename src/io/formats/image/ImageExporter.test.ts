import { describe, it, expect, vi } from 'vitest'
import { downloadBlob } from './ImageExporter.ts'

// Note: exportImage relies on canvas.getContext('2d'), canvas.toBlob, etc.
// which are not fully available in jsdom. It is tested via integration tests.
// Here we test the downloadBlob utility and the module structure.

describe('ImageExporter', () => {
  describe('module exports', () => {
    it('exports exportImage function', async () => {
      const mod = await import('./ImageExporter.ts')
      expect(typeof mod.exportImage).toBe('function')
    })

    it('exports downloadBlob function', async () => {
      const mod = await import('./ImageExporter.ts')
      expect(typeof mod.downloadBlob).toBe('function')
    })
  })

  describe('downloadBlob', () => {
    it('creates and clicks a download link', () => {
      const blob = new Blob(['test'], { type: 'text/plain' })
      const clickSpy = vi.fn()

      const origCreateObjectURL = URL.createObjectURL
      const origRevokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn(() => 'blob:test-url')
      URL.revokeObjectURL = vi.fn()

      const origCreateElement = document.createElement.bind(document)
      const mockAnchor = origCreateElement('a')
      mockAnchor.click = clickSpy
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') return mockAnchor
        return origCreateElement(tag)
      })

      downloadBlob(blob, 'test.txt')

      expect(mockAnchor.download).toBe('test.txt')
      expect(clickSpy).toHaveBeenCalledOnce()
      expect(URL.revokeObjectURL).toHaveBeenCalled()

      URL.createObjectURL = origCreateObjectURL
      URL.revokeObjectURL = origRevokeObjectURL
      vi.restoreAllMocks()
    })

    it('sets the correct href from createObjectURL', () => {
      const blob = new Blob(['data'], { type: 'application/octet-stream' })

      const origCreateObjectURL = URL.createObjectURL
      const origRevokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn(() => 'blob:unique-id')
      URL.revokeObjectURL = vi.fn()

      const origCreateElement = document.createElement.bind(document)
      const mockAnchor = origCreateElement('a')
      mockAnchor.click = vi.fn()
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') return mockAnchor
        return origCreateElement(tag)
      })

      downloadBlob(blob, 'art.qart')

      expect(mockAnchor.href).toContain('blob:unique-id')
      expect(mockAnchor.download).toBe('art.qart')

      URL.createObjectURL = origCreateObjectURL
      URL.revokeObjectURL = origRevokeObjectURL
      vi.restoreAllMocks()
    })
  })
})
