import { describe, it, expect, beforeEach } from 'vitest'
import { TileManager, tileKeyStr, parseTileKey, TILE_SIZE } from './TileManager.ts'

describe('TileManager', () => {
  let tm: TileManager

  beforeEach(() => {
    tm = new TileManager()
  })

  it('starts with no dirty tiles', () => {
    expect(tm.size).toBe(0)
    expect(tm.getDirtyTiles()).toHaveLength(0)
  })

  it('marks a single tile dirty for a point at the center of a tile', () => {
    tm.markDirty(128, 128, 10)
    expect(tm.size).toBe(1)
    expect(tm.getDirtyTileKeys()).toContain('0_0')
  })

  it('marks multiple tiles for a stamp that spans tile boundaries', () => {
    // Point at (256, 256) with radius 20 crosses 4 tiles
    tm.markDirty(256, 256, 20)
    expect(tm.size).toBeGreaterThan(1)
  })

  it('marks tiles for a large radius', () => {
    // Center of first tile, large radius spanning many tiles
    tm.markDirty(0, 0, 600)
    expect(tm.size).toBeGreaterThan(4)
  })

  it('deduplicates — marking same tile twice counts once', () => {
    tm.markDirty(10, 10, 5)
    tm.markDirty(20, 20, 5)
    expect(tm.size).toBe(1) // Both within tile (0,0)
  })

  it('reset clears dirty tiles', () => {
    tm.markDirty(0, 0, 100)
    expect(tm.size).toBeGreaterThan(0)
    tm.reset()
    expect(tm.size).toBe(0)
  })

  it('handles negative coordinates', () => {
    tm.markDirty(-100, -100, 10)
    expect(tm.size).toBe(1)
    const tiles = tm.getDirtyTiles()
    expect(tiles[0].tx).toBe(-1)
    expect(tiles[0].ty).toBe(-1)
  })
})

describe('tileKeyStr', () => {
  it('formats as tx_ty', () => {
    expect(tileKeyStr(3, 5)).toBe('3_5')
    expect(tileKeyStr(-1, 0)).toBe('-1_0')
  })
})

describe('parseTileKey', () => {
  it('parses tx_ty string', () => {
    const key = parseTileKey('3_5')
    expect(key.tx).toBe(3)
    expect(key.ty).toBe(5)
  })

  it('handles negative coordinates', () => {
    const key = parseTileKey('-2_-3')
    expect(key.tx).toBe(-2)
    expect(key.ty).toBe(-3)
  })
})

describe('TILE_SIZE', () => {
  it('is 256', () => {
    expect(TILE_SIZE).toBe(256)
  })
})
