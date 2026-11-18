import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAX_PSD_FILE_BYTES, decodePsd, type PsdDocument, type PsdLimits } from './PsdReader.ts'
import { encodePsd, type PsdWriterInput } from './PsdWriter.ts'
import { writePsdUint8Array, type Layer, type Psd } from './agPsd.ts'
import { rawPsd, samples, zipChannel } from './testPsds.ts'
import { ALL_BLEND_MODES, type LayerInfo } from '../../../types/layer.ts'
import { sameBytes } from '../../../test/bytes.ts'

type RGBA = [number, number, number, number]

function info(id: string, props: Partial<LayerInfo> = {}): LayerInfo {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false, ...props }
}

function painted(width: number, height: number, color: RGBA, rect = { x: 0, y: 0, w: width, h: height }) {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) pixels.set(color, (y * width + x) * 4)
  return pixels
}

function image(width: number, height: number, color: RGBA) {
  return { width, height, data: new Uint8ClampedArray(painted(width, height, color)) }
}

/** A PSD file as ag-psd writes it, for structures the app doesn't write: groups, masks, effects. */
function psdFile(psd: Psd): Blob {
  return new Blob([writePsdUint8Array(psd, { noBackground: true }) as Uint8Array<ArrayBuffer>])
}

/** A PSD file saved by Photoshop, from the fidelity files. Tests run from the project's folder. */
function photoshopFile(name: string): Blob {
  return new Blob([readFileSync(`e2e/fixtures/psd/${name}.psd`)])
}

/** Each layer's pixels at the points given, with each value within a level of the one expected taken as it. */
function at(doc: PsdDocument, points: readonly [number, number][], expected: readonly number[][][]): number[][][] {
  return doc.layers.map((layer, l) =>
    points.map(([x, y], i) => pixel(layer.pixels, doc.width, x, y).map((v, c) => (Math.abs(v - expected[l][i][c]) <= 1 ? expected[l][i][c] : v))),
  )
}

function pixel(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  return Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
}

async function refusal(file: Blob, limits?: PsdLimits): Promise<string> {
  const err = await decodePsd(file, limits).then(
    () => null,
    (e: Error) => e,
  )
  if (!err) return 'opened'
  expect(err.name).toBe('PsdError')
  return err.message
}

describe('decodePsd (plan M1.7)', () => {
  it('reads what the app writes, as it was: pixels, names, blend modes, opacity, flags, resolution, selection', async () => {
    const layers: PsdWriterInput['layers'] = [
      { info: info('paper', { alphaLock: true }), pixels: painted(8, 6, [250, 240, 230, 255]) },
      { info: info('ink', { blendMode: 'multiply', opacity: 0.4, clippingMask: true }), pixels: painted(8, 6, [10, 20, 30, 77], { x: 2, y: 1, w: 3, h: 4 }) },
      { info: info('hidden', { visible: false, locked: true }), pixels: painted(8, 6, [1, 2, 3, 4]) },
      { info: info('empty'), pixels: new Uint8Array(8 * 6 * 4) },
    ]
    const file = encodePsd({ width: 8, height: 6, dpi: 300, layers: layers.map((l) => ({ ...l, pixels: l.pixels.slice() })), activeLayerId: 'ink', composite: painted(8, 6, [0, 0, 0, 255]) })

    const doc = await decodePsd(file)

    expect(doc).toMatchObject({ width: 8, height: 6, dpi: 300, activeLayer: 1 })
    expect(doc.notes).toEqual({ groups: 0, adjustments: 0, effects: 0, vectorMasks: 0, groupMasks: 0, blendModes: [] })
    const props = doc.layers.map(({ name, blendMode, opacity, visible, locked, alphaLock, clippingMask }) => ({
      name,
      blendMode,
      opacity: Math.round(opacity * 100) / 100,
      visible,
      locked,
      alphaLock,
      clippingMask,
    }))
    expect(props).toEqual([
      { name: 'paper', blendMode: 'normal', opacity: 1, visible: true, locked: false, alphaLock: true, clippingMask: false },
      { name: 'ink', blendMode: 'multiply', opacity: 0.4, visible: true, locked: false, alphaLock: false, clippingMask: true },
      { name: 'hidden', blendMode: 'normal', opacity: 1, visible: false, locked: true, alphaLock: false, clippingMask: false },
      { name: 'empty', blendMode: 'normal', opacity: 1, visible: true, locked: false, alphaLock: false, clippingMask: false },
    ])
    layers.forEach((l, i) => expect(sameBytes(doc.layers[i].pixels, l.pixels), l.info.name).toBe(true))
  })

  it('reads every blend mode the app has', async () => {
    const layers = ALL_BLEND_MODES.map((blendMode) => ({ info: info(blendMode, { blendMode }), pixels: painted(2, 2, [9, 9, 9, 255]) }))
    const doc = await decodePsd(encodePsd({ width: 2, height: 2, dpi: 72, layers, activeLayerId: 'normal', composite: painted(2, 2, [0, 0, 0, 255]) }))
    expect(doc.layers.map((l) => l.blendMode)).toEqual(ALL_BLEND_MODES)
  })

  it("puts each layer where it is in the document, and cuts what lies outside the canvas", async () => {
    const file = psdFile({
      width: 4,
      height: 4,
      children: [{ name: 'moved', left: -2, top: 1, right: 6, bottom: 7, imageData: image(8, 6, [200, 100, 50, 255]) }],
    })
    const doc = await decodePsd(file)
    const pixels = doc.layers[0].pixels
    expect(pixels.length).toBe(4 * 4 * 4)
    expect(pixel(pixels, 4, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(pixels, 4, 0, 1)).toEqual([200, 100, 50, 255])
    expect(pixel(pixels, 4, 3, 3)).toEqual([200, 100, 50, 255])
  })

  it("flattens groups, which the app doesn't have yet: their layers hide and fade with them, and they are counted", async () => {
    const file = psdFile({
      width: 2,
      height: 2,
      children: [
        { name: 'bottom', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [1, 1, 1, 255]) },
        {
          name: 'Outer',
          opened: true,
          opacity: 0.5,
          children: [
            { name: 'inside', left: 0, top: 0, right: 2, bottom: 2, opacity: 0.5, imageData: image(2, 2, [2, 2, 2, 255]) },
            { name: 'Hidden group', opened: true, hidden: true, children: [{ name: 'deep', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [3, 3, 3, 255]) }] },
          ],
        },
        { name: 'top', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [4, 4, 4, 255]) },
      ],
    })
    const doc = await decodePsd(file)
    expect(doc.layers.map((l) => [l.name, Math.round(l.opacity * 100) / 100, l.visible])).toEqual([
      ['bottom', 1, true],
      ['inside', 0.25, true],
      ['deep', 0.5, false],
      ['top', 1, true],
    ])
    expect(doc.notes.groups).toBe(2)
  })

  it("leaves out what the app can't show, and counts it: adjustment layers, effects, blend modes it doesn't have", async () => {
    const file = psdFile({
      width: 2,
      height: 2,
      children: [
        { name: 'base', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [100, 100, 100, 255]) },
        { name: 'Invert', adjustment: { type: 'invert' } },
        {
          name: 'shadowed',
          left: 0,
          top: 0,
          right: 2,
          bottom: 2,
          imageData: image(2, 2, [5, 5, 5, 255]),
          effects: { dropShadow: [{ enabled: true, color: { r: 0, g: 0, b: 0 }, opacity: 0.5, blendMode: 'multiply' }] },
        },
        { name: 'switched off', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [6, 6, 6, 255]), effects: { dropShadow: [{ enabled: false }] } },
        { name: 'burnt', blendMode: 'linear burn', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [7, 7, 7, 255]) },
      ],
    })
    const doc = await decodePsd(file)
    expect(doc.layers.map((l) => `${l.name}:${l.blendMode}`)).toEqual(['base:normal', 'shadowed:normal', 'switched off:normal', 'burnt:normal'])
    expect(doc.notes).toEqual({ groups: 0, adjustments: 1, effects: 1, vectorMasks: 0, groupMasks: 0, blendModes: ['linear burn'] })
  })

  it("gives a Normal layer its Normal Color Overlay's colour, and leaves the effect out of other layers", async () => {
    const overlay = (opacity: number): Layer['effects'] => ({ solidFill: [{ enabled: true, blendMode: 'normal', color: { r: 200, g: 0, b: 100 }, opacity }] })
    const file = psdFile({
      width: 2,
      height: 2,
      children: [
        { name: 'recoloured', left: 0, top: 0, right: 2, bottom: 1, imageData: image(2, 1, [0, 100, 0, 128]), effects: overlay(1) },
        { name: 'half', left: 0, top: 1, right: 2, bottom: 2, imageData: image(2, 1, [0, 100, 0, 255]), effects: overlay(0.5) },
        { name: 'multiplied', blendMode: 'multiply', left: 0, top: 0, right: 2, bottom: 2, imageData: image(2, 2, [0, 100, 0, 255]), effects: overlay(1) },
      ],
    })
    const doc = await decodePsd(file)
    // Its alpha stays: the overlay colours what is there.
    expect(pixel(doc.layers[0].pixels, 2, 0, 0)).toEqual([200, 0, 100, 128])
    expect(pixel(doc.layers[0].pixels, 2, 0, 1)).toEqual([0, 0, 0, 0])
    expect(pixel(doc.layers[1].pixels, 2, 0, 1)).toEqual([100, 50, 50, 255])
    expect(pixel(doc.layers[2].pixels, 2, 0, 0)).toEqual([0, 100, 0, 255])
    expect(doc.notes.effects).toBe(1)
  })

  it("applies a layer's mask to its pixels: black hides, white shows, and outside it the mask's own colour", async () => {
    const mask = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255]) }
    const file = psdFile({
      width: 3,
      height: 2,
      children: [
        // Hidden outside the mask's rectangle.
        { name: 'masked', left: 0, top: 0, right: 3, bottom: 2, imageData: image(3, 2, [50, 60, 70, 200]), mask: { left: 1, top: 0, right: 3, bottom: 1, defaultColor: 0, imageData: mask } },
        // Shown outside it.
        { name: 'white outside', left: 0, top: 0, right: 3, bottom: 2, imageData: image(3, 2, [50, 60, 70, 200]), mask: { left: 1, top: 0, right: 3, bottom: 1, defaultColor: 255, imageData: mask } },
        { name: 'switched off', left: 0, top: 0, right: 3, bottom: 2, imageData: image(3, 2, [50, 60, 70, 200]), mask: { left: 1, top: 0, right: 3, bottom: 1, defaultColor: 0, disabled: true, imageData: mask } },
      ],
    })
    const doc = await decodePsd(file)
    const alphas = (i: number) => [0, 1, 2].flatMap((x) => [0, 1].map((y) => pixel(doc.layers[i].pixels, 3, x, y)[3]))
    // Columns left to right, each top then bottom.
    expect(alphas(0)).toEqual([0, 0, 0, 0, 100, 0])
    expect(alphas(1)).toEqual([200, 200, 0, 200, 100, 200])
    expect(alphas(2)).toEqual([200, 200, 200, 200, 200, 200])
    // The colour stays as it was: only alpha changes.
    expect(pixel(doc.layers[0].pixels, 3, 2, 0)).toEqual([50, 60, 70, 100])
  })

  it('takes fill opacity as part of the opacity', async () => {
    const file = psdFile({ width: 1, height: 1, children: [{ name: 'f', opacity: 0.5, fillOpacity: 0.5, left: 0, top: 0, right: 1, bottom: 1, imageData: image(1, 1, [1, 1, 1, 255]) }] })
    expect((await decodePsd(file)).layers[0].opacity).toBeCloseTo(0.25, 2)
  })

  it('opens a file without layers as one layer: its image', async () => {
    const merged = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
    const doc = await decodePsd(new Blob([rawPsd({ width: 2, height: 2, merged })]))
    expect(doc.layers).toHaveLength(1)
    expect(doc.layers[0].name).toBe('Background')
    expect(Array.from(doc.layers[0].pixels)).toEqual([10, 50, 90, 255, 20, 60, 100, 255, 30, 70, 110, 255, 40, 80, 120, 255])
  })

  it('opens a grayscale file in colour', async () => {
    const doc = await decodePsd(new Blob([rawPsd({ width: 2, height: 1, colorMode: 1, channels: 1, merged: new Uint8Array([0, 200]) })]))
    expect(Array.from(doc.layers[0].pixels)).toEqual([0, 0, 0, 255, 200, 200, 200, 255])
  })

  it('makes 16- and 32-bit layers 8-bit: 32-bit ones are in linear light, so through the sRGB curve, except alpha', async () => {
    const layer = (depth: 16 | 32, c: number, a: number) =>
      rawPsd({
        width: 1,
        height: 1,
        depth,
        layers: [{ top: 0, left: 0, bottom: 1, right: 1, channels: [-1, 0, 1, 2].map((id) => ({ id, data: samples([id === -1 ? a : c], depth) })) }],
      })
    const sixteen = await decodePsd(new Blob([layer(16, 32896, 65535)]))
    expect(Array.from(sixteen.layers[0].pixels)).toEqual([128, 128, 128, 255])
    const float = await decodePsd(new Blob([layer(32, 0.5, 0.5)]))
    expect(Array.from(float.layers[0].pixels)).toEqual([188, 188, 188, 128])
  })

  it('reads ZIP-compressed channels', async () => {
    const file = rawPsd({
      width: 2,
      height: 1,
      layers: [{ top: 0, left: 0, bottom: 1, right: 2, channels: [-1, 0, 1, 2].map((id) => zipChannel(id, new Uint8Array([255, id === 0 ? 9 : 255]))) }],
    })
    const doc = await decodePsd(new Blob([file]))
    expect(Array.from(doc.layers[0].pixels)).toEqual([255, 255, 255, 255, 9, 255, 255, 255])
  })

  // Photoshop CS6 saved both without Maximize Compatibility: their composites are blank, so only their layers show them.
  it("reads Photoshop's 16-bit photo layer, ZIP-compressed with prediction", async () => {
    const doc = await decodePsd(photoshopFile('16-bit'))
    // Where it is opaque, it is ag-psd's image of the layer (test/read/16bits/layer-0.png) exactly. At its edges it is
    // within 2 levels of colour times alpha: ag-psd's image went through a canvas, which keeps colours premultiplied.
    // A fox, turned, so the corners are transparent: its eye, its fur, its nose, the grass behind.
    const points: [number, number][] = [[0, 0], [499, 499], [250, 250], [60, 300], [330, 318], [450, 300], [200, 420]]
    const expected = [[[173, 129, 80, 0], [75, 70, 12, 0], [95, 39, 2, 255], [158, 86, 27, 255], [78, 55, 42, 255], [28, 32, 14, 255], [163, 138, 84, 255]]]
    expect(at(doc, points, expected)).toEqual(expected)
  })

  it("reads Photoshop's 32-bit layers, in linear light, through the sRGB curve, and their soft edges' alpha without it", async () => {
    const doc = await decodePsd(photoshopFile('32-bit'))
    // Blended in linear light, as Photoshop blends 32-bit files, they are within the JPEG noise of the
    // thumbnail Photoshop saved, 3.7 levels on average. ag-psd's images of them take a gamma of 2.2
    // for the sRGB curve, which is up to 9 levels lighter in the darkest colours.
    expect(doc.layers.map((l) => l.name)).toEqual(['Layer 1', 'Layer 0'])
    // The ground, then a character and brush strokes, some half transparent.
    const points: [number, number][] = [[150, 280], [150, 100], [120, 110], [50, 220], [225, 210], [10, 10]]
    const expected = [
      [[249, 234, 144, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      [[6, 214, 160, 0], [6, 214, 160, 255], [7, 59, 76, 255], [6, 214, 160, 54], [17, 138, 178, 179], [0, 0, 0, 0]],
    ]
    expect(at(doc, points, expected)).toEqual(expected)
  })

  it("takes a flat file's channel after its colours as a saved selection, as Photoshop does, not as transparency", async () => {
    // Red, green and blue, then a selection of nothing.
    const merged = new Uint8Array([10, 20, 30, 40, 50, 60, 0, 0])
    const doc = await decodePsd(new Blob([rawPsd({ width: 2, height: 1, channels: 4, merged })]))
    expect(Array.from(doc.layers[0].pixels)).toEqual([10, 30, 50, 255, 20, 40, 60, 255])
  })

  it("takes it as the composite's transparency where the layer count says so, without Photoshop's white matte", async () => {
    // Only an empty group, so the composite is what opens: ag-psd writes its transparency as Photoshop does.
    // (3 px wide: ag-psd cuts short the composite of an image 1 or 2 px wide.)
    const rgba = [200, 0, 100, 128, 0, 50, 250, 255, 9, 99, 199, 255]
    const file = psdFile({ width: 3, height: 1, children: [{ name: 'G', opened: true, children: [] }], imageData: { width: 3, height: 1, data: new Uint8ClampedArray(rgba) } })
    const doc = await decodePsd(file)
    expect(doc.notes.groups).toBe(1)
    // Within 2 levels: the matte is rounded on the way in and out.
    expect(Array.from(doc.layers[0].pixels).map((v, i) => (Math.abs(v - rgba[i]) <= 2 ? rgba[i] : v))).toEqual(rgba)
  })
})

describe('decodePsd, refusing files (plan M1.7)', () => {
  it("refuses what isn't a PSD file", async () => {
    expect(await refusal(new Blob(['not a PSD file, but long enough to look at']))).toBe("it isn't a PSD file, or it is damaged")
    expect(await refusal(new Blob([new Uint8Array(4)]))).toBe("it isn't a PSD file, or it is damaged")
  })

  it('refuses colour modes it has no way to show, saying what to do', async () => {
    expect(await refusal(new Blob([rawPsd({ width: 1, height: 1, colorMode: 4, channels: 4 })]))).toBe(
      "it is in CMYK color, which QUAR Artist can't open. Convert it to RGB in the app that made it, then open it again",
    )
    expect(await refusal(new Blob([rawPsd({ width: 1, height: 1, colorMode: 9 })]))).toBe(
      "it is in Lab color, which QUAR Artist can't open. Convert it to RGB in the app that made it, then open it again",
    )
    // Not a colour mode at all.
    expect(await refusal(new Blob([rawPsd({ width: 1, height: 1, colorMode: 5 })]))).toBe("it isn't a PSD file, or it is damaged")
  })

  it('refuses a canvas larger than the device opens, before reading the rest of the file', async () => {
    const header = rawPsd({ width: 9000, height: 10, layers: [] }).subarray(0, 26)
    expect(await refusal(new Blob([header]), { maxSide: 8192 })).toBe('it is too large to open on this device')
  })

  it('refuses a file larger than one buffer can hold, without reading it', async () => {
    const huge = { size: MAX_PSD_FILE_BYTES + 1, slice: () => huge, arrayBuffer: () => Promise.reject(new Error('read')) } as unknown as Blob
    expect(await refusal(huge)).toBe('it is too large to open on this device')
  })

  it('refuses more layers than the app has, counted once groups are flattened, rather than leave some out', async () => {
    const one = (name: string): Layer => ({ name, left: 0, top: 0, right: 1, bottom: 1, imageData: image(1, 1, [1, 1, 1, 255]) })
    const file = psdFile({ width: 1, height: 1, children: [one('a'), { name: 'G', opened: true, children: [one('b'), one('c')] }] })
    expect(await refusal(file, { maxLayers: 2 })).toBe(
      'it has 3 layers, and QUAR Artist can have up to 2. Merge some in the app that made it, then open it again',
    )
    expect(await refusal(file, { maxLayers: 3 })).toBe('opened')
  })

  it('refuses a document whose layers would take more memory than it may', async () => {
    const file = encodePsd({ width: 4, height: 4, dpi: 72, layers: [{ info: info('a'), pixels: painted(4, 4, [1, 1, 1, 255]) }], activeLayerId: 'a', composite: painted(4, 4, [1, 1, 1, 255]) })
    expect(await refusal(file, { maxBytes: 63 })).toBe('it is too large to open on this device')
    expect(await refusal(file, { maxBytes: 64 })).toBe('opened')
  })

  it('refuses a layer with more pixels than a canvas the device opens, before decoding it', async () => {
    // Its channels are tiny: ZIP data that would unpack to 100 MB a channel.
    const file = rawPsd({ width: 4, height: 4, layers: [{ top: 0, left: 0, bottom: 10_000, right: 10_000, channels: [zipChannel(0, new Uint8Array(16))] }] })
    expect(await refusal(new Blob([file]), { maxSide: 8192 })).toBe('it is too large to open on this device')
  })

  it('refuses a ZIP-compressed channel that unpacks to more than its layer holds, without unpacking it all', async () => {
    // 64 MB of zeros, compressed to a few dozen kilobytes, for a layer of 2 × 2.
    const bomb = zipChannel(0, new Uint8Array(64 * 1024 * 1024))
    expect(bomb.data.length).toBeLessThan(100_000)
    const file = rawPsd({ width: 2, height: 2, layers: [{ top: 0, left: 0, bottom: 2, right: 2, channels: [bomb] }] })
    expect(await refusal(new Blob([file]))).toBe("it isn't a PSD file, or it is damaged")
  }, 30_000)
})
