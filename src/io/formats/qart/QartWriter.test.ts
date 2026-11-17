import { describe, it, expect, vi, afterEach } from 'vitest'
import { unzipSync } from 'fflate'
import { encodeQart, type QartWriterInput } from './QartWriter.ts'
import { decodeQart } from './QartReader.ts'
import { blobSource, readZipDirectory } from './zip.ts'
import { solidLayer } from './testArchives.ts'
import { TILE_BYTES, cutTile } from '../../tiles/tileFormat.ts'
import type { LayerInfo } from '../../../types/layer.ts'
import { defaultGuides } from '../../../stores/guideStore.ts'
import { sameBytes } from '../../../test/bytes.ts'

function layer(id: string, overrides: Partial<LayerInfo> = {}): LayerInfo {
  return { id, name: `Layer ${id}`, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false, ...overrides }
}

/** A 600 × 300 document (3 × 2 tiles): an empty layer under one painted at a single pixel of tile 2, 1. */
function document(overrides: Partial<QartWriterInput> = {}): QartWriterInput {
  const painted = new Uint8Array(600 * 300 * 4)
  painted.set([200, 100, 50, 128], (290 * 600 + 590) * 4)
  return {
    name: 'Sunset',
    width: 600,
    height: 300,
    dpi: 144,
    layers: [
      { info: layer('bg'), pixels: new Uint8Array(600 * 300 * 4) },
      { info: layer('ink', { blendMode: 'multiply', opacity: 0.5 }), pixels: painted },
    ],
    activeLayerId: 'bg',
    ...overrides,
  }
}

const noThumbnail = async () => null

afterEach(() => {
  vi.useRealTimers()
})

async function entries(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

async function manifest(blob: Blob) {
  return JSON.parse(new TextDecoder().decode((await entries(blob))['manifest.json']))
}

describe('encodeQart', () => {
  it('writes the manifest first, then the thumbnail, then the tiles with paint, bottom layer first', async () => {
    const blob = await encodeQart(document(), async () => new Uint8Array([137, 80, 78, 71]))
    expect(blob.type).toBe('application/x-quar-artist')
    const names = (await readZipDirectory(blobSource(blob))).map((e) => e.name)
    expect(names).toEqual(['manifest.json', 'thumbnail.png', 'tiles/ink/2_1.raw'])
    expect((await entries(blob))['thumbnail.png']).toEqual(new Uint8Array([137, 80, 78, 71]))
  })

  it('writes the name, the layers in order, the selected layer, the guides and the canvas', async () => {
    const guides = { ...defaultGuides(600, 300), symmetryEnabled: true }
    const m = await manifest(await encodeQart(document({ guides, colorSpace: 'display-p3' }), noThumbnail))
    expect(m).toMatchObject({
      format: 'qart',
      formatVersion: 1,
      name: 'Sunset',
      canvas: { width: 600, height: 300, dpi: 144, colorSpace: 'display-p3' },
      activeLayerId: 'bg',
      thumbnail: null,
      timelapse: null,
    })
    expect(m.layers.map((l: { id: string; name: string; blendMode: string; opacity: number }) => [l.id, l.name, l.blendMode, l.opacity])).toEqual([
      ['bg', 'Layer bg', 'normal', 1],
      ['ink', 'Layer ink', 'multiply', 0.5],
    ])
    expect(m.guides).toEqual(guides)
  })

  it('stores tiles premultiplied, with zeros past the canvas', async () => {
    const tile = (await entries(await encodeQart(document(), noThumbnail)))['tiles/ink/2_1.raw']
    expect(tile).toHaveLength(TILE_BYTES)
    // The pixel at 590, 290 is at 78, 34 in tile 2, 1.
    const at = (34 * 256 + 78) * 4
    expect([...tile.subarray(at, at + 4)]).toEqual([100, 50, 25, 128])
    expect(tile.reduce((n, b) => n + (b ? 1 : 0), 0)).toBe(4)
  })

  it('gives fresh ids to layers whose id repeats or names no folder, and keeps the selected one', async () => {
    const pixels = () => solidLayer(600, 300, [9, 9, 9, 255])
    const input = document({
      layers: [
        { info: layer('a'), pixels: pixels() },
        { info: layer('a', { name: 'Again' }), pixels: pixels() },
        { info: layer('../up', { name: 'Odd' }), pixels: pixels() },
        { info: layer('layer-1', { name: 'Taken' }), pixels: pixels() },
      ],
      activeLayerId: 'a',
    })
    const blob = await encodeQart(input, noThumbnail)
    const m = await manifest(blob)
    expect(m.layers.map((l: { id: string }) => l.id)).toEqual(['a', 'layer-2', 'layer-3', 'layer-1'])
    expect(m.activeLayerId).toBe('a')
    const read = await decodeQart(blob)
    expect(read.layers.map((l) => l.info.name)).toEqual(['Layer a', 'Again', 'Odd', 'Taken'])
  })

  it('brings what the reader would refuse into range', async () => {
    const input = document({ dpi: 0 })
    input.layers[1].info = layer('ink', { opacity: 7, blendMode: 'glow' as never })
    const blob = await encodeQart({ ...input, activeLayerId: 'none' }, noThumbnail)
    const m = await manifest(blob)
    expect(m.canvas.dpi).toBe(1)
    expect(m.layers[1]).toMatchObject({ opacity: 1, blendMode: 'normal' })
    expect(m.activeLayerId).toBe('ink')
    await expect(decodeQart(blob)).resolves.toMatchObject({ dpi: 1 })
  })

  it('writes tiles any ZIP reader can unpack, which fflate\'s streaming Deflate got wrong for this layer', async () => {
    const ink = new Uint8Array(300 * 200 * 4)
    for (let i = 0; i < ink.length; i += 4) {
      const n = i / 4
      if (n % 7 === 0) ink.set([(n * 13) % 256, (n * 29) % 256, (n * 7) % 256, (n * 31) % 256], i)
    }
    const blob = await encodeQart({ ...document(), width: 300, height: 200, layers: [{ info: layer('ink'), pixels: ink }], activeLayerId: 'ink' }, noThumbnail)
    const unzipped = await entries(blob)
    expect(sameBytes(unzipped['tiles/ink/0_0.raw'], cutTile(ink, 300, 200, 0, 0))).toBe(true)
    expect(sameBytes(unzipped['tiles/ink/1_0.raw'], cutTile(ink, 300, 200, 1, 0))).toBe(true)
  })

  it('compresses, so a few strokes take next to nothing', async () => {
    const pixels = new Uint8Array(512 * 512 * 4)
    for (let x = 100; x < 400; x++) pixels.set([255, 0, 0, 255], (200 * 512 + x) * 4)
    const blob = await encodeQart({ ...document(), width: 512, height: 512, layers: [{ info: layer('a'), pixels }] }, noThumbnail)
    expect(blob.size).toBeLessThan(4000)
  })

  it('writes the file without a thumbnail when making one fails', async () => {
    const thrown = await encodeQart(document(), () => {
      throw new Error('no canvas')
    })
    expect((await manifest(thrown)).thumbnail).toBeNull()
    const rejected = await encodeQart(document(), async () => {
      throw new Error('no canvas')
    })
    expect(Object.keys(await entries(rejected))).not.toContain('thumbnail.png')
    expect((await manifest(rejected)).thumbnail).toBeNull()
  })

  it('cuts names to 256 characters, so no name can make the manifest too large to read (review of M1.6)', async () => {
    const input = document({ name: 'n'.repeat(300) })
    input.layers[0].info = layer('bg', { name: 'x'.repeat(1_100_000) })
    // A character of two UTF-16 units across the cut is left out whole.
    input.layers[1].info = layer('ink', { name: `${'a'.repeat(255)}😀` })

    const blob = await encodeQart(input, noThumbnail)

    const m = await manifest(blob)
    expect(m.name).toBe('n'.repeat(256))
    expect(m.layers.map((l: { name: string }) => l.name.length)).toEqual([256, 255])
    const read = await decodeQart(blob)
    expect(read.layers.map((l) => l.info.name)).toEqual(['x'.repeat(256), 'a'.repeat(255)])
  })

  it('writes no thumbnail where none can be drawn', async () => {
    const blob = await encodeQart(document())
    expect(Object.keys(await entries(blob))).not.toContain('thumbnail.png')
    expect((await manifest(blob)).thumbnail).toBeNull()
  })

  it('refuses no layers, layers of the wrong size, and sizes the format can not hold', async () => {
    await expect(encodeQart(document({ layers: [] }), noThumbnail)).rejects.toThrow('there are no layers to save')
    const wrong = document()
    wrong.layers[0].pixels = new Uint8Array(16)
    await expect(encodeQart(wrong, noThumbnail)).rejects.toThrow("the layer “Layer bg” isn't the canvas's size")
    await expect(encodeQart(document({ width: 20000 }), noThumbnail)).rejects.toThrow("a canvas of 20000 × 300 px can't be saved as a .qart file")
  })
})
