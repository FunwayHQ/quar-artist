import type { BlendMode } from '../../../types/layer.ts'

/**
 * Maps QUAR Artist blend modes to PSD blend mode keys
 * used by the ag-psd library.
 */
const QUAR_TO_PSD: Record<BlendMode, string> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  softLight: 'soft light',
  add: 'linear dodge',
  color: 'color',
  luminosity: 'luminosity',
}

const PSD_TO_QUAR: Record<string, BlendMode> = {}
for (const [quar, psd] of Object.entries(QUAR_TO_PSD)) {
  PSD_TO_QUAR[psd] = quar as BlendMode
}

export function quarToPsdBlendMode(mode: BlendMode): string {
  return QUAR_TO_PSD[mode] ?? 'normal'
}

export function psdToQuarBlendMode(psdMode: string): BlendMode {
  return PSD_TO_QUAR[psdMode] ?? 'normal'
}
