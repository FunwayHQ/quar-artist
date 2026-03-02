import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TextTool } from './TextTool.ts'
import type { TextProperties } from '../../types/text.ts'

// Polyfill ImageData for jsdom
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(sw: number | Uint8ClampedArray, sh?: number, _sett?: any) {
      if (typeof sw === 'number') {
        this.width = sw
        this.height = sh!
        this.data = new Uint8ClampedArray(sw * sh! * 4)
      } else {
        this.data = sw
        this.width = sh!
        this.height = _sett
      }
    }
  }
}

const mockCtx = {
  font: '',
  fillStyle: '',
  textAlign: '' as CanvasTextAlign,
  textBaseline: '' as CanvasTextBaseline,
  fillText: vi.fn(),
  getImageData: vi.fn().mockReturnValue({
    data: new Uint8ClampedArray(100 * 100 * 4),
    width: 100,
    height: 100,
  }),
  measureText: vi.fn().mockReturnValue({ width: 50 }),
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any)
  mockCtx.fillText.mockClear()
  mockCtx.getImageData.mockClear()
  mockCtx.font = ''
  mockCtx.fillStyle = ''
})

const defaultProps: TextProperties = {
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textAlign: 'left',
  color: '#FF0000',
}

describe('TextTool', () => {
  it('rasterizes text and returns pixel data', () => {
    const tool = new TextTool()
    const result = tool.rasterize('Hello', defaultProps, 50, 50, 100, 100)

    expect(result).not.toBeNull()
    expect(result!.width).toBe(100)
    expect(result!.height).toBe(100)
    expect(result!.pixels).toBeInstanceOf(Uint8ClampedArray)
    expect(mockCtx.fillText).toHaveBeenCalledWith('Hello', 50, 50)
  })

  it('applies font family and size', () => {
    const tool = new TextTool()
    tool.rasterize('Test', defaultProps, 0, 0, 100, 100)
    expect(mockCtx.font).toBe('normal normal 48px "Arial"')
  })

  it('applies bold weight', () => {
    const tool = new TextTool()
    tool.rasterize('Test', { ...defaultProps, fontWeight: 'bold' }, 0, 0, 100, 100)
    expect(mockCtx.font).toBe('normal bold 48px "Arial"')
  })

  it('applies italic style', () => {
    const tool = new TextTool()
    tool.rasterize('Test', { ...defaultProps, fontStyle: 'italic' }, 0, 0, 100, 100)
    expect(mockCtx.font).toBe('italic normal 48px "Arial"')
  })

  it('applies color as fillStyle', () => {
    const tool = new TextTool()
    tool.rasterize('Test', { ...defaultProps, color: '#00FF00' }, 0, 0, 100, 100)
    expect(mockCtx.fillStyle).toBe('#00FF00')
  })

  it('applies text alignment', () => {
    const tool = new TextTool()
    tool.rasterize('Test', { ...defaultProps, textAlign: 'center' }, 50, 0, 100, 100)
    expect(mockCtx.textAlign).toBe('center')
  })

  it('handles multi-line text', () => {
    const tool = new TextTool()
    tool.rasterize('Line1\nLine2\nLine3', defaultProps, 10, 10, 200, 200)

    expect(mockCtx.fillText).toHaveBeenCalledTimes(3)
    expect(mockCtx.fillText).toHaveBeenCalledWith('Line1', 10, 10)
    expect(mockCtx.fillText).toHaveBeenCalledWith('Line2', 10, 10 + 48 * 1.3)
    expect(mockCtx.fillText).toHaveBeenCalledWith('Line3', 10, 10 + 2 * 48 * 1.3)
  })

  it('returns null for empty/whitespace text', () => {
    const tool = new TextTool()
    expect(tool.rasterize('', defaultProps, 0, 0, 100, 100)).toBeNull()
    expect(tool.rasterize('   ', defaultProps, 0, 0, 100, 100)).toBeNull()
  })

  it('builds correct font string', () => {
    const tool = new TextTool()
    expect(tool.buildFontString(defaultProps)).toBe('normal normal 48px "Arial"')
    expect(tool.buildFontString({ ...defaultProps, fontWeight: 'bold', fontStyle: 'italic', fontSize: 24 }))
      .toBe('italic bold 24px "Arial"')
  })

  it('getAvailableFonts returns web-safe list when no consent', async () => {
    localStorage.removeItem('quar-google-fonts-consent')
    const tool = new TextTool()
    const fonts = await tool.getAvailableFonts()
    expect(fonts.length).toBe(10)
    expect(fonts).toContain('Arial')
    expect(fonts).toContain('Courier New')
  })

  it('getAvailableFonts includes Google Fonts when consent given', async () => {
    localStorage.setItem('quar-google-fonts-consent', 'true')
    const tool = new TextTool()
    const fonts = await tool.getAvailableFonts()
    expect(fonts.length).toBeGreaterThan(10)
    expect(fonts).toContain('Roboto')
    expect(fonts).toContain('Montserrat')
    expect(fonts).toContain('Arial') // web-safe fonts still included
    localStorage.removeItem('quar-google-fonts-consent')
  })
})
