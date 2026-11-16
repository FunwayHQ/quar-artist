import { getDB, type ProjectRecord, type LayerRecord, type TileRecord, type StackRecord } from '../../db/schema.ts'
import { inTransaction } from '../../db/transaction.ts'
import type { LayerInfo } from '../../types/layer.ts'
import { createId } from '../../utils/id.ts'

/** A layer's properties and its whole pixel buffer: straight RGBA, width × height × 4 bytes. */
export interface StoredLayerData {
  info: LayerInfo
  pixels: Uint8Array
}

/** The bytes as a standalone ArrayBuffer, copied only when they are a view into a larger or shared buffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer
  return bytes.slice().buffer
}

export class MetadataDB {
  // ── Projects ──────────────────────────────────────────────────────

  async createProject(
    name: string,
    width: number,
    height: number,
    dpi: number,
    extra: Pick<ProjectRecord, 'colorSpace' | 'stackId'> = {},
  ): Promise<string> {
    const db = await getDB()
    const now = new Date()
    return db.add('projects', {
      ...extra,
      id: createId(),
      name,
      width,
      height,
      dpi,
      createdAt: now,
      updatedAt: now,
    })
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    const db = await getDB()
    return db.get('projects', id)
  }

  async getAllProjects(): Promise<ProjectRecord[]> {
    const db = await getDB()
    const all = await db.getAllFromIndex('projects', 'by-updatedAt')
    return all.reverse()
  }

  /**
   * Change a project's record. `touch` (the default) also marks it modified now;
   * renaming, stacking and deleting pass `touch: false` so the Gallery's order
   * by date doesn't change.
   */
  async updateProject(id: string, changes: Partial<ProjectRecord>, { touch = true } = {}): Promise<boolean> {
    // One transaction, so concurrent updates (a rename during a save) can't undo each other.
    const tx = (await getDB()).transaction('projects', 'readwrite')
    return inTransaction(tx, async () => {
      const existing = await tx.store.get(id)
      if (!existing) return false
      await tx.store.put({ ...existing, ...changes, ...(touch ? { updatedAt: new Date() } : {}) })
      return true
    })
  }

  /** Delete a project with its layers and tiles. Reads only keys, never tile data. */
  async deleteProject(id: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['projects', 'layers', 'tiles'], 'readwrite')
    await inTransaction(tx, async () => {
      const tiles = tx.objectStore('tiles')
      for (let c = await tiles.index('by-projectId').openKeyCursor(id); c; c = await c.continue()) {
        await tiles.delete(c.primaryKey)
      }
      const layers = tx.objectStore('layers')
      for (let c = await layers.index('by-projectId').openKeyCursor(id); c; c = await c.continue()) {
        await layers.delete(c.primaryKey)
      }
      await tx.objectStore('projects').delete(id)
    })
  }

  async duplicateProject(id: string, newName: string): Promise<string> {
    const db = await getDB()
    const original = await db.get('projects', id)
    if (!original) throw new Error(`Project ${id} not found`)

    const now = new Date()
    const copy: ProjectRecord = { ...original, id: createId(), name: newName, createdAt: now, updatedAt: now }
    delete copy.deletedAt
    const newId = await db.add('projects', copy)
    try {
      await this.copyLayersAndTiles(id, newId)
    } catch (err) {
      // Leave no half-copied project behind.
      await this.deleteProject(newId).catch(() => undefined)
      throw err
    }
    return newId
  }

  private async copyLayersAndTiles(id: string, newId: string): Promise<void> {
    const db = await getDB()
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
  }

  // ── Stacks ────────────────────────────────────────────────────────

  async createStack(name: string): Promise<string> {
    const db = await getDB()
    const now = new Date()
    return db.add('stacks', { id: createId(), name, createdAt: now, updatedAt: now })
  }

  async getAllStacks(): Promise<StackRecord[]> {
    const db = await getDB()
    return db.getAll('stacks')
  }

  async updateStack(id: string, changes: Partial<Pick<StackRecord, 'name'>>): Promise<void> {
    const tx = (await getDB()).transaction('stacks', 'readwrite')
    await inTransaction(tx, async () => {
      const existing = await tx.store.get(id)
      if (existing) await tx.store.put({ ...existing, ...changes, updatedAt: new Date() })
    })
  }

  async deleteStack(id: string): Promise<void> {
    const db = await getDB()
    await db.delete('stacks', id)
  }

  // ── Layers ────────────────────────────────────────────────────────

  async saveLayers(projectId: string, layers: LayerInfo[]): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('layers', 'readwrite')
    const store = tx.objectStore('layers')
    await inTransaction(tx, async () => {
      // Replace this project's layer records
      for (let c = await store.index('by-projectId').openKeyCursor(projectId); c; c = await c.continue()) {
        await store.delete(c.primaryKey)
      }
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
    })
  }

  /**
   * Save a whole document: its layer records, each layer's pixels, and the
   * removal of pixels that belonged to layers it no longer has.
   */
  async saveDocumentLayers(projectId: string, layers: StoredLayerData[]): Promise<void> {
    await this.saveLayers(projectId, layers.map((l) => l.info))
    for (const { info, pixels } of layers) {
      await this.saveTile(projectId, info.id, 'full', toArrayBuffer(pixels))
    }
    await this.deleteTilesExcept(projectId, new Set(layers.map((l) => l.info.id)))
  }

  async loadLayers(projectId: string): Promise<LayerRecord[]> {
    const db = await getDB()
    const layers = await db.getAllFromIndex('layers', 'by-projectId', projectId)
    return layers.sort((a, b) => a.order - b.order)
  }

  // ── Tiles ─────────────────────────────────────────────────────────

  async saveTile(
    projectId: string,
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
    projectId: string,
    layerId: string,
    key: string,
  ): Promise<ArrayBuffer | null> {
    const db = await getDB()
    const record = await db.getFromIndex('tiles', 'by-project-layer-key', [projectId, layerId, key])
    return record?.data ?? null
  }

  async loadAllTilesForLayer(
    projectId: string,
    layerId: string,
  ): Promise<TileRecord[]> {
    const db = await getDB()
    // Use compound index range to query only tiles for this project+layer
    const range = IDBKeyRange.bound(
      [projectId, layerId, ''],
      [projectId, layerId, '\uffff'],
    )
    return db.getAllFromIndex('tiles', 'by-project-layer-key', range)
  }

  /** Delete a project's tiles except those of the given layers. Reads only keys, never tile data. */
  async deleteTilesExcept(projectId: string, keepLayerIds: ReadonlySet<string>): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('tiles', 'readwrite')
    // Every [projectId, layerId, key] sorts between [projectId] and [projectId, []].
    const range = IDBKeyRange.bound([projectId], [projectId, []])
    const index = tx.store.index('by-project-layer-key')
    await inTransaction(tx, async () => {
      for (let cursor = await index.openKeyCursor(range); cursor; cursor = await cursor.continue()) {
        if (!keepLayerIds.has(cursor.key[1])) await tx.store.delete(cursor.primaryKey)
      }
    })
  }

  async deleteLayerTiles(projectId: string, layerId: string): Promise<void> {
    const db = await getDB()
    // Use compound index range to find only this layer's tiles
    const range = IDBKeyRange.bound(
      [projectId, layerId, ''],
      [projectId, layerId, '\uffff'],
    )
    const tx = db.transaction('tiles', 'readwrite')
    const index = tx.store.index('by-project-layer-key')
    await inTransaction(tx, async () => {
      for (let cursor = await index.openKeyCursor(range); cursor; cursor = await cursor.continue()) {
        await tx.store.delete(cursor.primaryKey)
      }
    })
  }

  // ── Settings ──────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | undefined> {
    const db = await getDB()
    return (await db.get('settings', key))?.value
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = await getDB()
    await db.put('settings', { key, value })
  }
}
