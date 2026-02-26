import { writePsd } from 'ag-psd'
import { quarToPsdBlendMode } from './blendModeMap.ts'
import type { LayerInfo } from '../../../types/layer.ts'

export interface PsdLayerInput {
  info: LayerInfo
  pixels: Uint8ClampedArray
  width: number
  height: number
}

export interface PsdExportInput {
  width: number
  height: number
  layers: PsdLayerInput[]
}

/**
 * Exports project data as a PSD file blob.
 * Passes raw pixel data via imageData to ag-psd (no canvas needed).
 */
export function exportPsd(input: PsdExportInput): Blob {
  const psdLayers = input.layers.map((layer) => ({
    name: layer.info.name,
    opacity: Math.round(layer.info.opacity * 255),
    blendMode: quarToPsdBlendMode(layer.info.blendMode),
    hidden: !layer.info.visible,
    imageData: {
      width: layer.width,
      height: layer.height,
      data: layer.pixels,
    },
    left: 0,
    top: 0,
  }))

  const psd = {
    width: input.width,
    height: input.height,
    children: psdLayers,
  }

  const buffer = writePsd(psd)
  return new Blob([buffer], { type: 'application/octet-stream' })
}
