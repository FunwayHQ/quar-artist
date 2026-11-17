import { describe, it, expect } from 'vitest'
import { deflateSync } from 'fflate'
import { decodeQart, MAX_DOCUMENT_BYTES, type QartDocument } from './QartReader.ts'
import { encodeQart, type QartWriterInput } from './QartWriter.ts'
import { entry, manifestOf, qartArchive, rawZip, solidLayer, solidTile, text, tileEntry } from './testArchives.ts'
import { TILE_BYTES } from '../../tiles/tileFormat.ts'
import { premultiply } from '../../../utils/alpha.ts'
import type { LayerInfo } from '../../../types/layer.ts'
import { sameBytes } from '../../../test/bytes.ts'

function layer(id: string, overrides: Partial<LayerInfo> = {}): LayerInfo {
  return { id, name: `Layer ${id}`, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false, ...overrides }
}

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>])
const noThumbnail = async () => null

async function refusal(bytes: Uint8Array, limits = {}): Promise<string> {
  try {
    await decodeQart(blob(bytes), limits)
  } catch (err) {
    expect((err as Error).name).toBe('QartError')
    return (err as Error).message
  }
  throw new Error('the file was read')
}

/** A 300 × 200 document whose layers have every kind of pixel: opaque, see-through and empty. */
function painting(): QartWriterInput {
  const sky = solidLayer(300, 200, [40, 90, 200, 255])
  const ink = new Uint8Array(300 * 200 * 4)
  for (let i = 0; i < ink.length; i += 4) {
    const n = i / 4
    if (n % 7 === 0) ink.set([(n * 13) % 256, (n * 29) % 256, (n * 7) % 256, (n * 31) % 256], i)
  }
  return {
    name: 'Painting',
    width: 300,
    height: 200,
    dpi: 300,
    colorSpace: 'display-p3',
    layers: [
      { info: layer('sky'), pixels: sky },
      { info: layer('empty', { visible: false }), pixels: new Uint8Array(300 * 200 * 4) },
      { info: layer('ink', { blendMode: 'screen', opacity: 0.25, alphaLock: true, clippingMask: true, locked: true }), pixels: ink },
    ],
    activeLayerId: 'empty',
    guides: { gridEnabled: true } as never,
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T12:00:00.000Z',
  }
}

describe('decodeQart', () => {
  it('reads back what the writer wrote: every layer, its pixels and properties, and the document', async () => {
    const input = painting()
    const originals = input.layers.map((l) => l.pixels.slice())
    const doc = await decodeQart(await encodeQart(input, noThumbnail))
    expect(doc).toMatchObject({
      formatVersion: 1,
      name: 'Painting',
      width: 300,
      height: 200,
      dpi: 300,
      colorSpace: 'display-p3',
      activeLayerId: 'empty',
      guides: { gridEnabled: true },
      createdAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T12:00:00.000Z',
      unreadableTiles: 0,
    } satisfies Partial<QartDocument>)
    expect(doc.layers.map((l) => l.info)).toEqual(input.layers.map((l) => ({ ...l.info })))
    // Opaque and empty pixels come back as they were; see-through ones as the GPU holds them, premultiplied.
    expect(sameBytes(doc.layers[0].pixels, originals[0])).toBe(true)
    expect(sameBytes(doc.layers[1].pixels, originals[1])).toBe(true)
    expect(sameBytes(premultiply(doc.layers[2].pixels), premultiply(originals[2]))).toBe(true)
  })

  it('skips entries it does not know, and folders', async () => {
    const pixels = solidLayer(64, 64, [255, 0, 0, 255])
    const bytes = qartArchive(manifestOf({ width: 64, height: 64, layerIds: ['red'] }), [
      entry('tiles/', new Uint8Array(0)),
      entry('tiles/red/', new Uint8Array(0)),
      tileEntry('red', pixels, 64, 64, 0, 0),
      entry('timelapse.webm', new Uint8Array(5000).fill(3)),
      entry('notes/readme.txt', text('hello')),
    ])
    const doc = await decodeQart(blob(bytes))
    expect(sameBytes(doc.layers[0].pixels, pixels)).toBe(true)
  })

  it('reads the draft layout written before version 1: whole layers, straight alpha, in their order', async () => {
    const top = solidLayer(4, 2, [10, 20, 30, 40])
    const bottom = solidLayer(4, 2, [1, 2, 3, 255])
    const manifest = {
      version: '1.0',
      app: 'quar-artist',
      canvas: { width: 4, height: 2, dpi: 300, colorSpace: 'srgb' },
      layers: [
        { id: 't', name: 'Top', blendMode: 'overlay', opacity: 0.5, visible: true, locked: false, alphaLock: false, clippingMask: false, order: 1, dataFile: 'layers/t.bin' },
        { id: 'b', name: 'Bottom', blendMode: 'normal', opacity: 1, visible: true, order: 0, dataFile: 'layers/b.bin' },
      ],
      activeLayerId: 't',
      createdAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T10:00:00.000Z',
    }
    const bytes = rawZip([entry('layers/t.bin', top), entry('layers/b.bin', bottom), entry('manifest.json', text(JSON.stringify(manifest)))])
    const doc = await decodeQart(blob(bytes))
    expect(doc).toMatchObject({ formatVersion: 0, name: null, width: 4, height: 2, dpi: 300, activeLayerId: 't', unreadableTiles: 0 })
    expect(doc.layers.map((l) => [l.info.name, l.info.blendMode])).toEqual([['Bottom', 'normal'], ['Top', 'overlay']])
    // Straight alpha, exactly as written.
    expect(doc.layers[1].pixels).toEqual(top)
    expect(doc.layers[0].pixels).toEqual(bottom)
  })

  it("refuses a file larger than the device opens, or with more layers than the app, before reading its pixels", async () => {
    const big = qartArchive(manifestOf({ width: 9000, height: 100, layerIds: ['a'] }), [solidTile('a', 0, 0, 255, { crc: 1 })])
    expect(await refusal(big, { maxSide: 8192 })).toBe('it is 9000 × 100 px. This device supports canvases up to 8192 × 8192 px')
    const many = qartArchive(manifestOf({ width: 10, height: 10, layerIds: ['a', 'b', 'c'] }))
    expect(await refusal(many, { maxLayers: 2 })).toBe('it has 3 layers, and QUAR Artist opens up to 2')
    const huge = qartArchive(manifestOf({ width: 16384, height: 16384, layerIds: ['a', 'b', 'c', 'd', 'e'] }))
    expect(5 * 16384 * 16384 * 4).toBeGreaterThan(MAX_DOCUMENT_BYTES)
    expect(await refusal(huge)).toBe('it is too large to open on this device')
  })

  it('refuses a document whose layers would take more memory than it may, and opens one that needs no more', async () => {
    // Two layers of 64 × 64: 32,768 bytes.
    const file = qartArchive(manifestOf({ width: 64, height: 64, layerIds: ['a', 'b'] }))
    expect(await refusal(file, { maxBytes: 32_767 })).toBe('it is too large to open on this device')
    await expect(decodeQart(blob(file), { maxBytes: 32_768 })).resolves.toMatchObject({ width: 64, height: 64 })
  })

  it("refuses what isn't a .qart file", async () => {
    expect(await refusal(text('not a zip at all, but long enough to look for one'))).toBe("it isn't a .qart file")
    expect(await refusal(rawZip([entry('readme.txt', text('hi'))]))).toBe("it isn't a .qart file")
  })

  it("refuses a manifest that is too large, or isn't JSON", async () => {
    const tooLarge = rawZip([entry('manifest.json', new Uint8Array((1 << 20) + 1).fill(32))])
    expect(await refusal(tooLarge)).toBe('it is damaged (its manifest is too large)')
    expect(await refusal(rawZip([entry('manifest.json', text('{"format":'))]))).toBe("it is damaged (its manifest isn't valid JSON)")
    expect(await refusal(rawZip([entry('manifest.json', new Uint8Array([0x7b, 0xff, 0x7d]))]))).toBe("it is damaged (its manifest isn't valid JSON)")
  })

  it('refuses tiles of no layer, outside the canvas, of the wrong size, or not named as tiles', async () => {
    const m = manifestOf({ width: 300, height: 200, layerIds: ['a'] })
    expect(await refusal(qartArchive(m, [solidTile('b', 0, 0)]))).toBe('it is damaged (“tiles/b/0_0.raw” belongs to none of its layers)')
    expect(await refusal(qartArchive(m, [solidTile('a', 2, 0)]))).toBe('it is damaged (“tiles/a/2_0.raw” is outside the canvas)')
    expect(await refusal(qartArchive(m, [solidTile('a', 0, 1)]))).toBe('it is damaged (“tiles/a/0_1.raw” is outside the canvas)')
    expect(await refusal(qartArchive(m, [entry('tiles/a/0_0.raw', new Uint8Array(1000))]))).toBe(
      'it is damaged (“tiles/a/0_0.raw” has the wrong size)',
    )
    for (const name of ['tiles/a/00_0.raw', 'tiles/a/0_0.lz4', 'tiles/a/0-0.raw', 'tiles/a/b/0_0.raw', 'tiles/a/-1_0.raw']) {
      expect(await refusal(qartArchive(m, [entry(name, new Uint8Array(TILE_BYTES))]))).toBe(`it is damaged (“${name}” isn't a tile)`)
    }
  })

  it('refuses a tile that unpacks to more than it says, without unpacking it all', async () => {
    const bomb = entry('tiles/a/0_0.raw', new Uint8Array(0), { data: deflateSync(new Uint8Array(64 << 20)), size: TILE_BYTES, crc: 0 })
    expect(await refusal(qartArchive(manifestOf({ width: 256, height: 256, layerIds: ['a'] }), [bomb]))).toBe(
      'it is damaged (“tiles/a/0_0.raw” unpacks to more than it says)',
    )
    // Making a 64 MiB bomb takes a while on a busy machine.
  }, 30_000)

  it('opens a file with damaged tiles, those transparent, and counts them', async () => {
    const m = manifestOf({ width: 512, height: 256, layerIds: ['a'] })
    const good = solidTile('a', 0, 0, 200)
    const wrongChecksum = solidTile('a', 1, 0, 200, { crc: 12345 })
    const doc = await decodeQart(blob(qartArchive(m, [good, wrongChecksum])))
    expect(doc.unreadableTiles).toBe(1)
    const pixels = doc.layers[0].pixels
    expect(pixels[(0 * 512 + 10) * 4 + 3]).toBe(200)
    expect(pixels[(0 * 512 + 300) * 4 + 3]).toBe(0)

    const cutShort = entry('tiles/a/1_0.raw', new Uint8Array(0), {
      data: deflateSync(new Uint8Array(TILE_BYTES).fill(7)).subarray(0, 20),
      size: TILE_BYTES,
    })
    expect((await decodeQart(blob(qartArchive(m, [good, cutShort])))).unreadableTiles).toBe(1)
  })

  it("opens a draft file whose layer is damaged with that layer transparent", async () => {
    const manifest = {
      version: '1.0',
      app: 'quar-artist',
      canvas: { width: 300, height: 10, dpi: 72 },
      layers: [{ id: 'a', name: 'A', blendMode: 'normal', opacity: 1, visible: true, order: 0, dataFile: 'layers/a.bin' }],
      activeLayerId: 'a',
    }
    const layerEntry = entry('layers/a.bin', solidLayer(300, 10, [1, 1, 1, 255]), { crc: 1 })
    const doc = await decodeQart(blob(rawZip([entry('manifest.json', text(JSON.stringify(manifest))), layerEntry])))
    expect(doc.unreadableTiles).toBe(2)
    expect(doc.layers[0].pixels.every((b) => b === 0)).toBe(true)
  })

  it('refuses a draft layer that has no entry, or one of the wrong size', async () => {
    const manifest = (dataFile: string) => ({
      version: '1.0',
      app: 'quar-artist',
      canvas: { width: 2, height: 2, dpi: 72 },
      layers: [{ id: 'a', name: 'A', blendMode: 'normal', opacity: 1, visible: true, order: 0, dataFile }],
      activeLayerId: 'a',
    })
    const draft = (dataFile: string, entries: ReturnType<typeof entry>[]) => rawZip([entry('manifest.json', text(JSON.stringify(manifest(dataFile)))), ...entries])
    expect(await refusal(draft('layers/a.bin', []))).toBe('it is damaged (the layer “A” has no pixels)')
    expect(await refusal(draft('layers/a.bin', [entry('layers/a.bin', new Uint8Array(15))]))).toBe('it is damaged (the layer “A” has the wrong size)')
  })
})
