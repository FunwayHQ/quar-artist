import { describe, it, expect } from 'vitest'
import {
  TILE_SIZE,
  changedTiles,
  cutTiles,
  parseTileKey,
  splitRun,
  tileBounds,
  tileColumns,
  tileKey,
  tileRows,
  tileRuns,
} from './tiles.ts'

// 600 × 300 is 3 × 2 tiles, the last column and row cut at the document's edge.
const W = 600
const H = 300

/** A layer whose every pixel is different, so a misplaced copy shows. */
function numbered(width = W, height = H): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = i & 255
    pixels[i * 4 + 1] = (i >> 8) & 255
    pixels[i * 4 + 2] = (i >> 16) & 255
    pixels[i * 4 + 3] = 255
  }
  return pixels
}

function pixelAt(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4
  return [...pixels.subarray(i, i + 4)]
}

describe('tile grid', () => {
  it('counts the tiles that cover a document, part tiles included', () => {
    expect([tileColumns(W), tileRows(H)]).toEqual([3, 2])
    expect([tileColumns(TILE_SIZE), tileRows(1)]).toEqual([1, 1])
  })

  it('names tiles by column and row, and reads the names back', () => {
    expect(tileKey(2, 1)).toBe('2_1')
    expect(parseTileKey('2_1')).toEqual({ x: 2, y: 1 })
  })

  it('cuts the bounds of the last tiles at the edge', () => {
    expect(tileBounds(0, 0, W, H)).toEqual({ left: 0, top: 0, width: 256, height: 256 })
    expect(tileBounds(2, 1, W, H)).toEqual({ left: 512, top: 256, width: 88, height: 44 })
  })
})

describe('changedTiles', () => {
  it('finds nothing between equal layers', () => {
    expect(changedTiles(numbered(), numbered(), W, H)).toEqual([])
  })

  it('names each tile with a difference, the edge tiles too', () => {
    const after = numbered()
    after[(10 * W + 300) * 4] ^= 1 // tile (1, 0)
    after[((H - 1) * W + (W - 1)) * 4 + 3] = 0 // the last pixel, in tile (2, 1)
    expect(changedTiles(numbered(), after, W, H)).toEqual(['1_0', '2_1'])
  })

  it('compares buffers that do not start on a four-byte boundary', () => {
    const before = new Uint8Array(W * H * 4 + 1).subarray(1)
    const after = new Uint8Array(W * H * 4 + 1).subarray(1)
    after[(260 * W + 5) * 4 + 2] = 9 // tile (0, 1)
    expect(changedTiles(before, after, W, H)).toEqual(['0_1'])
  })
})

describe('tileRuns', () => {
  it('reads adjacent tiles of a row as one rectangle, row by row', () => {
    const runs = tileRuns([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 1 }], W, H)
    expect(runs).toEqual([
      { y: 0, x: 0, count: 2, left: 0, top: 0, width: 512, height: 256 },
      { y: 1, x: 0, count: 1, left: 0, top: 256, width: 256, height: 44 },
      { y: 1, x: 2, count: 1, left: 512, top: 256, width: 88, height: 44 },
    ])
  })

  it('leaves out repeated tiles and ones outside the grid', () => {
    const runs = tileRuns([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, { x: -1, y: 0 }, { x: 0.5, y: 0 }], W, H)
    expect(runs.map((r) => [r.x, r.y, r.count])).toEqual([[0, 0, 1]])
  })
})

describe('cutting tiles', () => {
  it('cuts the pixels of each tile out of a whole layer', () => {
    const pixels = numbered()
    const [first, edge] = cutTiles(pixels, W, H, [{ x: 2, y: 1 }, { x: 1, y: 0 }])
    expect([first.x, first.y, first.pixels.length]).toEqual([1, 0, 256 * 256 * 4])
    expect(pixelAt(first.pixels, 256, 0, 0)).toEqual(pixelAt(pixels, W, 256, 0))
    expect(pixelAt(first.pixels, 256, 255, 255)).toEqual(pixelAt(pixels, W, 511, 255))
    expect([edge.x, edge.y, edge.pixels.length]).toEqual([2, 1, 88 * 44 * 4])
    expect(pixelAt(edge.pixels, 88, 87, 43)).toEqual(pixelAt(pixels, W, W - 1, H - 1))
  })

  it('cuts a run read as one rectangle into its tiles', () => {
    const pixels = numbered()
    const [run] = tileRuns([{ x: 1, y: 1 }, { x: 2, y: 1 }], W, H)
    // The run's rectangle, as a readback of it gives.
    const rect = new Uint8Array(run.width * run.height * 4)
    for (let y = 0; y < run.height; y++) {
      const start = ((run.top + y) * W + run.left) * 4
      rect.set(pixels.subarray(start, start + run.width * 4), y * run.width * 4)
    }
    const tiles = splitRun(run, rect, W, H)
    const whole = cutTiles(pixels, W, H, [{ x: 1, y: 1 }, { x: 2, y: 1 }])
    expect(tiles.map((t) => [t.x, t.y])).toEqual([[1, 1], [2, 1]])
    tiles.forEach((tile, i) => expect(tile.pixels).toEqual(whole[i].pixels))
  })

  it('gives each tile a buffer of its own', () => {
    const pixels = numbered()
    const [tile] = cutTiles(pixels, W, H, [{ x: 0, y: 0 }])
    tile.pixels[0] = 99
    expect(pixels[0]).toBe(0)
    expect(tile.pixels.buffer).not.toBe(pixels.buffer)
  })
})
