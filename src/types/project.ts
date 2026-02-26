import type { BlendMode } from './layer.ts'

export interface ProjectMeta {
  id?: number
  name: string
  width: number
  height: number
  dpi: number
  createdAt: Date
  updatedAt: Date
  thumbnailBlob?: Blob
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

export interface QartManifest {
  version: string
  app: string
  canvas: {
    width: number
    height: number
    dpi: number
    colorSpace: string
  }
  layers: QartLayerManifest[]
  activeLayerId: string
  createdAt: string
  updatedAt: string
}

export interface QartLayerManifest {
  id: string
  name: string
  blendMode: BlendMode
  opacity: number
  visible: boolean
  locked: boolean
  alphaLock: boolean
  clippingMask: boolean
  order: number
  dataFile: string
}
