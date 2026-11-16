import { getDB } from '../db/schema.ts'
import type { LayerInfo } from '../types/layer.ts'

/**
 * Save layers as M1.1 and earlier did, before the tile store: a record per
 * layer, and its whole straight-alpha pixels as one tile keyed 'full'.
 */
export async function writeLegacyLayers(projectId: string, layers: { info: LayerInfo; pixels: Uint8Array | null }[]) {
  const db = await getDB()
  for (const [order, { info, pixels }] of layers.entries()) {
    await db.add('layers', {
      projectId,
      layerId: info.id,
      name: info.name,
      blendMode: info.blendMode,
      opacity: info.opacity,
      visible: info.visible,
      locked: info.locked,
      alphaLock: info.alphaLock,
      clippingMask: info.clippingMask,
      order,
    })
    if (pixels) await db.add('tiles', { projectId, layerId: info.id, key: 'full', data: pixels.slice().buffer })
  }
}

/** The layer ids a project has records for in the old layout, and the layer ids of its tiles. */
export async function legacyRecords(projectId: string): Promise<{ layers: string[]; tiles: string[] }> {
  const db = await getDB()
  const layers = await db.getAllFromIndex('layers', 'by-projectId', projectId)
  const tiles = await db.getAllFromIndex('tiles', 'by-projectId', projectId)
  return {
    layers: layers.sort((a, b) => a.order - b.order).map((r) => r.layerId),
    tiles: tiles.map((r) => r.layerId).sort(),
  }
}
