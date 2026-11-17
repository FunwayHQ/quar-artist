import type { BlendMode } from './layer.ts'

/**
 * An encoded image kept in IndexedDB as bytes rather than as a Blob, because
 * Safari can't store Blobs in IndexedDB in private windows.
 */
export interface StoredImage {
  /** MIME type, such as image/webp. */
  type: string
  data: ArrayBuffer
}

export interface ProjectMeta {
  id: string
  name: string
  width: number
  height: number
  dpi: number
  createdAt: Date
  updatedAt: Date
  thumbnail?: StoredImage
}

export interface ProjectLayerMeta {
  id: string
  name: string
  blendMode: BlendMode
  opacity: number
  visible: boolean
  locked: boolean
  alphaLock: boolean
  clippingMask: boolean
  order: number
}

export interface CanvasConfig {
  name: string
  width: number
  height: number
  dpi: number
}

/** The colour space a document is painted in. Display P3 needs wide-gamut canvases (plan M7.3). */
export type ColorSpace = 'srgb' | 'display-p3'

/** What the New Project dialog asks for. */
export interface NewProjectConfig extends CanvasConfig {
  colorSpace: ColorSpace
}

/** How the Gallery orders projects and stacks. */
export type GallerySort = 'updated' | 'created' | 'name'

/** DPI values the New Project dialog offers before "Custom". */
export const DPI_PRESETS = [72, 150, 300, 600] as const

export const CANVAS_PRESETS: { label: string; width: number; height: number; dpi: number }[] = [
  { label: '1080 × 1080 (Square)', width: 1080, height: 1080, dpi: 72 },
  { label: '1920 × 1080 (HD)', width: 1920, height: 1080, dpi: 72 },
  { label: '2048 × 2048', width: 2048, height: 2048, dpi: 72 },
  { label: '4096 × 4096', width: 4096, height: 4096, dpi: 72 },
  { label: 'A4 300 DPI', width: 2480, height: 3508, dpi: 300 },
  { label: 'A4 150 DPI', width: 1240, height: 1754, dpi: 150 },
]

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'psd' | 'qart'
  jpegQuality: number
}
