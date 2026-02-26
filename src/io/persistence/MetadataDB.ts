import { getDB, type ProjectRecord, type LayerRecord, type TileRecord } from '../../db/schema.ts'
import type { LayerInfo } from '../../types/layer.ts'

export class MetadataDB {
  // ── Projects ──────────────────────────────────────────────────────

  async createProject(
    name: string,
    width: number,
    height: number,
    dpi: number,
  ): Promise<number> {
    const db = await getDB()
    const now = new Date()
    return db.add('projects', {
      name,
      width,
      height,
      dpi,
      createdAt: now,
      updatedAt: now,
    })
  }

  async getProject(id: number): Promise<ProjectRecord | undefined> {
    const db = await getDB()
    return db.get('projects', id)
  }

  async getAllProjects(): Promise<ProjectRecord[]> {
    const db = await getDB()
    const all = await db.getAllFromIndex('projects', 'by-updatedAt')
    return all.reverse()
  }

  async updateProject(id: number, changes: Partial<ProjectRecord>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('projects', id)
    if (!existing) return
    await db.put('projects', { ...existing, ...changes, updatedAt: new Date() })
  }

  async deleteProject(id: number): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['projects', 'layers', 'tiles'], 'readwrite')

    // Delete tiles
    const tiles = await tx.objectStore('tiles').index('by-projectId').getAll(id)
    for (const tile of tiles) {
      await tx.objectStore('tiles').delete(tile.id!)
    }

    // Delete layers
    const layers = await tx.objectStore('layers').index('by-projectId').getAll(id)
    for (const layer of layers) {
      await tx.objectStore('layers').delete(layer.id!)
    }

    // Delete project
    await tx.objectStore('projects').delete(id)
    await tx.done
  }

  async duplicateProject(id: number, newName: string): Promise<number> {
    const db = await getDB()
    const original = await db.get('projects', id)
    if (!original) throw new Error(`Project ${id} not found`)

    const now = new Date()
    const newId = await db.add('projects', {
      name: newName,
      width: original.width,
      height: original.height,
      dpi: original.dpi,
      createdAt: now,
      updatedAt: now,
      thumbnailBlob: original.thumbnailBlob,
    })

    // Copy layers
    const layers = await db.getAllFromIndex('layers', 'by-projectId', id)
    for (const layer of layers) {
      await db.add('layers', {
        projectId: newId,
        layerId: layer.layerId,
        name: layer.name,
        blendMode: layer.blendMode,
        opacity: layer.opacity,
        visible: layer.visible,
        locked: layer.locked,
        alphaLock: layer.alphaLock,
        clippingMask: layer.clippingMask,
        order: layer.order,
      })
    }

    // Copy tiles
    const tiles = await db.getAllFromIndex('tiles', 'by-projectId', id)
    for (const tile of tiles) {
      await db.add('tiles', {
        projectId: newId,
        layerId: tile.layerId,
        key: tile.key,
        data: tile.data.slice(0),
      })
    }

    return newId
  }

  // ── Layers ────────────────────────────────────────────────────────

  async saveLayers(projectId: number, layers: LayerInfo[]): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('layers', 'readwrite')
    const store = tx.objectStore('layers')

    // Remove existing layers for this project
    const existing = await store.index('by-projectId').getAll(projectId)
    for (const layer of existing) {
      await store.delete(layer.id!)
    }

    // Add new layers
    for (let i = 0; i < layers.length; i++) {
      const info = layers[i]
      await store.add({
        projectId,
        layerId: info.id,
        name: info.name,
        blendMode: info.blendMode,
        opacity: info.opacity,
        visible: info.visible,
        locked: info.locked,
        alphaLock: info.alphaLock,
        clippingMask: info.clippingMask,
        order: i,
      })
    }

    await tx.done
  }

  async loadLayers(projectId: number): Promise<LayerRecord[]> {
    const db = await getDB()
    const layers = await db.getAllFromIndex('layers', 'by-projectId', projectId)
    return layers.sort((a, b) => a.order - b.order)
  }

  // ── Tiles ─────────────────────────────────────────────────────────

  async saveTile(
    projectId: number,
    layerId: string,
    key: string,
    data: ArrayBuffer,
  ): Promise<void> {
    const db = await getDB()
    const existing = await db.getFromIndex('tiles', 'by-project-layer-key', [projectId, layerId, key])

    if (existing) {
      await db.put('tiles', { ...existing, data })
    } else {
      await db.add('tiles', { projectId, layerId, key, data })
    }
  }

  async loadTile(
    projectId: number,
    layerId: string,
    key: string,
  ): Promise<ArrayBuffer | null> {
    const db = await getDB()
    const record = await db.getFromIndex('tiles', 'by-project-layer-key', [projectId, layerId, key])
    return record?.data ?? null
  }

  async loadAllTilesForLayer(
    projectId: number,
    layerId: string,
  ): Promise<TileRecord[]> {
    const db = await getDB()
    const allTiles = await db.getAllFromIndex('tiles', 'by-projectId', projectId)
    return allTiles.filter((t) => t.layerId === layerId)
  }

  async deleteLayerTiles(projectId: number, layerId: string): Promise<void> {
    const db = await getDB()
    const allTiles = await db.getAllFromIndex('tiles', 'by-projectId', projectId)
    const tx = db.transaction('tiles', 'readwrite')
    for (const tile of allTiles) {
      if (tile.layerId === layerId) {
        await tx.store.delete(tile.id!)
      }
    }
    await tx.done
  }
}
