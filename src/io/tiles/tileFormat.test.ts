import { describe, it, expect, vi, afterEach } from 'vitest'
import { TILE_BYTES, TILE_SIZE, cutTile, hashTile, isEmptyTile, placeTile, tileColumns, tileFromPixels, tileRows } from './tileFormat.ts'
import { cutTiles } from '../../utils/tiles.ts'
import { decodeTile, encodeTile } from './tileCodec.ts'
import { sameBytes } from '../../test/bytes.ts'

/** Straight-alpha pixels with every alpha from 0 to 255 and varied colour. */
function varied(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 37) & 255
    pixels[i * 4 + 1] = (i * 101) & 255
    pixels[i * 4 + 2] = (i * 13) & 255
    pixels[i * 4 + 3] = i & 255
  }
  return pixels
}

function cutAll(pixels: ArrayLike<number>, width: number, height: number): Uint8Array[] {
  const tiles: Uint8Array[] = []
  for (let y = 0; y < tileRows(height); y++) {
    for (let x = 0; x < tileColumns(width); x++) tiles.push(cutTile(pixels, width, height, x, y))
  }
  return tiles
}

describe('tiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('covers a document with whole tiles, the last ones partly outside it', () => {
    expect([tileColumns(256), tileColumns(257), tileColumns(1)]).toEqual([1, 2, 1])
    expect([tileRows(512), tileRows(513)]).toEqual([2, 3])
  })

  it('cuts premultiplied tiles and puts them back exactly, at a size that isn\'t a multiple of 256', () => {
    const width = 300
    const height = 260
    const tiles = cutAll(varied(width, height), width, height)
    expect(tiles).toHaveLength(4)

    const restored = new Uint8ClampedArray(width * height * 4)
    let i = 0
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) placeTile(tiles[i++], restored, width, height, x, y)

    // Premultiplied colour is what the GPU holds: it survives the round trip byte for byte.
    const again = cutAll(restored, width, height)
    expect(again.every((tile, n) => sameBytes(tile, tiles[n]))).toBe(true)
  })

  it('makes the same tile from a tile read back on its own as from the whole layer (plan M1.3)', () => {
    const width = 300
    const height = 260
    const pixels = varied(width, height)
    // The edge tile: 44 × 256 of the document, read back as straight alpha.
    const [read] = cutTiles(pixels, width, height, [{ x: 1, y: 0 }])
    const tile = tileFromPixels(read.pixels, 44, 256)
    expect(tile).toHaveLength(TILE_BYTES)
    expect(sameBytes(tile, cutTile(pixels, width, height, 1, 0))).toBe(true)
    // The corner one, 44 × 4.
    const [corner] = cutTiles(pixels, width, height, [{ x: 1, y: 1 }])
    expect(sameBytes(tileFromPixels(corner.pixels, 44, 4), cutTile(pixels, width, height, 1, 1))).toBe(true)
  })

  it('keeps opaque pixels exactly as they were', () => {
    const pixels = varied(256, 256)
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
    const restored = new Uint8ClampedArray(pixels.length)
    placeTile(cutTile(pixels, 256, 256, 0, 0), restored, 256, 256, 0, 0)
    expect(sameBytes(restored, pixels)).toBe(true)
  })

  it('pads tiles past the document\'s edges with transparent pixels', () => {
    const pixels = new Uint8Array(10 * 10 * 4).fill(255)
    const tile = cutTile(pixels, 10, 10, 0, 0)
    expect(tile.byteLength).toBe(TILE_BYTES)
    expect(Array.from(tile.subarray(0, 4))).toEqual([255, 255, 255, 255])
    expect(Array.from(tile.subarray(10 * 4, 10 * 4 + 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(tile.subarray(10 * TILE_SIZE * 4, 10 * TILE_SIZE * 4 + 4))).toEqual([0, 0, 0, 0])
  })

  it('knows an empty tile, including colour left under zero alpha', () => {
    const pixels = new Uint8Array(4 * 4 * 4)
    expect(isEmptyTile(cutTile(pixels, 4, 4, 0, 0))).toBe(true)
    pixels.fill(200)
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0
    expect(isEmptyTile(cutTile(pixels, 4, 4, 0, 0))).toBe(true)
    pixels[3] = 1
    expect(isEmptyTile(cutTile(pixels, 4, 4, 0, 0))).toBe(false)
  })

  it('hashes equal tiles alike and notices a single changed byte', async () => {
    const a = cutTile(varied(256, 256), 256, 256, 0, 0)
    const b = a.slice()
    expect(await hashTile(a)).toBe(await hashTile(b))
    b[12345] ^= 1
    expect(await hashTile(b)).not.toBe(await hashTile(a))
    expect(await hashTile(a)).toMatch(/^s1:[0-9a-f]{32}$/)
  })

  it('hashes without Web Crypto too, never matching a hash made with it', async () => {
    const a = cutTile(varied(256, 256), 256, 256, 0, 0)
    const withCrypto = await hashTile(a)
    vi.stubGlobal('crypto', {})
    const b = a.slice()
    b[0] ^= 1
    expect(await hashTile(a)).toMatch(/^m3:[0-9a-f]{16}$/)
    expect(await hashTile(a)).not.toBe(await hashTile(b))
    expect(await hashTile(a)).not.toBe(withCrypto)
  })
})

describe('tile codec', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('compresses with deflate and gets the same bytes back', async () => {
    const tile = cutTile(varied(100, 100), 100, 100, 0, 0)
    const { codec, data } = await encodeTile(tile)
    expect(codec).toBe('deflate-raw')
    expect(data.byteLength).toBeLessThan(tile.byteLength / 2)
    expect(sameBytes(await decodeTile(codec, data), tile)).toBe(true)
  })

  it('stores tiles as they are without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const tile = cutTile(varied(16, 16), 16, 16, 0, 0)
    const { codec, data } = await encodeTile(tile)
    expect(codec).toBe('raw')
    expect(sameBytes(await decodeTile(codec, data), tile)).toBe(true)
  })

  it('refuses bytes that are not a whole tile, or a codec it does not know', async () => {
    await expect(decodeTile('raw', new Uint8Array(10))).rejects.toThrow('10 bytes')
    await expect(decodeTile('lz4' as never, new Uint8Array(TILE_BYTES))).rejects.toThrow("can't read (lz4)")
    await expect(decodeTile('deflate-raw', new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})
