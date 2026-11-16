import { getDB, type TileDataRecord } from '../../db/schema.ts'
import { inTransaction } from '../../db/transaction.ts'
import { createId } from '../../utils/id.ts'
import { ownBuffer, refsByLayer, tileName, type TileBackend, type TileWriter } from './TileBackend.ts'
import type { DocumentManifest } from './tileFormat.ts'

/** Tiles written per transaction, at most: a large save doesn't hold all of its tiles in memory. */
const BATCH_TILES = 64
const BATCH_BYTES = 16 * 1024 * 1024

/** Every key of a project's tiles sorts between these. */
function projectRange(projectId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId], [projectId, []])
}

function layerRange(projectId: string, layerId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId, layerId, ''], [projectId, layerId, '￿'])
}

/**
 * Tiles as records of IndexedDB's tileData store, keyed by project, layer
 * and tile name: where OPFS isn't available (Firefox and Safari private
 * windows, sites without HTTPS, workers that couldn't start).
 */
export class IdbTileBackend implements TileBackend {
  readonly kind = 'idb' as const

  begin(projectId: string): TileWriter {
    return new IdbTileWriter(projectId)
  }

  async readLayer(projectId: string, layerId: string, refs: readonly string[]): Promise<Map<string, Uint8Array>> {
    const found = new Map<string, Uint8Array>()
    const tx = (await getDB()).transaction('tileData')
    await inTransaction(tx, () =>
      Promise.all(
        refs.map(async (ref) => {
          const record = await tx.store.get([projectId, layerId, ref])
          if (record) found.set(ref, new Uint8Array(record.data))
        }),
      ),
    )
    return found
  }

  async removeTiles(projectId: string, layerId: string, refs: readonly string[]): Promise<void> {
    if (refs.length === 0) return
    const tx = (await getDB()).transaction('tileData', 'readwrite')
    await inTransaction(tx, () => Promise.all(refs.map((ref) => tx.store.delete([projectId, layerId, ref]))))
  }

  async removeLayer(projectId: string, layerId: string): Promise<void> {
    const tx = (await getDB()).transaction('tileData', 'readwrite')
    await inTransaction(tx, () => tx.store.delete(layerRange(projectId, layerId)))
  }

  async sweep(projectId: string, keep: DocumentManifest | null): Promise<void> {
    const refs = keep ? refsByLayer(keep) : new Map<string, Set<string>>()
    const tx = (await getDB()).transaction('tileData', 'readwrite')
    await inTransaction(tx, async () => {
      for (let c = await tx.store.openKeyCursor(projectRange(projectId)); c; c = await c.continue()) {
        const [, layerId, ref] = c.primaryKey
        if (!refs.get(layerId)?.has(ref)) await tx.store.delete(c.primaryKey)
      }
    })
  }

  listProjects(): Promise<string[]> {
    return listIdbProjects()
  }
}

export async function listIdbProjects(): Promise<string[]> {
  const ids: string[] = []
  const tx = (await getDB()).transaction('tileData')
  await inTransaction(tx, async () => {
    // Skip from each project to the next: [id, []] sorts after every key of project id.
    for (let c = await tx.store.openKeyCursor(); c; c = await c.continue([c.primaryKey[0], []] as never)) {
      ids.push(c.primaryKey[0])
    }
  })
  return ids
}

class IdbTileWriter implements TileWriter {
  private readonly projectId: string
  private readonly saveId = createId().slice(0, 13)
  private batch: TileDataRecord[] = []
  private batchBytes = 0

  constructor(projectId: string) {
    this.projectId = projectId
  }

  async put(layerId: string, x: number, y: number, data: Uint8Array): Promise<string> {
    const key = tileName(x, y, this.saveId)
    this.batch.push({ projectId: this.projectId, layerId, key, data: ownBuffer(data) })
    this.batchBytes += data.byteLength
    if (this.batch.length >= BATCH_TILES || this.batchBytes >= BATCH_BYTES) await this.flush()
    return key
  }

  finish(): Promise<void> {
    return this.flush()
  }

  private async flush() {
    if (this.batch.length === 0) return
    const records = this.batch
    this.batch = []
    this.batchBytes = 0
    const tx = (await getDB()).transaction('tileData', 'readwrite')
    await inTransaction(tx, () => Promise.all(records.map((record) => tx.store.put(record))))
  }
}
