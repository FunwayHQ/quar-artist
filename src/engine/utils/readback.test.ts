import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => ({ RendererType: { WEBGL: 1, WEBGPU: 2, CANVAS: 4 } }))

import { readPixels, unpremultiply } from './readback.ts'

describe('unpremultiply', () => {
  it('restores straight colour from premultiplied pixels', () => {
    // 50% red, 25% blue and fully opaque green, stored premultiplied
    const data = new Uint8ClampedArray([128, 0, 0, 128, 0, 0, 64, 64, 0, 200, 0, 255])
    unpremultiply(data)
    expect([...data]).toEqual([255, 0, 0, 128, 0, 0, 255, 64, 0, 200, 0, 255])
  })

  it('clears the colour of fully transparent pixels', () => {
    const data = new Uint8ClampedArray([12, 34, 56, 0])
    unpremultiply(data)
    expect([...data]).toEqual([0, 0, 0, 0])
  })

  it('round-trips a semi-transparent colour to within 1 per channel', () => {
    const straight = [40, 60, 220]
    const alpha = 128
    const data = new Uint8ClampedArray([...straight.map((c) => Math.round((c * alpha) / 255)), alpha])
    unpremultiply(data)
    for (let i = 0; i < 3; i++) expect(Math.abs(data[i] - straight[i])).toBeLessThanOrEqual(1)
  })
})

describe('readPixels', () => {
  const fakeRenderer = (type: number, pixels: number[]) => ({
    type,
    extract: { pixels: vi.fn(() => ({ pixels: new Uint8ClampedArray(pixels), width: 1, height: 1 })) },
  })

  it('returns straight alpha from WebGL, whose readback is premultiplied', () => {
    const renderer = fakeRenderer(1, [128, 0, 0, 128])
    const result = readPixels(renderer as never, {} as never)
    expect([...result.pixels]).toEqual([255, 0, 0, 128])
    expect(result).toMatchObject({ width: 1, height: 1 })
  })

  it('leaves WebGPU readback alone, which is already straight', () => {
    const renderer = fakeRenderer(2, [255, 0, 0, 128])
    expect([...readPixels(renderer as never, {} as never).pixels]).toEqual([255, 0, 0, 128])
  })
})
