/**
 * Utilities for importing images from clipboard paste, file input, and drag-and-drop.
 * Converts image sources to RGBA pixel data (Uint8ClampedArray) with dimensions.
 */
import { get2dContext } from '../utils/canvas2d.ts'
import { pickWithInput } from './files/fileAccess.ts'

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
  const ctx = get2dContext(canvas)
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
 * Open a file picker dialog for images. Returns the selected File, or null if cancelled.
 */
export function pickImageFile(): Promise<File | null> {
  return pickWithInput('image/png,image/jpeg,image/webp,image/gif,image/bmp')
}
