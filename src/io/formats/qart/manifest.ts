import type { QartManifest, QartLayerManifest } from '../../../types/project.ts'
import type { BlendMode } from '../../../types/layer.ts'

const CURRENT_VERSION = '1.0'
const APP_ID = 'quar-artist'

const VALID_BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'softLight', 'add', 'color', 'luminosity',
]

export function createManifest(
  canvas: { width: number; height: number; dpi: number },
  layers: QartLayerManifest[],
  activeLayerId: string,
  dates?: { createdAt?: string; updatedAt?: string },
): QartManifest {
  const now = new Date().toISOString()
  return {
    version: CURRENT_VERSION,
    app: APP_ID,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      dpi: canvas.dpi,
      colorSpace: 'srgb',
    },
    layers,
    activeLayerId,
    createdAt: dates?.createdAt ?? now,
    updatedAt: dates?.updatedAt ?? now,
  }
}

export interface ManifestValidationResult {
  valid: boolean
  errors: string[]
}

export function validateManifest(data: unknown): ManifestValidationResult {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Manifest is not an object'] }
  }

  const m = data as Record<string, unknown>

  if (typeof m.version !== 'string') {
    errors.push('Missing or invalid "version"')
  }
  if (typeof m.app !== 'string') {
    errors.push('Missing or invalid "app"')
  }

  // Validate canvas
  if (!m.canvas || typeof m.canvas !== 'object') {
    errors.push('Missing "canvas" object')
  } else {
    const c = m.canvas as Record<string, unknown>
    if (typeof c.width !== 'number' || c.width <= 0) errors.push('Invalid canvas width')
    if (typeof c.height !== 'number' || c.height <= 0) errors.push('Invalid canvas height')
    if (typeof c.dpi !== 'number' || c.dpi <= 0) errors.push('Invalid canvas dpi')
  }

  // Validate layers
  if (!Array.isArray(m.layers)) {
    errors.push('Missing "layers" array')
  } else {
    for (let i = 0; i < m.layers.length; i++) {
      const layerErrors = validateLayerManifest(m.layers[i], i)
      errors.push(...layerErrors)
    }
  }

  if (typeof m.activeLayerId !== 'string') {
    errors.push('Missing "activeLayerId"')
  }

  return { valid: errors.length === 0, errors }
}

function validateLayerManifest(data: unknown, index: number): string[] {
  const errors: string[] = []
  const prefix = `layers[${index}]`

  if (!data || typeof data !== 'object') {
    return [`${prefix}: not an object`]
  }

  const l = data as Record<string, unknown>

  if (typeof l.id !== 'string') errors.push(`${prefix}: missing "id"`)
  if (typeof l.name !== 'string') errors.push(`${prefix}: missing "name"`)
  if (typeof l.blendMode !== 'string' || !VALID_BLEND_MODES.includes(l.blendMode as BlendMode)) {
    errors.push(`${prefix}: invalid "blendMode"`)
  }
  if (typeof l.opacity !== 'number' || l.opacity < 0 || l.opacity > 1) {
    errors.push(`${prefix}: invalid "opacity"`)
  }
  if (typeof l.visible !== 'boolean') errors.push(`${prefix}: missing "visible"`)
  if (typeof l.dataFile !== 'string') errors.push(`${prefix}: missing "dataFile"`)

  return errors
}
