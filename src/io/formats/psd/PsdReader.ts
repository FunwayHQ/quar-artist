/**
 * Reading PSD and PSB files (plan M1.7): the layers as QUAR Artist has them,
 * at the document's size, in straight RGBA8. ag-psd reads the file's
 * structure; the pixels are decoded here (psdPixels.ts).
 *
 * - Groups are flattened until the app has them (plan M7.1): their layers
 *   become plain ones, hidden with the group and at its opacity.
 * - Layer masks are applied to the layer's pixels. So is a Color Overlay
 *   in Normal mode on a Normal layer: Photoshop draws it over the layer, as
 *   a clipped layer would be, which only differs at soft edges.
 * - Adjustment layers, other layer effects, vector masks without pixels and
 *   groups' masks are left out, and counted, so the app can say what didn't
 *   come with the file.
 * - 16- and 32-bit files become 8-bit.
 *
 * Everything that sizes memory (the canvas, each layer, each mask) is
 * checked before any pixels are decoded, and so are RLE channels' byte
 * counts. A ZIP channel is refused as soon as it unpacks past its size.
 */
import type { Layer, LayerEffectSolidFill, LayerMaskData, Psd } from './agPsd.ts'
import { readPsd } from './agPsd.ts'
import { quarBlendModeOf } from './blendModeMap.ts'
import { decodeChannel, decodeImagePlanes, rleFits, type ChannelData, type SampleKind } from './psdPixels.ts'
import type { BlendMode } from '../../../types/layer.ts'
import { MAX_DPI, cutName } from '../qart/manifest.ts'

/**
 * Why a PSD file can't be opened. The message ends the sentence
 * "Couldn't open “x.psd”: …", so it starts in lower case.
 */
export class PsdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PsdError'
  }
}

export interface PsdLimits {
  /** A file with more layers, once its groups are flattened, is refused. */
  maxLayers?: number
  /** A file whose width or height is larger is refused; so is a layer or mask with more pixels than a canvas this size. */
  maxSide?: number
  /** A file whose layers would take more memory (layers × width × height × 4 bytes) is refused. */
  maxBytes?: number
}

export interface PsdLayer {
  name: string
  blendMode: BlendMode
  opacity: number
  visible: boolean
  locked: boolean
  alphaLock: boolean
  clippingMask: boolean
  /** Straight RGBA8 at the document's size. */
  pixels: Uint8Array<ArrayBuffer>
}

/** What a file has that the app doesn't, and so didn't come with it. */
export interface PsdNotes {
  /** Groups, whose layers became plain layers. */
  groups: number
  /** Adjustment layers, left out. */
  adjustments: number
  /** Layers and groups whose effects (shadows, strokes, glows…) were left out. A Normal Color Overlay comes with its layer. */
  effects: number
  /** Layers whose vector masks were left out. */
  vectorMasks: number
  /** Groups whose masks were left out: what they hide shows. */
  groupMasks: number
  /** Blend modes the app doesn't have, by their PSD names: their layers became Normal. */
  blendModes: string[]
}

export interface PsdDocument {
  width: number
  height: number
  dpi: number
  /** Bottom first. */
  layers: PsdLayer[]
  /** The selected layer's index in `layers`. */
  activeLayer: number
  notes: PsdNotes
}

/**
 * ag-psd reads on past the end of a file with a zero-filled buffer of the
 * size the file claims, up to 100 MB, and keeps some of them: a file of a
 * few hundred bytes could make it hold gigabytes. In debug mode it says so
 * first, and the reader stops it there: the file is damaged. Its other
 * warnings are about files it reads anyway, and the app says what it
 * couldn't open in toasts, not on the console.
 */
const PAST_THE_END = 'Reading bytes exceeding buffer length'
const PARSE = {
  debug: true,
  log: (message: unknown) => {
    if (message === PAST_THE_END) throw new Error(PAST_THE_END)
  },
}

/** The largest PSD files open (PSB files can be larger): one ArrayBuffer holds the file. */
export const MAX_PSD_FILE_BYTES = 2 ** 31
/** The format's own largest canvas: 30,000 px for PSD, 300,000 for PSB. Readers refuse larger. */
const FORMAT_MAX_SIDE = { 1: 30_000, 2: 300_000 } as const
const HEADER_SIZE = 26
/** The colour modes ag-psd reads: Bitmap, Grayscale, Indexed and RGB. */
const READABLE_MODES = new Set([0, 1, 2, 3])
/** The others, by their numbers in the format. */
const UNREADABLE_MODES: Partial<Record<number, string>> = { 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' }
const GRAYSCALE = 1
const INDEXED = 2
const RGB = 3

function tooLarge(): PsdError {
  return new PsdError('it is too large to open on this device')
}

function damaged(): PsdError {
  return new PsdError("it isn't a PSD file, or it is damaged")
}

interface Header {
  version: 1 | 2
  /** Channels in the composite image. */
  channels: number
  width: number
  height: number
  depth: number
  colorMode: number
}

/** The file's header, checked: what it is and how large, before the rest is read. */
function readHeader(bytes: Uint8Array, maxSide: number): Header {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < HEADER_SIZE || String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS') throw damaged()
  const version = view.getUint16(4)
  if (version !== 1 && version !== 2) throw damaged()
  const channels = view.getUint16(12)
  const height = view.getUint32(14)
  const width = view.getUint32(18)
  const depth = view.getUint16(22)
  const colorMode = view.getUint16(24)
  if (channels < 1 || width < 1 || height < 1 || width > FORMAT_MAX_SIDE[version] || height > FORMAT_MAX_SIDE[version]) throw damaged()
  if (![1, 8, 16, 32].includes(depth)) throw damaged()
  if (!READABLE_MODES.has(colorMode)) {
    const mode = UNREADABLE_MODES[colorMode]
    if (!mode) throw damaged()
    throw new PsdError(`it is in ${mode} color, which QUAR Artist can't open. Convert it to RGB in the app that made it, then open it again`)
  }
  if (width > maxSide || height > maxSide) throw tooLarge()
  return { version, channels, width, height, depth, colorMode }
}

/** A Color Overlay effect in Normal mode: within the layer, its colour over the layer's at its opacity. */
interface Overlay {
  rgb: [number, number, number]
  opacity: number
}

interface Flat {
  layer: Layer
  visible: boolean
  opacity: number
  /** Bottom first. */
  overlays: Overlay[]
}

const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)))

function overlayOf(fill: LayerEffectSolidFill): Overlay | null {
  if ((fill.blendMode ?? 'normal') !== 'normal') return null
  const c = fill.color as Partial<Record<'r' | 'g' | 'b' | 'fr' | 'fg' | 'fb', number>> | undefined
  if (c?.r !== undefined && c.g !== undefined && c.b !== undefined) {
    return { rgb: [byte(c.r), byte(c.g), byte(c.b)], opacity: Math.min(1, Math.max(0, fill.opacity ?? 1)) }
  }
  if (c?.fr !== undefined && c.fg !== undefined && c.fb !== undefined) {
    return { rgb: [byte(c.fr * 255), byte(c.fg * 255), byte(c.fb * 255)], opacity: Math.min(1, Math.max(0, fill.opacity ?? 1)) }
  }
  return null
}

/**
 * A layer's effects that are on: the Color Overlays its pixels can take on,
 * and whether it has others, which are left out. Only a Normal layer, at
 * full fill opacity, takes on an overlay: its blend mode and fill opacity
 * don't apply to its effects.
 */
function effectsOf(layer: Layer): { overlays: Overlay[]; others: boolean } {
  const overlays: Overlay[] = []
  let others = false
  const effects = layer.effects
  if (!effects || effects.disabled) return { overlays, others }
  const takesOverlays = (layer.blendMode ?? 'normal') === 'normal' && (layer.fillOpacity ?? 1) === 1
  for (const [key, value] of Object.entries(effects)) {
    // The dialog lists several of a kind top first.
    for (const effect of (Array.isArray(value) ? value : [value]).slice().reverse()) {
      if (typeof effect !== 'object' || effect === null || (effect as { enabled?: unknown }).enabled === false) continue
      const overlay = key === 'solidFill' && takesOverlays ? overlayOf(effect as LayerEffectSolidFill) : null
      if (overlay) overlays.push(overlay)
      else others = true
    }
  }
  return { overlays, others }
}

interface Rect {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

const widthOf = (r: Rect) => (r.right ?? 0) - (r.left ?? 0)
const heightOf = (r: Rect) => (r.bottom ?? 0) - (r.top ?? 0)

/** The mask a layer shows with: its real user mask (user and vector masks together) where it has one, else its user mask. */
function maskOf(layer: Layer): LayerMaskData | null {
  for (const mask of [layer.realMask, layer.mask]) {
    if (mask && !mask.disabled && widthOf(mask) > 0 && heightOf(mask) > 0) return mask
  }
  // Without pixels a mask is all its default colour: white shows the layer, black hides it.
  for (const mask of [layer.realMask, layer.mask]) if (mask && !mask.disabled) return mask
  return null
}

/** Whether a group's masks hide anything: a vector mask, or a mask with pixels or black around them. */
function maskHides(group: Layer): boolean {
  if (group.vectorMask && !group.vectorMask.disable) return true
  const mask = maskOf(group)
  return mask !== null && ((widthOf(mask) > 0 && heightOf(mask) > 0) || (mask.defaultColor ?? 0) < 255)
}

/** A group being walked: its layers, bottom first, and the next one's index. */
interface Walk {
  layers: readonly Layer[]
  next: number
  visible: boolean
  opacity: number
}

/**
 * Groups' layers, bottom first, as plain layers: hidden with their group
 * and at its opacity. Walked without recursion, as groups in a file can be
 * nested thousands deep.
 */
function flatten(children: readonly Layer[] | undefined, notes: PsdNotes): Flat[] {
  const out: Flat[] = []
  const walks: Walk[] = [{ layers: children ?? [], next: 0, visible: true, opacity: 1 }]
  while (walks.length > 0) {
    const group = walks[walks.length - 1]
    if (group.next >= group.layers.length) {
      walks.pop()
      continue
    }
    const layer = group.layers[group.next++]
    const shown = group.visible && !layer.hidden
    if (layer.children) {
      notes.groups++
      const { overlays, others } = effectsOf(layer)
      if (others || overlays.length > 0) notes.effects++
      if (maskHides(layer)) notes.groupMasks++
      walks.push({ layers: layer.children, next: 0, visible: shown, opacity: group.opacity * (layer.opacity ?? 1) })
      continue
    }
    if (layer.adjustment) {
      notes.adjustments++
      continue
    }
    const { overlays, others } = effectsOf(layer)
    if (others) notes.effects++
    const mask = maskOf(layer)
    if (layer.vectorMask && !layer.vectorMask.disable && !(mask && (mask === layer.realMask || mask.fromVectorData))) {
      notes.vectorMasks++
    }
    const mode = layer.blendMode ?? 'normal'
    if (!quarBlendModeOf(mode) && !notes.blendModes.includes(mode)) notes.blendModes.push(mode)
    // Fill opacity is the layer's opacity without its effects, which are left out: the two multiply.
    out.push({ layer, visible: shown, opacity: group.opacity * (layer.opacity ?? 1) * (layer.fillOpacity ?? 1), overlays })
  }
  return out
}

/** A channel the app shows, with the size of its rectangle. */
interface Plane {
  /** -1 transparency, 0–2 colour, -2 or -3 the mask. */
  id: number
  channel: ChannelData
  width: number
  height: number
  kind: SampleKind
}

/** A layer's channels that the app shows: its colours, its transparency and the mask it shows with. The rest aren't decoded. */
function planesOf(layer: Layer, colorMode: number): Plane[] {
  const mask = maskOf(layer)
  const maskId = mask === null ? null : mask === layer.realMask ? -3 : -2
  const colours = colorMode === RGB ? 3 : 1
  const planes: Plane[] = []
  for (const { id, compression, data } of layer.rawData?.channels ?? []) {
    const rect = id === -1 || (id >= 0 && id < colours) ? layer : id === maskId ? mask : null
    if (!data || !rect || widthOf(rect) <= 0 || heightOf(rect) <= 0) continue
    planes.push({ id, channel: { compression, data }, width: widthOf(rect), height: heightOf(rect), kind: id >= 0 ? 'colour' : 'alpha' })
  }
  return planes
}

/**
 * Refuse a layer whose pixels or mask would take more memory than a canvas
 * of `maxSide`, or whose RLE channels claim more data than they have: they
 * are walked as their byte counts say.
 */
function checkLayer(layer: Layer, header: Header, maxSide: number) {
  for (const r of [layer, layer.mask, layer.realMask]) {
    if (!r) continue
    if (widthOf(r) < 0 || heightOf(r) < 0) throw damaged()
    if (widthOf(r) * heightOf(r) > maxSide * maxSide) throw tooLarge()
  }
  for (const { channel, height } of planesOf(layer, header.colorMode)) {
    if (channel.compression === 1 && !rleFits(channel.data, height, header.version === 2)) throw damaged()
  }
}

function decodePlane({ channel, width, height, kind }: Plane, header: Header): Uint8Array {
  try {
    return decodeChannel(channel, width, height, header.depth, header.version === 2, kind)
  } catch {
    throw damaged()
  }
}

/** A layer's pixels at the document's size, cut where it lies outside: grey and indexed colours as RGB. */
function layerPixels(layer: Layer, header: Header, palette: Psd['palette']): Uint8Array<ArrayBuffer> {
  const { width, height, colorMode } = header
  const pixels = new Uint8Array(width * height * 4)
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const w = widthOf(layer)
  const x0 = Math.max(0, left)
  const y0 = Math.max(0, top)
  const x1 = Math.min(width, left + w)
  const y1 = Math.min(height, top + heightOf(layer))
  if (x0 >= x1 || y0 >= y1) return pixels
  const planes = new Map<number, Uint8Array>()
  for (const plane of planesOf(layer, colorMode)) if (plane.id >= -1) planes.set(plane.id, decodePlane(plane, header))
  const [r, g, b, a] = [planes.get(0), planes.get(1), planes.get(2), planes.get(-1)]
  for (let y = y0; y < y1; y++) {
    let s = (y - top) * w + (x0 - left)
    for (let d = (y * width + x0) * 4, end = (y * width + x1) * 4; d < end; d += 4, s++) {
      const v = r ? r[s] : 0
      if (colorMode === RGB) {
        pixels[d] = v
        pixels[d + 1] = g ? g[s] : 0
        pixels[d + 2] = b ? b[s] : 0
      } else if (colorMode === INDEXED) {
        const c = palette?.[v]
        pixels[d] = c?.r ?? 0
        pixels[d + 1] = c?.g ?? 0
        pixels[d + 2] = c?.b ?? 0
      } else {
        pixels[d] = pixels[d + 1] = pixels[d + 2] = v
      }
      pixels[d + 3] = a ? a[s] : 255
    }
  }
  return pixels
}

/** Give a layer's pixels the colour of its Color Overlays, keeping their alpha. */
function applyOverlays(pixels: Uint8Array, overlays: readonly Overlay[]) {
  for (const { rgb, opacity } of overlays) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] + (rgb[c] - pixels[i + c]) * opacity)
    }
  }
}

/** Apply a layer's mask to the alpha of its document-sized pixels: black hides, white shows. */
function applyMask(pixels: Uint8Array, layer: Layer, mask: LayerMaskData, header: Header) {
  const { width, height } = header
  const plane = planesOf(layer, header.colorMode).find((p) => p.id < -1)
  const values = plane ? decodePlane(plane, header) : null
  const density = mask.userMaskDensity ?? 1
  const shown = (m: number) => 255 - density * (255 - m)
  const outside = shown(mask.defaultColor ?? 0)
  const left = mask.left ?? 0
  const top = mask.top ?? 0
  const w = plane ? plane.width : 0
  const h = plane ? plane.height : 0
  for (let y = 0; y < height; y++) {
    const my = y - top
    for (let x = 0; x < width; x++) {
      const mx = x - left
      const m = values && mx >= 0 && my >= 0 && mx < w && my < h ? shown(values[my * w + mx]) : outside
      if (m >= 255) continue
      const a = (y * width + x) * 4 + 3
      pixels[a] = Math.round((pixels[a] * m) / 255)
    }
  }
}

/** The resolution. PSD files keep it in pixels per inch, whatever unit Photoshop shows it in. */
function dpiOf(psd: Psd): number {
  const ppi = psd.imageResources?.resolutionInfo?.horizontalResolution
  if (!ppi || !(ppi > 0)) return 72
  return Math.min(MAX_DPI, Math.max(1, Math.round(ppi)))
}

function plainLayer(name: string, pixels: Uint8Array<ArrayBuffer>): PsdLayer {
  return { name, blendMode: 'normal', opacity: 1, visible: true, locked: false, alphaLock: false, clippingMask: false, pixels }
}

/**
 * Where a file's composite image starts, and whether its first channel
 * past the colours is the composite's transparency: a negative layer count
 * says so (16- and 32-bit files keep it in their Lr16 or Lr32 block). Any
 * other extra channel is a saved selection, which Photoshop shows nothing of.
 */
function compositeOf(bytes: Uint8Array, version: 1 | 2): { start: number; transparent: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = version === 2 ? 8 : 4
  const lengthAt = (at: number, eight: boolean) => (eight ? view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4) : view.getUint32(at))
  let at = HEADER_SIZE
  const section = (eight: boolean) => {
    if (at + (eight ? 8 : 4) > bytes.length) throw damaged()
    const start = at + (eight ? 8 : 4)
    const length = lengthAt(at, eight)
    at = start + length
    if (at > bytes.length) throw damaged()
    return { start, length }
  }
  section(false) // colour mode data
  section(false) // image resources
  const layers = section(version === 2)
  let transparent = false
  if (layers.length >= size + 2) {
    const info = lengthAt(layers.start, version === 2)
    if (info >= 2) {
      transparent = view.getInt16(layers.start + size) < 0
    } else if (layers.start + size + 4 <= at) {
      // No layer info here: then the global layer mask info, then the blocks, of which Photoshop puts Lr16 or Lr32 first.
      const block = layers.start + size + 4 + view.getUint32(layers.start + size)
      const key = block + 12 <= at ? String.fromCharCode(...bytes.subarray(block + 4, block + 8)) : ''
      const count = block + 8 + size
      if ((key === 'Lr16' || key === 'Lr32') && count + 2 <= at) transparent = view.getInt16(count) < 0
    }
  }
  return { start: at, transparent }
}

/** Photoshop mattes a composite with transparency against white: undo it, as ag-psd does. */
function unmatte(pixels: Uint8Array) {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a === 0 || a === 255) continue
    for (let c = 0; c < 3; c++) pixels[i + c] = byte(((pixels[i + c] - (255 - a)) * 255) / a)
  }
}

/** A flat file's one image, or the composite of one whose layers have nothing the app can show. */
function compositeLayer(bytes: Uint8Array, header: Header): PsdLayer {
  const { width, height, colorMode, channels } = header
  const pixels = new Uint8Array(width * height * 4)
  if (colorMode === RGB || colorMode === GRAYSCALE) {
    const colours = colorMode === RGB ? 3 : 1
    const { start, transparent } = compositeOf(bytes, header.version)
    const alpha = transparent && channels > colours
    const wanted = Array.from({ length: colours + (alpha ? 1 : 0) }, (_, index) => ({ index, kind: (index < colours ? 'colour' : 'alpha') as SampleKind }))
    let planes: Uint8Array[]
    try {
      planes = decodeImagePlanes(bytes.subarray(start), { ...header, large: header.version === 2 }, wanted)
    } catch {
      throw damaged()
    }
    const [r, g = r, b = r, a] = colorMode === RGB ? planes : [planes[0], planes[0], planes[0], planes[1]]
    for (let s = 0, d = 0; s < width * height; s++, d += 4) {
      pixels[d] = r[s]
      pixels[d + 1] = g[s]
      pixels[d + 2] = b[s]
      pixels[d + 3] = a ? a[s] : 255
    }
    if (alpha) unmatte(pixels)
  } else {
    // Bitmap and Indexed images, which are 1- and 8-bit only: ag-psd's.
    let composite: Psd['imageData']
    try {
      composite = readPsd(bytes, { ...PARSE, useImageData: true, skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true }).imageData
    } catch {
      throw damaged()
    }
    if (composite) pixels.set(composite.data.subarray(0, pixels.length))
  }
  return plainLayer('Background', pixels)
}

function noNotes(): PsdNotes {
  return { groups: 0, adjustments: 0, effects: 0, vectorMasks: 0, groupMasks: 0, blendModes: [] }
}

/**
 * The file's structure, as ag-psd reads it, without a pixel decoded: with
 * each layer's channels as they are in the file, or without them. Told to
 * skip the composite, ag-psd still decodes it unless it skips the layers'
 * channels too or the file has layers: so a file is read without them
 * first, and again with them when it has layers to decode.
 */
function parse(bytes: Uint8Array, channels: boolean): Psd {
  try {
    return readPsd(bytes, {
      ...PARSE,
      useImageData: true,
      useRawData: true,
      skipLayerImageData: !channels,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
    })
  } catch {
    throw damaged()
  }
}

/**
 * Read a PSD or PSB file. Refuses, with a PsdError saying why, one this
 * device can't open: too large, with more layers than `maxLayers`, in a
 * colour mode the app doesn't have, or not a PSD file at all.
 */
export async function decodePsd(file: Blob, { maxLayers = Infinity, maxSide = 30_000, maxBytes = 2 ** 32 }: PsdLimits = {}): Promise<PsdDocument> {
  if (file.size > MAX_PSD_FILE_BYTES) throw tooLarge()
  const header = readHeader(new Uint8Array(await file.slice(0, HEADER_SIZE).arrayBuffer()), maxSide)
  const { width, height } = header
  const bytes = new Uint8Array(await file.arrayBuffer())
  const structure = parse(bytes, false)
  if (structure.width !== width || structure.height !== height) throw damaged()

  const notes = noNotes()
  const shown = flatten(structure.children, notes).length
  const count = Math.max(1, shown)
  if (count > maxLayers) {
    throw new PsdError(`it has ${count} layers, and QUAR Artist can have up to ${maxLayers}. Merge some in the app that made it, then open it again`)
  }
  if (count * width * height * 4 > maxBytes) throw tooLarge()
  if (shown === 0) {
    return { width, height, dpi: dpiOf(structure), layers: [compositeLayer(bytes, header)], activeLayer: 0, notes }
  }

  // Again, now with the layers' channels: the same layers.
  const psd = parse(bytes, true)
  const flat = flatten(psd.children, noNotes())
  if (flat.length !== shown) throw damaged()
  for (const { layer } of flat) checkLayer(layer, header, maxSide)

  const selected = new Set(psd.imageResources?.layerSelectionIds ?? [])
  let activeLayer = flat.length - 1
  const layers = flat.map(({ layer, visible, opacity, overlays }, i): PsdLayer => {
    const pixels = layerPixels(layer, header, psd.palette)
    applyOverlays(pixels, overlays)
    const mask = maskOf(layer)
    if (mask) applyMask(pixels, layer, mask, header)
    // Done with: only the document-sized pixels stay.
    delete layer.rawData
    if (layer.id !== undefined && selected.has(layer.id)) activeLayer = i
    return {
      name: cutName(layer.name ?? '') || `Layer ${i + 1}`,
      blendMode: quarBlendModeOf(layer.blendMode ?? 'normal') ?? 'normal',
      opacity: Math.min(1, Math.max(0, opacity)),
      visible,
      locked: layer.protected?.composite ?? false,
      alphaLock: layer.protected?.transparency ?? layer.transparencyProtected ?? false,
      clippingMask: layer.clipping ?? false,
      pixels,
    }
  })
  return { width, height, dpi: dpiOf(psd), layers, activeLayer, notes }
}
