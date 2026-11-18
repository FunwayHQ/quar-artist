import { describe, it, expect, vi } from 'vitest'
import { decodePsd } from './PsdReader.ts'
import { encodePsd } from './PsdWriter.ts'
import { writePsdUint8Array } from './agPsd.ts'
import { rawPsd, samples, zipChannel } from './testPsds.ts'
import type { LayerInfo } from '../../../types/layer.ts'

/** Deterministic pseudo-random numbers (xorshift32), so a failure can be run again. */
function random(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

function info(id: string, props: Partial<LayerInfo> = {}): LayerInfo {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false, ...props }
}

function noise(n: number, next: () => number) {
  return Uint8Array.from({ length: n }, () => Math.floor(next() * 256))
}

/** Valid files of each kind the reader takes apart: the app's, groups and masks as ag-psd writes them, 16-bit and ZIP ones. */
async function samplesToDamage(): Promise<Uint8Array[]> {
  const next = random(7)
  const ours = encodePsd({
    width: 24,
    height: 16,
    dpi: 144,
    layers: [
      { info: info('a'), pixels: noise(24 * 16 * 4, next) },
      { info: info('b', { blendMode: 'screen', opacity: 0.5, clippingMask: true }), pixels: noise(24 * 16 * 4, next) },
    ],
    activeLayerId: 'b',
    composite: noise(24 * 16 * 4, next),
  })
  const image = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(noise(w * h * 4, next)) })
  const structured = writePsdUint8Array(
    {
      width: 16,
      height: 16,
      children: [
        { name: 'base', left: -4, top: 2, right: 12, bottom: 14, imageData: image(16, 12) },
        {
          name: 'G',
          opened: true,
          children: [
            { name: 'masked', left: 0, top: 0, right: 16, bottom: 16, imageData: image(16, 16), mask: { left: 2, top: 2, right: 10, bottom: 10, defaultColor: 255, imageData: image(8, 8) } },
          ],
        },
        { name: 'Invert', adjustment: { type: 'invert' } },
      ],
    },
    { noBackground: true },
  )
  const sixteen = rawPsd({
    width: 8,
    height: 8,
    depth: 16,
    layers: [{ top: 0, left: 0, bottom: 8, right: 8, channels: [-1, 0, 1, 2].map((id) => ({ id, data: samples(Array.from({ length: 64 }, (_, i) => i * 1000), 16) })) }],
  })
  const zipped = rawPsd({
    width: 8,
    height: 8,
    layers: [{ top: 0, left: 0, bottom: 8, right: 8, channels: [-1, 0, 1, 2].map((id) => zipChannel(id, noise(64, next))) }],
  })
  return [new Uint8Array(await ours.arrayBuffer()), structured, sixteen, zipped]
}

describe('decodePsd, given damaged files (plan M1.7)', () => {
  it('opens or refuses them with a PsdError, never anything else', async () => {
    // ag-psd notes what it puts right in damaged channels on the console.
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const files = await samplesToDamage()
    // No layers: the image is the file's merged one.
    files.push(new Uint8Array(await encodePsd({ width: 4, height: 4, dpi: 72, layers: [], activeLayerId: '', composite: new Uint8Array(64) }).arrayBuffer()))
    const next = random(42)
    let opened = 0
    let refused = 0
    for (let round = 0; round < 400; round++) {
      const file = files[round % files.length].slice()
      // A few bytes changed, or the file cut short.
      if (round % 5 === 4) {
        const cut = file.subarray(0, Math.floor(next() * file.length))
        await check(cut)
        continue
      }
      for (let n = 1 + Math.floor(next() * 4); n > 0; n--) file[Math.floor(next() * file.length)] = Math.floor(next() * 256)
      await check(file)
    }
    expect(opened + refused).toBe(400)
    // Both happen: some damage lands in pixels only.
    expect(opened).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)

    async function check(bytes: Uint8Array) {
      try {
        const doc = await decodePsd(new Blob([bytes as Uint8Array<ArrayBuffer>]), { maxLayers: 20, maxSide: 4096, maxBytes: 20 * 4096 * 4096 * 4 })
        for (const layer of doc.layers) expect(layer.pixels.length).toBe(doc.width * doc.height * 4)
        opened++
      } catch (err) {
        expect((err as Error).name, (err as Error).stack).toBe('PsdError')
        refused++
      }
    }
  }, 60_000)
})
