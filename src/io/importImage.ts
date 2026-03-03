/**
 * Utilities for importing images from clipboard paste, file input, and drag-and-drop.
 * Converts image sources to RGBA pixel data (Uint8ClampedArray) with dimensions.
 */
import { get2dContext } from '../utils/canvas2d.ts'

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
    let resolved = false
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
    input.onchange = () => {
      if (resolved) return
      resolved = true
      resolve(input.files?.[0] ?? null)
    }
    input.oncancel = () => {
      if (resolved) return
      resolved = true
      resolve(null)
    }
    // Focus-based fallback for browsers without 'cancel' event on file inputs
    const handleFocus = () => {
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
        window.removeEventListener('focus', handleFocus)
      }, 300)
    }
    window.addEventListener('focus', handleFocus)
    input.click()
  })
}
