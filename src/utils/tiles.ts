/**
 * The 256 × 256 tile grid that documents are saved in (plan D1), shared by
 * the engine, which reports the tiles each change touches, and the tile
 * store, which saves them.
 */

export const TILE_SIZE = 256

export function tileColumns(width: number): number {
  return Math.ceil(width / TILE_SIZE)
}

export function tileRows(height: number): number {
  return Math.ceil(height / TILE_SIZE)
}

/** A tile's column and row. */
export interface TilePosition {
  x: number
  y: number
}

/** A tile's name in change records: "column_row". */
export function tileKey(x: number, y: number): string {
  return `${x}_${y}`
}

export function parseTileKey(key: string): TilePosition {
  const [x, y] = key.split('_').map(Number)
  return { x, y }
}

/** What a layer's pixels changed by: some of its tiles, or the whole layer. */
export type TileChanges = ReadonlySet<string> | 'all'

/** The part of the document a tile covers, cut at the right and bottom edges. */
export function tileBounds(x: number, y: number, width: number, height: number) {
  const left = x * TILE_SIZE
  const top = y * TILE_SIZE
  return { left, top, width: Math.min(TILE_SIZE, width - left), height: Math.min(TILE_SIZE, height - top) }
}

/**
 * The tiles in which two versions of a layer differ, as tile keys. Both are
 * `width` × `height` RGBA8. Compares four bytes at a time where the buffers
 * allow it, and moves on from a tile at its first difference.
 */
export function changedTiles(before: Uint8Array, after: Uint8Array, width: number, height: number): string[] {
  const aligned = before.byteOffset % 4 === 0 && after.byteOffset % 4 === 0
  const a = aligned ? new Uint32Array(before.buffer, before.byteOffset, width * height) : null
  const b = aligned ? new Uint32Array(after.buffer, after.byteOffset, width * height) : null
  const changed: string[] = []
  for (let y = 0; y < tileRows(height); y++) {
    for (let x = 0; x < tileColumns(width); x++) {
      const tile = tileBounds(x, y, width, height)
      let differs = false
      for (let row = tile.top; row < tile.top + tile.height && !differs; row++) {
        const start = row * width + tile.left
        const end = start + tile.width
        if (a && b) {
          for (let i = start; i < end; i++) {
            if (a[i] !== b[i]) {
              differs = true
              break
            }
          }
        } else {
          for (let i = start * 4; i < end * 4; i++) {
            if (before[i] !== after[i]) {
              differs = true
              break
            }
          }
        }
      }
      if (differs) changed.push(tileKey(x, y))
    }
  }
  return changed
}

/** A tile's pixels as read for a save: straight RGBA8 of the part of the document it covers (`tileBounds`). */
export interface TilePixels extends TilePosition {
  pixels: Uint8Array
}

/** Adjacent tiles of one row, read back as one rectangle. */
export interface TileRun {
  /** The row, and the first column. */
  y: number
  x: number
  count: number
  /** The rectangle the tiles cover, in pixels. */
  left: number
  top: number
  width: number
  height: number
}

/** Group tiles into runs of adjacent ones, row by row. Tiles outside the grid are left out. */
export function tileRuns(positions: readonly TilePosition[], width: number, height: number): TileRun[] {
  const columns = tileColumns(width)
  const rows = tileRows(height)
  const keys = new Set<string>()
  const valid = positions.filter((p) => {
    const ok = Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < columns && p.y < rows
    const key = tileKey(p.x, p.y)
    if (!ok || keys.has(key)) return false
    keys.add(key)
    return true
  })
  valid.sort((a, b) => a.y - b.y || a.x - b.x)
  const runs: TileRun[] = []
  for (const p of valid) {
    const last = runs[runs.length - 1]
    const bounds = tileBounds(p.x, p.y, width, height)
    if (last && last.y === p.y && last.x + last.count === p.x) {
      last.count++
      last.width = bounds.left + bounds.width - last.left
      continue
    }
    runs.push({ y: p.y, x: p.x, count: 1, ...bounds })
  }
  return runs
}

type Bytes = Uint8Array | Uint8ClampedArray

/** Copy a rectangle out of an RGBA8 image `stride` pixels wide, into a buffer of its own. */
function copyRect(pixels: Bytes, stride: number, left: number, top: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const start = ((top + row) * stride + left) * 4
    out.set(pixels.subarray(start, start + width * 4), row * width * 4)
  }
  return out
}

/** Cut a run's pixels, straight RGBA of its rectangle, into its tiles. */
export function splitRun(run: TileRun, pixels: Bytes, width: number, height: number): TilePixels[] {
  const tiles: TilePixels[] = []
  for (let i = 0; i < run.count; i++) {
    const bounds = tileBounds(run.x + i, run.y, width, height)
    tiles.push({
      x: run.x + i,
      y: run.y,
      pixels: copyRect(pixels, run.width, bounds.left - run.left, 0, bounds.width, bounds.height),
    })
  }
  return tiles
}

/** Cut tiles out of a whole layer's straight-alpha pixels. */
export function cutTiles(pixels: Bytes, width: number, height: number, positions: readonly TilePosition[]): TilePixels[] {
  return tileRuns(positions, width, height).flatMap((run) => {
    const tiles: TilePixels[] = []
    for (let i = 0; i < run.count; i++) {
      const bounds = tileBounds(run.x + i, run.y, width, height)
      tiles.push({ x: run.x + i, y: run.y, pixels: copyRect(pixels, width, bounds.left, bounds.top, bounds.width, bounds.height) })
    }
    return tiles
  })
}
