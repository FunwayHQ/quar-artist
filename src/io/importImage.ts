/**
 * Utilities for importing images from clipboard paste, file input, and drag-and-drop.
 * Converts image sources to RGBA pixel data (Uint8ClampedArray) with dimensions.
 */

export interface DecodedImage {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Decode an image Blob (PNG, JPEG, etc.) into raw RGBA pixel data.
 */
export async function decodeImageBlob(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob)
  const { width, height } = bitmap

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, width, height)
  return { pixels: imageData.data, width, height }
}

/**
 * Extract an image blob from a ClipboardEvent's data.
 * Returns the first image item found, or null.
 */
export function getImageFromClipboard(e: ClipboardEvent): Blob | null {
  const items = e.clipboardData?.items
  if (!items) return null

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  return null
}

/**
 * Extract image files from a DragEvent's dataTransfer.
 * Returns the first image file found, or null.
 */
export function getImageFromDrop(e: DragEvent): File | null {
  const files = e.dataTransfer?.files
  if (!files) return null

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      return file
    }
  }
  return null
}

/**
 * Open a file picker dialog for images. Returns the selected File, or null if cancelled.
 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
    input.onchange = () => {
      resolve(input.files?.[0] ?? null)
    }
    // Handle cancel (no reliable 'cancel' event, but clicking away)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
