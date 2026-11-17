import type { BlendMode } from '../../types/layer.ts'
import type { StoredImage } from '../../types/project.ts'
import { asClampedBytes } from '../../utils/typedArrays.ts'

/** Longest side of a Gallery thumbnail, in pixels: sharp at card size on 2× screens. */
export const THUMBNAIL_MAX_SIDE = 400

/** A layer as the thumbnail sees it: straight-alpha RGBA pixels at document size. */
export interface ThumbnailLayer {
  pixels: Uint8Array | Uint8ClampedArray
  opacity: number
  visible: boolean
  blendMode: BlendMode
}

/** The 2D canvas operation closest to each blend mode. Modes it lacks draw as Normal. */
const CANVAS_BLEND: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  darken: 'darken',
  multiply: 'multiply',
  colorBurn: 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  colorDodge: 'color-dodge',
  add: 'lighter',
  overlay: 'overlay',
  softLight: 'soft-light',
  hardLight: 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
}

/** Thumbnail size for a document, keeping its aspect ratio. */
export function thumbnailSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** A canvas to draw on: the page's, or in a worker an OffscreenCanvas. Null where there is neither. */
function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  return typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : null
}

/** How long encoding a thumbnail may take: none rather than one that never comes, which would hold up saving. */
export const THUMBNAIL_ENCODE_MS = 10_000

/**
 * Encode a canvas, or resolve null when it can't be, or takes longer than
 * THUMBNAIL_ENCODE_MS. An OffscreenCanvas encodes with convertToBlob:
 * Firefox's has an old toBlob of its own too, which takes no callback, so
 * waiting for one would never end.
 */
function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  const encoded =
    'convertToBlob' in canvas
      ? canvas.convertToBlob({ type, quality }).catch(() => null)
      : new Promise<Blob | null>((resolve) => {
          try {
            canvas.toBlob(resolve, type, quality)
          } catch {
            resolve(null)
          }
        })
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), THUMBNAIL_ENCODE_MS)))
  return Promise.race([encoded, late]).finally(() => clearTimeout(timer))
}

/** Encode a composited image as a Gallery thumbnail. */
export function encodeThumbnail(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<StoredImage | null> {
  return encodeLayersThumbnail([{ pixels, opacity: 1, visible: true, blendMode: 'normal' }], width, height)
}

/**
 * Composite layers into a thumbnail with the 2D canvas: each visible layer is
 * scaled down and drawn with its opacity and the nearest canvas blend mode.
 * Close enough to preview a project that hasn't been opened in the engine.
 * WebP by default; `type` asks for another format, which browsers that
 * can't encode it replace with PNG. Works in workers too, where they have
 * OffscreenCanvas. Resolves null where there is no 2D canvas (tests) or
 * encoding fails.
 */
export async function encodeLayersThumbnail(
  layers: readonly ThumbnailLayer[],
  width: number,
  height: number,
  type = 'image/webp',
): Promise<StoredImage | null> {
  const size = thumbnailSize(width, height)
  const out = makeCanvas(size.width, size.height)
  const layerCanvas = makeCanvas(width, height)
  const ctx = out?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined
  const layerCtx = layerCanvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined
  if (!out || !layerCanvas || !ctx || !layerCtx) return null

  ctx.imageSmoothingQuality = 'high'
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    layerCtx.putImageData(new ImageData(asClampedBytes(layer.pixels, width * height * 4), width, height), 0, 0)
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = CANVAS_BLEND[layer.blendMode] ?? 'source-over'
    ctx.drawImage(layerCanvas, 0, 0, size.width, size.height)
  }

  // Browsers that can't encode WebP fall back to PNG.
  const blob = await encodeCanvas(out, type, 0.85)
  return blob ? { type: blob.type || 'image/png', data: await blob.arrayBuffer() } : null
}
