/**
 * Writing PSD files (plan M1.7): every layer, with its blend mode, opacity,
 * visibility, clipping and locks, the document's resolution, and the
 * composite image that viewers and file browsers show.
 */
import type { Layer, Psd } from './agPsd.ts'
import { writePsdUint8Array } from './agPsd.ts'
import { quarToPsdBlendMode } from './blendModeMap.ts'
import type { LayerInfo } from '../../../types/layer.ts'
import { cutName } from '../qart/manifest.ts'

export const PSD_MIME = 'image/vnd.adobe.photoshop'

export interface PsdWriterInput {
  width: number
  height: number
  dpi: number
  /** Bottom first: straight RGBA8 at the document's size. */
  layers: { info: LayerInfo; pixels: Uint8Array }[]
  activeLayerId: string
  /** The document as the app shows it: straight RGBA8 at its size. */
  composite: Uint8Array
}

/** Where a layer has pixels that aren't fully transparent, or null when it has none. */
export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** The smallest rectangle holding every pixel of `pixels` that isn't fully transparent. */
export function contentBounds(pixels: Uint8Array, width: number, height: number): Bounds | null {
  let top = -1
  let bottom = -1
  let left = width
  let right = 0
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (pixels[row + x * 4 + 3] !== 0) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first < 0) continue
    if (top < 0) top = y
    bottom = y + 1
    left = Math.min(left, first)
    right = Math.max(right, last + 1)
  }
  return top < 0 ? null : { left, top, right, bottom }
}

function crop(pixels: Uint8Array, width: number, { left, top, right, bottom }: Bounds): Uint8ClampedArray {
  const w = right - left
  const out = new Uint8ClampedArray(w * (bottom - top) * 4)
  for (let y = top; y < bottom; y++) {
    const from = (y * width + left) * 4
    out.set(pixels.subarray(from, from + w * 4), (y - top) * w * 4)
  }
  return out
}

function psdLayer({ info, pixels }: PsdWriterInput['layers'][number], id: number, width: number, height: number): Layer {
  const bounds = contentBounds(pixels, width, height)
  return {
    id,
    name: cutName(info.name),
    blendMode: quarToPsdBlendMode(info.blendMode),
    opacity: Math.min(1, Math.max(0, info.opacity)),
    hidden: !info.visible,
    clipping: info.clippingMask,
    transparencyProtected: info.alphaLock,
    // A locked layer can't be painted or moved: Photoshop's image and position locks.
    protected: { transparency: info.alphaLock, composite: info.locked, position: info.locked },
    // Only where it has pixels: an empty layer takes no room.
    ...(bounds ? { ...bounds, imageData: { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, data: crop(pixels, width, bounds) } } : {}),
  }
}

/**
 * The largest PSD file written: Photoshop opens PSD files up to 2 GB, and so
 * does the app. Larger ones need the PSB format, and past 4 GB a PSD file's
 * section lengths, 32 bits, would wrap.
 */
const MAX_FILE_BYTES = 2 ** 31

/**
 * The file with its composite image raw. ag-psd's buffer for the composite's
 * RLE data is too small for an image 1 or 2 px wide, and what doesn't fit is
 * dropped: the file would end before its composite does. With transparency
 * (four channels), colours are matted against white, as Photoshop has them.
 */
function withRawComposite(bytes: Uint8Array, composite: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const channels = view.getUint16(12)
  // The colour mode data, image resources and layer sections, each after its length: 4 bytes in a PSD file.
  let at = 26
  for (let i = 0; i < 3; i++) at += 4 + view.getUint32(at)
  const n = width * height
  const out = new Uint8Array(at + 2 + channels * n)
  out.set(bytes.subarray(0, at))
  // Then compression 0, raw: each channel's plane.
  for (let p = 0; p < n; p++) {
    const a = composite[p * 4 + 3]
    for (let c = 0; c < channels; c++) {
      const v = c === 3 ? a : composite[p * 4 + c]
      out[at + 2 + c * n + p] = c < 3 && channels === 4 && a !== 0 && a !== 255 ? Math.round((v * a) / 255 + 255 - a) : v
    }
  }
  return out
}

/** Write a document as a PSD file, or throw, saying why, when it would be larger than `maxBytes`. */
export function encodePsd(input: PsdWriterInput, maxBytes = MAX_FILE_BYTES): Blob {
  const { width, height, dpi } = input
  const children = input.layers.map((layer, i) => psdLayer(layer, i + 1, width, height))
  const active = input.layers.findIndex((l) => l.info.id === input.activeLayerId)
  const psd: Psd = {
    width,
    height,
    children,
    imageData: { width, height, data: new Uint8ClampedArray(input.composite.buffer, input.composite.byteOffset, input.composite.byteLength) },
    imageResources: {
      resolutionInfo: {
        horizontalResolution: dpi,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: dpi,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches',
      },
      ...(active >= 0 ? { layerSelectionIds: [active + 1] } : {}),
    },
  }
  // Without noBackground, an opaque bottom layer would become Photoshop's Background, which can't move or be transparent.
  let bytes = writePsdUint8Array(psd, { noBackground: true }) as Uint8Array<ArrayBuffer>
  if (width <= 2) bytes = withRawComposite(bytes, input.composite, width, height)
  if (bytes.byteLength > maxBytes) throw new Error('it would be over 2 GB, more than a PSD file holds. Save it as a .qart file instead, or merge some layers')
  return new Blob([bytes], { type: PSD_MIME })
}
