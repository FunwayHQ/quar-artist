import { describe, it, expect } from 'vitest'
import { contentBounds, encodePsd, PSD_MIME, type PsdWriterInput } from './PsdWriter.ts'
import { readPsd } from './agPsd.ts'
import { ALL_BLEND_MODES, type LayerInfo } from '../../../types/layer.ts'
import { quarToPsdBlendMode } from './blendModeMap.ts'
import { sameBytes } from '../../../test/bytes.ts'

function info(id: string, props: Partial<LayerInfo> = {}): LayerInfo {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false, ...props }
}

/** A layer of `width` × `height` with one colour inside `rect` and nothing elsewhere. */
function painted(width: number, height: number, color: [number, number, number, number], rect = { x: 0, y: 0, w: width, h: height }) {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) pixels.set(color, (y * width + x) * 4)
  return pixels
}

function input(props: Partial<PsdWriterInput> = {}): PsdWriterInput {
  return {
    width: 8,
    height: 6,
    dpi: 300,
    layers: [
      { info: info('paper'), pixels: painted(8, 6, [250, 240, 230, 255]) },
      { info: info('ink', { opacity: 0.5, blendMode: 'multiply' }), pixels: painted(8, 6, [10, 20, 30, 128], { x: 2, y: 1, w: 3, h: 4 }) },
    ],
    activeLayerId: 'ink',
    composite: painted(8, 6, [130, 131, 132, 255]),
    ...props,
  }
}

async function read(blob: Blob) {
  return readPsd(new Uint8Array(await blob.arrayBuffer()), { useImageData: true, skipThumbnail: true })
}

describe('contentBounds', () => {
  it('finds the smallest rectangle around what is painted, or nothing', () => {
    expect(contentBounds(new Uint8Array(4 * 4 * 4), 4, 4)).toBeNull()
    expect(contentBounds(painted(4, 4, [0, 0, 0, 1], { x: 2, y: 1, w: 1, h: 1 }), 4, 4)).toEqual({ left: 2, top: 1, right: 3, bottom: 2 })
    expect(contentBounds(painted(5, 3, [9, 9, 9, 255]), 5, 3)).toEqual({ left: 0, top: 0, right: 5, bottom: 3 })
  })
})

describe('encodePsd (plan M1.7)', () => {
  it('writes a PSD file', async () => {
    const blob = encodePsd(input())
    expect(blob.type).toBe(PSD_MIME)
    expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).subarray(0, 4))).toBe('8BPS')
  })

  it('writes opacity from 0 to 1, as ag-psd takes it, not 0 to 255 (F09)', async () => {
    const psd = await read(encodePsd(input()))
    expect(psd.children![0].opacity).toBe(1)
    expect(psd.children![1].opacity).toBeCloseTo(0.5, 2)
  })

  it('writes the composite the app shows, not a black one (F09)', async () => {
    const doc = input()
    const psd = await read(encodePsd(doc))
    expect(sameBytes(psd.imageData!.data, painted(8, 6, [130, 131, 132, 255]))).toBe(true)
  })

  it('keeps visibility, clipping, alpha lock, locks and the resolution (F09)', async () => {
    const doc = input({
      layers: [
        { info: info('base', { alphaLock: true }), pixels: painted(8, 6, [1, 2, 3, 255]) },
        { info: info('clip', { clippingMask: true, visible: false }), pixels: painted(8, 6, [4, 5, 6, 255]) },
        { info: info('locked', { locked: true }), pixels: painted(8, 6, [7, 8, 9, 255]) },
      ],
      activeLayerId: 'clip',
      dpi: 144,
    })
    const psd = await read(encodePsd(doc))
    const [base, clip, locked] = psd.children!
    expect(base).toMatchObject({ clipping: false, hidden: false, protected: { transparency: true, composite: false, position: false } })
    expect(clip).toMatchObject({ clipping: true, hidden: true, protected: { transparency: false, composite: false, position: false } })
    expect(locked).toMatchObject({ protected: { transparency: false, composite: true, position: true } })
    expect(psd.imageResources?.resolutionInfo).toMatchObject({ horizontalResolution: 144, verticalResolution: 144, horizontalResolutionUnit: 'PPI' })
    // The selected layer, as Photoshop keeps it.
    expect(psd.imageResources?.layerSelectionIds).toEqual([clip.id])
  })

  it('writes each blend mode as Photoshop names it', async () => {
    const doc = input({
      layers: ALL_BLEND_MODES.map((blendMode) => ({ info: info(blendMode, { blendMode }), pixels: painted(8, 6, [0, 0, 0, 255]) })),
    })
    const psd = await read(encodePsd(doc))
    expect(psd.children!.map((l) => l.blendMode)).toEqual(ALL_BLEND_MODES.map(quarToPsdBlendMode))
  })

  it("keeps each layer's pixels exactly, where it has them: an empty layer takes no room", async () => {
    const doc = input({
      layers: [
        { info: info('empty'), pixels: new Uint8Array(8 * 6 * 4) },
        { info: info('ink'), pixels: painted(8, 6, [10, 20, 30, 77], { x: 2, y: 1, w: 3, h: 4 }) },
      ],
    })
    const psd = await read(encodePsd(doc))
    const [empty, ink] = psd.children!
    expect([empty.left ?? 0, empty.top ?? 0, empty.right ?? 0, empty.bottom ?? 0]).toEqual([0, 0, 0, 0])
    expect([ink.left, ink.top, ink.right, ink.bottom]).toEqual([2, 1, 5, 5])
    // Straight alpha, as PSD files keep it: the semi-transparent colour as it was.
    expect(Array.from(ink.imageData!.data.slice(0, 4))).toEqual([10, 20, 30, 77])
  })

  it('writes the composite of a document 1 or 2 px wide whole, which ag-psd cuts short', async () => {
    for (const width of [1, 2]) {
      const composite = new Uint8Array([200, 0, 100, 128, 0, 50, 250, 255, 9, 9, 9, 0, 40, 30, 20, 255].slice(0, width * 2 * 4))
      const file = encodePsd(input({ width, height: 2, layers: [{ info: info('a'), pixels: composite.slice() }], composite }))
      // Read strictly: a composite that ends early is an error, not zeros.
      const psd = readPsd(new Uint8Array(await file.arrayBuffer()), { useImageData: true, skipThumbnail: true, strict: true })
      // Within a level, for the white matte of the half-transparent pixel; a transparent one keeps no colour.
      const read = Array.from(psd.imageData!.data, (v, i) => (composite[i | 3] === 0 && (i & 3) !== 3 ? 0 : v))
      const expected = Array.from(composite, (v, i) => (composite[i | 3] === 0 && (i & 3) !== 3 ? 0 : v))
      expect(read.map((v, i) => (Math.abs(v - expected[i]) <= 1 ? expected[i] : v))).toEqual(expected)
    }
  })

  it('refuses to write a file larger than a PSD file holds, saying so', () => {
    expect(() => encodePsd(input(), 100)).toThrow('it would be over 2 GB, more than a PSD file holds. Save it as a .qart file instead, or merge some layers')
    expect(encodePsd(input()).size).toBeGreaterThan(100)
  })

  it('cuts names to 256 characters', async () => {
    const psd = await read(encodePsd(input({ layers: [{ info: info('long', { name: 'n'.repeat(300) }), pixels: painted(8, 6, [0, 0, 0, 255]) }] })))
    expect(psd.children![0].name).toBe('n'.repeat(256))
  })
})
