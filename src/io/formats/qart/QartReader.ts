import JSZip from 'jszip'
import { validateManifest } from './manifest.ts'
import type { QartManifest, QartLayerManifest } from '../../../types/project.ts'

export interface QartProject {
  manifest: QartManifest
  layers: QartLayerData[]
}

export interface QartLayerData {
  manifest: QartLayerManifest
  pixels: Uint8Array
}

/**
 * Reads a .qart ZIP archive and returns the project data.
 */
export async function readQart(blob: Blob): Promise<QartProject> {
  const zip = await JSZip.loadAsync(blob)

  // Read and parse manifest
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) {
    throw new Error('Invalid .qart file: missing manifest.json')
  }
  const manifestText = await manifestFile.async('text')
  let manifestData: unknown
  try {
    manifestData = JSON.parse(manifestText)
  } catch {
    throw new Error('Invalid .qart file: manifest.json is not valid JSON')
  }

  const validation = validateManifest(manifestData)
  if (!validation.valid) {
    throw new Error(`Invalid .qart manifest: ${validation.errors.join(', ')}`)
  }

  const manifest = manifestData as QartManifest

  // Read each layer's pixel data
  const layers: QartLayerData[] = []
  for (const layerManifest of manifest.layers) {
    const dataFile = zip.file(layerManifest.dataFile)
    if (!dataFile) {
      throw new Error(`Missing layer data file: ${layerManifest.dataFile}`)
    }
    const pixels = new Uint8Array(await dataFile.async('arraybuffer'))
    layers.push({ manifest: layerManifest, pixels })
  }

  return { manifest, layers }
}
