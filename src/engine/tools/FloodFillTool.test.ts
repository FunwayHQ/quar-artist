import { describe, it, expect } from 'vitest'
import { FloodFillTool } from './FloodFillTool.ts'

function makePixels(width: number, height: number, color: number[]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = color[0]
    pixels[i * 4 + 1] = color[1]
    pixels[i * 4 + 2] = color[2]
    pixels[i * 4 + 3] = color[3]
  }
  return pixels
}

function setPixel(pixels: Uint8Array, width: number, x: number, y: number, color: number[]) {
  const i = (y * width + x) * 4
  pixels[i] = color[0]
  pixels[i + 1] = color[1]
  pixels[i + 2] = color[2]
  pixels[i + 3] = color[3]
}

function getPixel(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
}

describe('FloodFillTool', () => {
  const tool = new FloodFillTool()
  const fillColor = { r: 1, g: 0, b: 0, a: 1 } // red

  it('fills a uniform area', () => {
    const pixels = makePixels(4, 4, [255, 255, 255, 255])
    const modified = tool.fill(0, 0, pixels, 4, 4, fillColor, 0)
    expect(modified).toBe(true)
    expect(getPixel(pixels, 4, 0, 0)).toEqual([255, 0, 0, 255])
    expect(getPixel(pixels, 4, 3, 3)).toEqual([255, 0, 0, 255])
  })

  it('does not fill past color boundaries', () => {
    const pixels = makePixels(4, 4, [255, 255, 255, 255])
    // Draw a vertical wall at x=2
    for (let y = 0; y < 4; y++) {
      setPixel(pixels, 4, 2, y, [0, 0, 0, 255])
    }
    const modified = tool.fill(0, 0, pixels, 4, 4, fillColor, 0)
    expect(modified).toBe(true)
    // Left side filled
    expect(getPixel(pixels, 4, 0, 0)).toEqual([255, 0, 0, 255])
    expect(getPixel(pixels, 4, 1, 3)).toEqual([255, 0, 0, 255])
    // Wall unchanged
    expect(getPixel(pixels, 4, 2, 0)).toEqual([0, 0, 0, 255])
    // Right side unchanged
    expect(getPixel(pixels, 4, 3, 0)).toEqual([255, 255, 255, 255])
  })

  it('respects tolerance', () => {
    const pixels = makePixels(3, 1, [100, 100, 100, 255])
    setPixel(pixels, 3, 1, 0, [110, 100, 100, 255]) // slight difference
    setPixel(pixels, 3, 2, 0, [200, 200, 200, 255]) // big difference

    // Tolerance of 10 should fill pixel 1 but not pixel 2
    tool.fill(0, 0, pixels, 3, 1, fillColor, 10)
    expect(getPixel(pixels, 3, 0, 0)).toEqual([255, 0, 0, 255])
    expect(getPixel(pixels, 3, 1, 0)).toEqual([255, 0, 0, 255])
    expect(getPixel(pixels, 3, 2, 0)).toEqual([200, 200, 200, 255])
  })

  it('respects selection mask', () => {
    const pixels = makePixels(4, 4, [255, 255, 255, 255])
    const mask = new Uint8Array(16)
    // Only allow top-left 2x2
    mask[0] = 255; mask[1] = 255; mask[4] = 255; mask[5] = 255

    tool.fill(0, 0, pixels, 4, 4, fillColor, 0, mask)
    expect(getPixel(pixels, 4, 0, 0)).toEqual([255, 0, 0, 255])
    expect(getPixel(pixels, 4, 1, 1)).toEqual([255, 0, 0, 255])
    expect(getPixel(pixels, 4, 2, 0)).toEqual([255, 255, 255, 255])
  })

  it('returns false for out-of-bounds seed', () => {
    const pixels = makePixels(4, 4, [255, 255, 255, 255])
    expect(tool.fill(-1, 0, pixels, 4, 4, fillColor, 0)).toBe(false)
    expect(tool.fill(0, -1, pixels, 4, 4, fillColor, 0)).toBe(false)
    expect(tool.fill(4, 0, pixels, 4, 4, fillColor, 0)).toBe(false)
    expect(tool.fill(0, 4, pixels, 4, 4, fillColor, 0)).toBe(false)
  })

  it('returns false when fill color matches seed color', () => {
    const pixels = makePixels(2, 2, [255, 0, 0, 255])
    const modified = tool.fill(0, 0, pixels, 2, 2, fillColor, 0)
    expect(modified).toBe(false)
  })

  it('returns false when seed is outside selection mask', () => {
    const pixels = makePixels(2, 2, [255, 255, 255, 255])
    const mask = new Uint8Array(4) // all zeros
    const modified = tool.fill(0, 0, pixels, 2, 2, fillColor, 0, mask)
    expect(modified).toBe(false)
  })
})
