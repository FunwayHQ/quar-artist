/**
 * CPU-based unsharp mask sharpen.
 * output = original + amount * (original - blurred), gated by luminance threshold.
 *
 * Custom GLSL shaders don't auto-transpile to WGSL on PixiJS v8 WebGPU,
 * so we perform the unsharp mask computation on CPU instead.
 */
export function cpuUnsharpMask(
  original: Uint8Array,
  blurred: Uint8Array,
  amount: number,
  threshold: number,
): Uint8Array {
  const len = original.length
  const result = new Uint8Array(len)
  const amt = amount / 100
  const thresh = threshold / 255

  for (let i = 0; i < len; i += 4) {
    const oR = original[i] / 255
    const oG = original[i + 1] / 255
    const oB = original[i + 2] / 255
    const oA = original[i + 3]

    const bR = blurred[i] / 255
    const bG = blurred[i + 1] / 255
    const bB = blurred[i + 2] / 255

    const dR = oR - bR
    const dG = oG - bG
    const dB = oB - bB

    // Luminance-based threshold gating
    const lum = Math.abs(dR) * 0.299 + Math.abs(dG) * 0.587 + Math.abs(dB) * 0.114
    const gate = lum > thresh + 0.01 ? 1 : lum > thresh ? (lum - thresh) / 0.01 : 0

    const rR = Math.max(0, Math.min(1, oR + dR * amt * gate))
    const rG = Math.max(0, Math.min(1, oG + dG * amt * gate))
    const rB = Math.max(0, Math.min(1, oB + dB * amt * gate))

    result[i] = Math.round(rR * 255)
    result[i + 1] = Math.round(rG * 255)
    result[i + 2] = Math.round(rB * 255)
    result[i + 3] = oA
  }

  return result
}
