/**
 * TypeScript 5.7+ types typed arrays by their backing buffer. APIs such as
 * `new ImageData()` and `new Blob()` only accept arrays backed by a plain
 * `ArrayBuffer`, while views created from `someArray.buffer` (and PixiJS
 * readbacks) are typed as `ArrayBufferLike`, which includes `SharedArrayBuffer`.
 *
 * These helpers narrow the type without copying. They copy only if the memory
 * really is a `SharedArrayBuffer`, which this app never creates today.
 */

/** View the bytes of `src` as a `Uint8ClampedArray` backed by a plain `ArrayBuffer`. */
export function asClampedBytes(
  src: ArrayBufferView,
  byteLength: number = src.byteLength,
): Uint8ClampedArray<ArrayBuffer> {
  const { buffer, byteOffset } = src
  if (buffer instanceof ArrayBuffer) {
    return new Uint8ClampedArray(buffer, byteOffset, byteLength)
  }
  return new Uint8ClampedArray(new Uint8Array(buffer, byteOffset, byteLength))
}

/** View the bytes of `src` as a `Uint8Array` backed by a plain `ArrayBuffer`. */
export function asBytes(
  src: ArrayBufferView,
  byteLength: number = src.byteLength,
): Uint8Array<ArrayBuffer> {
  const { buffer, byteOffset } = src
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer, byteOffset, byteLength)
  }
  return new Uint8Array(new Uint8Array(buffer, byteOffset, byteLength))
}
