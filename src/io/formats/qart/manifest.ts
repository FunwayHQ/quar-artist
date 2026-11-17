import { ALL_BLEND_MODES, type BlendMode, type LayerInfo } from '../../../types/layer.ts'
import type { ColorSpace } from '../../../types/project.ts'
import { TILE_SIZE } from '../../../utils/tiles.ts'

/**
 * Version 1 of the .qart format (plan M1.6): a ZIP archive with the
 * document's manifest, its layers in 256 × 256 tiles and a thumbnail.
 * Described in docs/qart-format.md.
 */
export const QART_FORMAT = 'qart'
export const QART_FORMAT_VERSION = 1
/** The `version` of the draft layout written before version 1 (plan M1.5): whole layers, straight alpha. */
export const DRAFT_VERSION = '1.0'
export const QART_MIME = 'application/x-quar-artist'
export const QART_APP_NAME = 'QUAR Artist'

export const MANIFEST_ENTRY = 'manifest.json'
export const THUMBNAIL_ENTRY = 'thumbnail.png'
export const TILE_CODEC = 'raw'

/** Limits every reader enforces (docs/qart-format.md). */
export const MAX_MANIFEST_BYTES = 1 << 20
export const MAX_FILE_LAYERS = 1000
export const MAX_FILE_SIDE = 16384
export const MAX_DPI = 10000
/** Longer names are cut to this many characters when read. */
export const MAX_NAME_LENGTH = 256

/** A layer id as the format allows it: it names the layer's tile folder. */
export const LAYER_ID = /^[A-Za-z0-9_-]{1,64}$/
const COLOR_SPACES: readonly string[] = ['srgb', 'display-p3'] satisfies ColorSpace[]
const BLEND_MODES: ReadonlySet<string> = new Set(ALL_BLEND_MODES)

/**
 * Why a .qart file can't be read or written. The message ends the sentence
 * "Couldn't open “x.qart”: …", so it starts in lower case.
 */
export class QartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QartError'
  }
}

export function damaged(detail: string): QartError {
  return new QartError(`it is damaged (${detail})`)
}

export function notQart(): QartError {
  return new QartError("it isn't a .qart file")
}

export function tooLarge(): QartError {
  return new QartError('it is too large to open on this device')
}

/** A layer in the manifest. */
export interface QartManifestLayer {
  type: 'layer'
  id: string
  name: string
  blendMode: BlendMode
  opacity: number
  visible: boolean
  locked: boolean
  alphaLock: boolean
  clippingMask: boolean
}

/** `manifest.json` as version 1 writes it. */
export interface QartManifest {
  format: typeof QART_FORMAT
  formatVersion: typeof QART_FORMAT_VERSION
  app: { name: string; version: string }
  name: string
  createdAt?: string
  updatedAt?: string
  canvas: { width: number; height: number; dpi: number; colorSpace: ColorSpace }
  tiles: { size: number; format: 'rgba8'; alpha: 'premultiplied'; codec: typeof TILE_CODEC }
  /** Bottom first. */
  layers: QartManifestLayer[]
  activeLayerId: string
  guides: unknown
  thumbnail: string | null
  timelapse: null
}

/** What goes into a manifest. The layers' ids are unique and valid (`LAYER_ID`), and the active one is among them. */
export interface ManifestInput {
  name: string
  width: number
  height: number
  dpi: number
  colorSpace: ColorSpace
  /** Bottom first. */
  layers: readonly LayerInfo[]
  activeLayerId: string
  guides?: unknown
  createdAt?: string
  updatedAt?: string
  /** Whether the file has a thumbnail. */
  thumbnail: boolean
}

/** A name as files keep it: at most MAX_NAME_LENGTH UTF-16 units, without cutting a character in two. */
export function cutName(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name
  const cut = name.slice(0, MAX_NAME_LENGTH)
  // A high surrogate at the end is the first half of a character.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

export function createManifest(input: ManifestInput): QartManifest {
  return {
    format: QART_FORMAT,
    formatVersion: QART_FORMAT_VERSION,
    app: { name: QART_APP_NAME, version: __APP_VERSION__ },
    name: cutName(input.name),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    canvas: { width: input.width, height: input.height, dpi: input.dpi, colorSpace: input.colorSpace },
    tiles: { size: TILE_SIZE, format: 'rgba8', alpha: 'premultiplied', codec: TILE_CODEC },
    layers: input.layers.map((l) => ({
      type: 'layer',
      id: l.id,
      name: cutName(l.name),
      blendMode: l.blendMode,
      opacity: l.opacity,
      visible: l.visible,
      locked: l.locked,
      alphaLock: l.alphaLock,
      clippingMask: l.clippingMask,
    })),
    activeLayerId: input.activeLayerId,
    guides: input.guides ?? null,
    thumbnail: input.thumbnail ? THUMBNAIL_ENTRY : null,
    timelapse: null,
  }
}

/** A layer as the manifest describes it. */
export interface ParsedLayer {
  info: LayerInfo
  /** The draft layout only: the entry that holds the layer's pixels. */
  dataFile?: string
}

/** A manifest as read and checked, from either layout. */
export interface ParsedManifest {
  /** 1, or 0 for the draft layout written before version 1. */
  formatVersion: number
  /** The project's name when the file was written, or null when the file doesn't say. */
  name: string | null
  width: number
  height: number
  dpi: number
  colorSpace: ColorSpace
  /** Bottom first. */
  layers: ParsedLayer[]
  /** One of the layers' ids. */
  activeLayerId: string
  /** The guides as the file has them, for `savedGuides` to check, or null. */
  guides: unknown
  createdAt?: string
  updatedAt?: string
}

type Fields = Record<string, unknown>

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function wholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function shortText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 64 ? value : undefined
}

/**
 * Check a parsed `manifest.json`, of version 1 or of the draft layout, and
 * give what it describes. Throws a QartError saying what is wrong.
 */
export function parseManifest(data: unknown): ParsedManifest {
  if (!isObject(data)) throw damaged("its manifest isn't an object")
  if ('formatVersion' in data || data.format === QART_FORMAT) return parseVersion1(data)
  if (data.version === DRAFT_VERSION) return parseDraft(data)
  throw damaged('its manifest has no format version')
}

function parseVersion1(m: Fields): ParsedManifest {
  const version = m.formatVersion
  if (typeof version === 'number' && Number.isInteger(version) && version > QART_FORMAT_VERSION) {
    throw new QartError(`it was saved by a newer version of QUAR Artist (format version ${version})`)
  }
  if (m.format !== QART_FORMAT || version !== QART_FORMAT_VERSION) throw damaged('its manifest has an unknown format version')

  const { width, height, dpi, colorSpace } = checkCanvas(m.canvas)
  if (!COLOR_SPACES.includes(colorSpace as string)) throw damaged('its colour space is unknown')
  const t = m.tiles
  if (!isObject(t) || t.size !== TILE_SIZE || t.format !== 'rgba8' || t.alpha !== 'premultiplied' || t.codec !== TILE_CODEC) {
    throw damaged("its tiles are stored in a way QUAR Artist can't read")
  }

  const layers = checkLayerList(m.layers).map((raw, i): ParsedLayer => {
    const where = `layer ${i + 1}`
    if (!isObject(raw) || raw.type !== 'layer') throw damaged(`${where} isn't a layer`)
    if (typeof raw.id !== 'string' || !LAYER_ID.test(raw.id)) throw damaged(`${where} has no valid id`)
    for (const flag of ['visible', 'locked', 'alphaLock', 'clippingMask']) {
      if (typeof raw[flag] !== 'boolean') throw damaged(`${where} has no valid “${flag}”`)
    }
    return { info: checkLayer(raw, where, raw.id) }
  })
  uniqueIds(layers)
  const activeLayerId = m.activeLayerId
  if (typeof activeLayerId !== 'string' || !layers.some((l) => l.info.id === activeLayerId)) {
    throw damaged('its selected layer is none of its layers')
  }

  return {
    formatVersion: QART_FORMAT_VERSION,
    name: typeof m.name === 'string' ? cutName(m.name) : null,
    width,
    height,
    dpi,
    colorSpace: colorSpace as ColorSpace,
    layers,
    activeLayerId,
    guides: isObject(m.guides) ? m.guides : null,
    ...dates(m),
  }
}

/** The draft layout: whole layers in entries the manifest names, ordered by `order`. */
function parseDraft(m: Fields): ParsedManifest {
  const { width, height, dpi, colorSpace } = checkCanvas(m.canvas)
  const files = new Set<string>()
  const layers = checkLayerList(m.layers)
    .map((raw, i) => {
      const where = `layer ${i + 1}`
      if (!isObject(raw)) throw damaged(`${where} isn't a layer`)
      if (typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_NAME_LENGTH) throw damaged(`${where} has no valid id`)
      const dataFile = raw.dataFile
      if (typeof dataFile !== 'string' || dataFile === '') throw damaged(`${where} names no entry for its pixels`)
      if (files.has(dataFile)) throw damaged(`two layers keep their pixels in “${dataFile}”`)
      files.add(dataFile)
      const order = raw.order === undefined ? i : raw.order
      if (!numberIn(order, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) throw damaged(`${where} has no valid order`)
      if (typeof raw.visible !== 'boolean') throw damaged(`${where} has no valid “visible”`)
      return { layer: { info: checkLayer(raw, where, raw.id), dataFile }, order }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ layer }) => layer)
  uniqueIds(layers)
  // The draft writer always named one of its layers; a file that doesn't opens on its top layer.
  const named = layers.find((l) => l.info.id === m.activeLayerId)
  return {
    formatVersion: 0,
    name: null,
    width,
    height,
    dpi,
    colorSpace: colorSpace === 'display-p3' ? 'display-p3' : 'srgb',
    layers,
    activeLayerId: (named ?? layers[layers.length - 1]).info.id,
    guides: null,
    ...dates(m),
  }
}

function checkCanvas(canvas: unknown): { width: number; height: number; dpi: number; colorSpace: unknown } {
  if (!isObject(canvas)) throw damaged('its manifest has no canvas')
  const { width, height, dpi, colorSpace } = canvas
  if (!wholeNumber(width, 1, MAX_FILE_SIDE) || !wholeNumber(height, 1, MAX_FILE_SIDE)) {
    throw damaged(`its canvas size isn't whole numbers from 1 to ${MAX_FILE_SIDE} px`)
  }
  if (!numberIn(dpi, 1, MAX_DPI)) throw damaged(`its resolution isn't from 1 to ${MAX_DPI} dpi`)
  return { width, height, dpi, colorSpace }
}

function checkLayerList(layers: unknown): unknown[] {
  if (!Array.isArray(layers)) throw damaged('its manifest has no layers')
  if (layers.length === 0) throw new QartError('it has no layers')
  if (layers.length > MAX_FILE_LAYERS) throw damaged(`it has more than ${MAX_FILE_LAYERS} layers`)
  return layers
}

/** A layer's properties, checked. The draft layout may leave out the locks and clipping. */
function checkLayer(raw: Fields, where: string, id: string): LayerInfo {
  if (typeof raw.name !== 'string') throw damaged(`${where} has no name`)
  if (typeof raw.blendMode !== 'string' || !BLEND_MODES.has(raw.blendMode)) throw damaged(`${where} has an unknown blend mode`)
  if (!numberIn(raw.opacity, 0, 1)) throw damaged(`${where}'s opacity isn't from 0 to 1`)
  return {
    id,
    name: cutName(raw.name),
    blendMode: raw.blendMode as BlendMode,
    opacity: raw.opacity,
    visible: raw.visible === true,
    locked: raw.locked === true,
    alphaLock: raw.alphaLock === true,
    clippingMask: raw.clippingMask === true,
  }
}

function uniqueIds(layers: readonly ParsedLayer[]) {
  const ids = new Set<string>()
  for (const { info } of layers) {
    if (ids.has(info.id)) throw damaged(`two layers have the id “${info.id}”`)
    ids.add(info.id)
  }
}

function dates(m: Fields): { createdAt?: string; updatedAt?: string } {
  const createdAt = shortText(m.createdAt)
  const updatedAt = shortText(m.updatedAt)
  return { ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) }
}
