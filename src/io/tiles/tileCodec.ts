import { TILE_BYTES, type TileCodec } from './tileFormat.ts'

/**
 * Compress tiles with deflate where the browser has CompressionStream
 * ('deflate-raw'), and store them as they are where it hasn't. LZ4 replaces
 * deflate once the WASM module lands (M2.6); each tile records its codec.
 */
export async function encodeTile(tile: Uint8Array): Promise<{ codec: TileCodec; data: Uint8Array }> {
  const stream = compressor()
  if (!stream) return { codec: 'raw', data: tile }
  return { codec: 'deflate-raw', data: await pipe(tile, stream) }
}

/** The tile's bytes again. Throws when they don't decode to a whole tile. */
export async function decodeTile(codec: TileCodec, data: Uint8Array): Promise<Uint8Array> {
  let tile: Uint8Array
  if (codec === 'raw') tile = data
  else if (codec === 'deflate-raw') tile = await pipe(data, new DecompressionStream('deflate-raw'))
  else throw new Error(`a tile is stored in a format this version can't read (${String(codec)})`)
  if (tile.byteLength !== TILE_BYTES) throw new Error(`a tile has ${tile.byteLength} bytes instead of ${TILE_BYTES}`)
  return tile
}

function compressor(): CompressionStream | null {
  if (typeof CompressionStream !== 'function') return null
  try {
    return new CompressionStream('deflate-raw')
  } catch {
    // Browsers before 'deflate-raw' (Safari 16.3 and earlier) throw.
    return null
  }
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  // Failures surface through the readable side below.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {})
  writer.close().catch(() => {})
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}
