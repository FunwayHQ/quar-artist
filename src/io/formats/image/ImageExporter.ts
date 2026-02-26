/**
 * Exports pixel data to PNG or JPEG Blob via canvas.toBlob().
 */

export interface ImageExportOptions {
  format: 'png' | 'jpeg'
  quality?: number
}

/**
 * Exports RGBA pixel data as a PNG or JPEG Blob.
 */
export async function exportImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: ImageExportOptions,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2d context')

  const imageData = ctx.createImageData(width, height)
  imageData.data.set(pixels)
  ctx.putImageData(imageData, 0, 0)

  return new Promise<Blob>((resolve, reject) => {
    const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const quality = options.format === 'jpeg' ? (options.quality ?? 0.92) : undefined

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create image blob'))
        }
      },
      mimeType,
      quality,
    )
  })
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
