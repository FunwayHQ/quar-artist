/**
 * Async gzip compression/decompression for undo snapshots.
 * Uses the CompressionStream/DecompressionStream APIs (available in all modern browsers).
 * Falls back to passthrough if APIs are unavailable.
 */

const COMPRESSION_AVAILABLE = (() => {
  try {
    return (
      typeof CompressionStream !== 'undefined' &&
      typeof DecompressionStream !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof new Blob([]).stream === 'function'
    )
  } catch {
    return false
  }
})()

/**
 * Compress a Uint8Array using gzip.
 * Returns a new (smaller) Uint8Array, or the original if compression is unavailable.
 */
export async function compressSnapshot(data: Uint8Array): Promise<Uint8Array> {
  if (!COMPRESSION_AVAILABLE) return data

  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  const blob = await new Response(stream).blob()
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

/**
 * Decompress a gzip-compressed Uint8Array.
 * Returns the original uncompressed data.
 */
export async function decompressSnapshot(data: Uint8Array): Promise<Uint8Array> {
  if (!COMPRESSION_AVAILABLE) return data

  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))

  const blob = await new Response(stream).blob()
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

/** Whether compression is supported in this environment. */
export const isCompressionAvailable = COMPRESSION_AVAILABLE
