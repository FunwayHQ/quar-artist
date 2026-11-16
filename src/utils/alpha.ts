/**
 * Conversions between straight and premultiplied alpha for RGBA8 pixels.
 *
 * The pair is exact in one direction: premultiplying what `unpremultiply`
 * gives back returns the original premultiplied bytes, for every value. GPU
 * textures hold premultiplied colour, so pixels read back, saved and loaded
 * again come back as they were.
 */

/** Premultiply `count` straight-alpha pixels from `src` into `dst`, rounding to nearest. */
export function premultiplyInto(
  src: ArrayLike<number>,
  srcOffset: number,
  dst: Uint8Array | Uint8ClampedArray,
  dstOffset: number,
  count: number,
): void {
  for (let n = 0; n < count; n++) {
    const i = srcOffset + n * 4
    const j = dstOffset + n * 4
    const a = src[i + 3]
    dst[j + 3] = a
    if (a === 0) {
      dst[j] = 0
      dst[j + 1] = 0
      dst[j + 2] = 0
    } else if (a === 255) {
      dst[j] = src[i]
      dst[j + 1] = src[i + 1]
      dst[j + 2] = src[i + 2]
    } else {
      dst[j] = Math.round((src[i] * a) / 255)
      dst[j + 1] = Math.round((src[i + 1] * a) / 255)
      dst[j + 2] = Math.round((src[i + 2] * a) / 255)
    }
  }
}

/** Premultiply straight-alpha RGBA8, rounding to nearest (the inverse of `unpremultiply`). */
export function premultiply(src: ArrayLike<number>, length = src.length): Uint8Array {
  const out = new Uint8Array(length)
  premultiplyInto(src, 0, out, 0, length >> 2)
  return out
}

/**
 * Convert `count` premultiplied pixels from `src` to straight alpha in `dst`.
 * Fully transparent pixels become 0, 0, 0, 0. `src` and `dst` may be the same.
 */
export function unpremultiplyInto(
  src: ArrayLike<number>,
  srcOffset: number,
  dst: Uint8ClampedArray,
  dstOffset: number,
  count: number,
): void {
  for (let n = 0; n < count; n++) {
    const i = srcOffset + n * 4
    const j = dstOffset + n * 4
    const a = src[i + 3]
    dst[j + 3] = a
    if (a === 255) {
      dst[j] = src[i]
      dst[j + 1] = src[i + 1]
      dst[j + 2] = src[i + 2]
    } else if (a === 0) {
      dst[j] = 0
      dst[j + 1] = 0
      dst[j + 2] = 0
    } else {
      // Uint8ClampedArray rounds and clamps on assignment.
      const scale = 255 / a
      dst[j] = src[i] * scale
      dst[j + 1] = src[i + 1] * scale
      dst[j + 2] = src[i + 2] * scale
    }
  }
}

/** Convert premultiplied RGBA8 to straight alpha in place. Fully transparent pixels become 0, 0, 0, 0. */
export function unpremultiply(data: Uint8ClampedArray): void {
  unpremultiplyInto(data, 0, data, 0, data.length >> 2)
}
