import { getDB, type ProjectRecord, type StackRecord } from '../../db/schema.ts'
import { inTransaction } from '../../db/transaction.ts'
import type { BlendMode, StoredLayer } from '../../types/layer.ts'
import { createId } from '../../utils/id.ts'
import { savedLayerInfo } from '../tiles/tileFormat.ts'

/**
 * Project records, stacks and settings. Documents themselves are saved by the
 * tile store (io/tiles); this also reads documents saved before it, as whole
 * layers in the layers and tiles stores, until their next save moves them.
 */
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

  /**
   * Delete a project's record, and its whole layers if it was saved before the
   * tile store (the tile store deletes its document itself). Reads only keys.
   */
  async deleteProject(id: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['projects', 'layers', 'tiles'], 'readwrite')
    await inTransaction(tx, async () => {
      for (const name of ['tiles', 'layers'] as const) {
        const store = tx.objectStore(name)
        for (let c = await store.index('by-projectId').openKeyCursor(id); c; c = await c.continue()) {
          await store.delete(c.primaryKey)
        }
      }
      await tx.objectStore('projects').delete(id)
    })
  }

  /**
   * Copy a project's record under a new id and name, and its whole layers if
   * it was saved before the tile store, one record at a time, in one
   * transaction: the copy is made whole or not at all. The tile store copies
   * its document itself.
   */
  async duplicateProject(id: string, newName: string): Promise<string> {
    const db = await getDB()
    const tx = db.transaction(['projects', 'layers', 'tiles'], 'readwrite')
    return inTransaction(tx, async () => {
      const original = await tx.objectStore('projects').get(id)
      if (!original) throw new Error(`Project ${id} not found`)
      const now = new Date()
      const copy: ProjectRecord = { ...original, id: createId(), name: newName, createdAt: now, updatedAt: now }
      delete copy.deletedAt
      // The copy has its own work: Ctrl+S in it mustn't overwrite the original's file.
      delete copy.fileHandle
      delete copy.fileModified
      await tx.objectStore('projects').add(copy)

      for (const name of ['layers', 'tiles'] as const) {
        const store = tx.objectStore(name)
        // The copies have another project id, outside the range being walked.
        for (let c = await store.index('by-projectId').openCursor(id); c; c = await c.continue()) {
          const record = { ...c.value, projectId: copy.id }
          delete record.id
          await store.add(record as never)
        }
      }
      return copy.id
    })
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

  // ── Documents saved before the tile store ─────────────────────────

  /**
   * The layers of a project saved before the tile store (M1.1 and earlier):
   * layer records with whole straight-alpha pixels, bottom first. A layer
   * whose pixels are missing or the wrong size loads empty. No records, no layers.
   */
  async loadLegacyLayers(projectId: string, width: number, height: number): Promise<StoredLayer[] | null> {
    // One transaction, with the tile store's documents: the save that moves a
    // project to tiles drops these records in the transaction that writes its
    // manifest, so this sees either all of them or the manifest.
    const tx = (await getDB()).transaction(['documents', 'layers', 'tiles'])
    if ((await tx.objectStore('documents').getKey(projectId)) !== undefined) return null
    const records = (await tx.objectStore('layers').index('by-projectId').getAll(projectId)).sort(
      (a, b) => a.order - b.order,
    )
    const size = width * height * 4
    const layers: StoredLayer[] = []
    for (const r of records) {
      const tile = await tx.objectStore('tiles').index('by-project-layer-key').get([projectId, r.layerId, 'full'])
      layers.push({
        info: savedLayerInfo({
          id: r.layerId,
          name: r.name,
          blendMode: r.blendMode as BlendMode,
          opacity: r.opacity,
          visible: r.visible,
          locked: r.locked,
          alphaLock: r.alphaLock,
          clippingMask: r.clippingMask,
        }),
        pixels: tile && tile.data.byteLength === size ? new Uint8Array(tile.data) : null,
      })
    }
    return layers
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
