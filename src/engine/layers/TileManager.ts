const TILE_SIZE = 256

export interface TileKey {
  tx: number
  ty: number
}

/**
 * Tracks which 256x256 tiles a brush stroke touches.
 * Used by UndoManager to snapshot only dirty tiles.
 */
export class TileManager {
  private dirtyTiles = new Set<string>()

  /** Mark tiles that a stamp at (x, y) with given radius touches. */
  markDirty(x: number, y: number, radius: number) {
    const left = Math.floor((x - radius) / TILE_SIZE)
    const right = Math.floor((x + radius) / TILE_SIZE)
    const top = Math.floor((y - radius) / TILE_SIZE)
    const bottom = Math.floor((y + radius) / TILE_SIZE)

    for (let tx = left; tx <= right; tx++) {
      for (let ty = top; ty <= bottom; ty++) {
        this.dirtyTiles.add(tileKeyStr(tx, ty))
      }
    }
  }

  /** Get all dirty tile keys since last reset. */
  getDirtyTiles(): TileKey[] {
    return [...this.dirtyTiles].map(parseTileKey)
  }

  /** Get dirty tile key strings. */
  getDirtyTileKeys(): string[] {
    return [...this.dirtyTiles]
  }

  /** Get count of dirty tiles. */
  get size(): number {
    return this.dirtyTiles.size
  }

  /** Clear the dirty set (call after operation commit). */
  reset() {
    this.dirtyTiles.clear()
  }
}

export function tileKeyStr(tx: number, ty: number): string {
  return `${tx}_${ty}`
}

export function parseTileKey(key: string): TileKey {
  const [tx, ty] = key.split('_').map(Number)
  return { tx, ty }
}

export { TILE_SIZE }
