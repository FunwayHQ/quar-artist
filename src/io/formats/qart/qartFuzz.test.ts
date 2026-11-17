/**
 * Fuzz tests for the .qart reader (plan M1.6): files damaged at random, and
 * manifests filled with odd values. Each must open as a whole document or be
 * refused with a QartError saying why; anything else is a bug. Seeded, so a
 * failure can be repeated.
 */
import { describe, it, expect } from 'vitest'
import { decodeQart } from './QartReader.ts'
import { encodeQart } from './QartWriter.ts'
import { entry, manifestOf, qartArchive, rawZip, solidLayer, solidTile, text } from './testArchives.ts'
import type { LayerInfo } from '../../../types/layer.ts'

/** mulberry32: a small seeded generator. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function layer(id: string): LayerInfo {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false }
}

/** Open a file, or say it was refused. Throws when it opens as something other than a whole document, or fails otherwise. */
async function outcome(bytes: Uint8Array): Promise<'opened' | 'refused'> {
  let doc
  try {
    doc = await decodeQart(new Blob([bytes as Uint8Array<ArrayBuffer>]))
  } catch (err) {
    if ((err as Error).name !== 'QartError') throw err
    expect((err as Error).message).toMatch(/^it /)
    return 'refused'
  }
  expect(doc.layers.length).toBeGreaterThan(0)
  for (const l of doc.layers) expect(l.pixels.length).toBe(doc.width * doc.height * 4)
  expect(doc.layers.some((l) => l.info.id === doc.activeLayerId)).toBe(true)
  expect(doc.unreadableTiles).toBeGreaterThanOrEqual(0)
  return 'opened'
}

/** Damage a copy of `bytes` in one of the ways files get damaged, or are made to. */
function damage(bytes: Uint8Array, next: () => number): Uint8Array {
  const at = (from = 0) => from + Math.floor(next() * (bytes.length - from))
  // The central directory and its end record are where most of the structure is.
  const nearEnd = () => at(Math.max(0, bytes.length - 400))
  const out = bytes.slice()
  switch (Math.floor(next() * 5)) {
    case 0: {
      for (let n = 1 + Math.floor(next() * 8); n > 0; n--) out[next() < 0.5 ? nearEnd() : at()] ^= 1 + Math.floor(next() * 255)
      return out
    }
    case 1: {
      const i = Math.min(nearEnd(), out.length - 4)
      new DataView(out.buffer).setUint32(i, [0, 0xffffffff, 0x7fffffff, 0x80000000, 0x10000][Math.floor(next() * 5)], true)
      return out
    }
    case 2:
      return out.slice(0, at())
    case 3: {
      const start = at()
      const piece = bytes.slice(start, start + Math.floor(next() * 600))
      const into = at()
      const spliced = new Uint8Array(out.length + piece.length)
      spliced.set(out.subarray(0, into))
      spliced.set(piece, into)
      spliced.set(out.subarray(into), into + piece.length)
      return spliced
    }
    default: {
      const i = at()
      out.fill(next() < 0.5 ? 0 : 255, i, i + Math.floor(next() * 64))
      return out
    }
  }
}

/** Replace a value somewhere in a manifest with an odd one. */
function oddManifest(base: Record<string, unknown>, next: () => number): unknown {
  const manifest = structuredClone(base)
  const odd = [null, -1, 0, 0.5, 1e20, -1e20, '', 'x'.repeat(300), '../..', [], {}, true, [1, 2], { a: { b: { c: [] } } }, 'normal', 16384, 'a']
  const paths: (string | number)[][] = []
  const walk = (value: unknown, path: (string | number)[]) => {
    paths.push(path)
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i]))
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k])
  }
  walk(manifest, [])
  for (let n = 1 + Math.floor(next() * 3); n > 0; n--) {
    const path = paths[1 + Math.floor(next() * (paths.length - 1))]
    let target = manifest as Record<string | number, unknown>
    for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>
    if (target && typeof target === 'object') {
      if (next() < 0.15) delete target[path[path.length - 1]]
      else target[path[path.length - 1]] = odd[Math.floor(next() * odd.length)]
    }
  }
  return manifest
}

describe('the .qart reader, fuzzed', () => {
  it('opens or refuses version 1 files damaged at random', async () => {
    const pixels = (rgba: number[]) => solidLayer(300, 200, rgba)
    const file = new Uint8Array(
      await (
        await encodeQart(
          {
            name: 'Fuzz',
            width: 300,
            height: 200,
            dpi: 144,
            layers: [
              { info: layer('a'), pixels: pixels([10, 20, 30, 255]) },
              { info: layer('b'), pixels: pixels([200, 100, 0, 128]) },
            ],
            activeLayerId: 'b',
            guides: { gridEnabled: true } as never,
          },
          async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        )
      ).arrayBuffer(),
    )
    const next = random(1)
    const seen = { opened: 0, refused: 0 }
    for (let n = 0; n < 300; n++) seen[await outcome(damage(file, next))]++
    // Both happen: some damage is to the pixels, which open with tiles left out.
    expect(seen.opened).toBeGreaterThan(0)
    expect(seen.refused).toBeGreaterThan(0)
  }, 180_000)

  it('opens or refuses draft files damaged at random', async () => {
    const manifest = {
      version: '1.0',
      app: 'quar-artist',
      canvas: { width: 40, height: 30, dpi: 72, colorSpace: 'srgb' },
      layers: [
        { id: 'a', name: 'A', blendMode: 'normal', opacity: 1, visible: true, order: 0, dataFile: 'layers/a.bin' },
        { id: 'b', name: 'B', blendMode: 'screen', opacity: 0.5, visible: true, order: 1, dataFile: 'layers/b.bin' },
      ],
      activeLayerId: 'b',
    }
    const file = rawZip([
      entry('layers/a.bin', solidLayer(40, 30, [1, 2, 3, 255])),
      entry('layers/b.bin', solidLayer(40, 30, [9, 8, 7, 100])),
      entry('manifest.json', text(JSON.stringify(manifest))),
    ])
    const next = random(2)
    for (let n = 0; n < 300; n++) await outcome(damage(file, next))
  }, 180_000)

  it('opens or refuses manifests with odd values anywhere', async () => {
    const base = manifestOf({ width: 300, height: 200, layerIds: ['a', 'b'] }, { guides: { gridEnabled: true, gridSpacing: 10 } })
    const tiles = [solidTile('a', 0, 0), solidTile('b', 1, 0, 128)]
    const next = random(3)
    for (let n = 0; n < 300; n++) await outcome(qartArchive(oddManifest(base, next), tiles))
  }, 180_000)
})
