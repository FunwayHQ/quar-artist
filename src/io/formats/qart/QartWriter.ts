import JSZip from 'jszip'
import { createManifest } from './manifest.ts'
import type { QartLayerManifest } from '../../../types/project.ts'
import type { LayerInfo } from '../../../types/layer.ts'

export interface QartWriterInput {
  name: string
  width: number
  height: number
  dpi: number
  layers: QartWriterLayerInput[]
  activeLayerId: string
  createdAt?: string
  updatedAt?: string
}

export interface QartWriterLayerInput {
  info: LayerInfo
  order: number
  pixels: Uint8Array
}

/**
 * Packages project data into a .qart ZIP archive.
 * Returns a Blob ready for download.
 */
export async function writeQart(input: QartWriterInput): Promise<Blob> {
  const zip = new JSZip()

  // Build layer manifests and add pixel data
  const layerManifests: QartLayerManifest[] = []
  for (const layer of input.layers) {
    const dataFile = `layers/${layer.info.id}.bin`
    layerManifests.push({
      id: layer.info.id,
      name: layer.info.name,
      blendMode: layer.info.blendMode,
      opacity: layer.info.opacity,
      visible: layer.info.visible,
      locked: layer.info.locked,
      alphaLock: layer.info.alphaLock,
      clippingMask: layer.info.clippingMask,
      order: layer.order,
      dataFile,
    })

    zip.file(dataFile, layer.pixels)
  }

  // Build and add manifest
  const manifest = createManifest(
    { width: input.width, height: input.height, dpi: input.dpi },
    layerManifests,
    input.activeLayerId,
    { createdAt: input.createdAt, updatedAt: input.updatedAt },
  )
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: 'blob' })
}
