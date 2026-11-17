import { getDB } from '../../db/schema.ts'
import { inTransaction } from '../../db/transaction.ts'
import type { LayerInfo, StoredLayer } from '../../types/layer.ts'
import { tileBounds, type TilePixels } from '../../utils/tiles.ts'
import { IdbTileBackend } from './IdbTileBackend.ts'
import { OpfsTileBackend, openOpfsRoot } from './OpfsTileBackend.ts'
import { withDocumentLock } from './locks.ts'
import type { TileBackend } from './TileBackend.ts'
import { decodeTile, encodeTile } from './tileCodec.ts'
import {
  TILE_FORMAT,
  cutTile,
  hashTile,
  isEmptyTile,
  placeTile,
  savedLayerInfo,
  tileColumns,
  tileFromPixels,
  tileRows,
  type DocumentManifest,
  type ManifestLayer,
  type TileBackendKind,
  type TileEntry,
} from './tileFormat.ts'

/**
 * A layer to save. `pixels` is the whole layer, straight RGBA8 at document
 * size. Without them (null), the layer is what was saved for it, with
 * `tiles` changed on top: in the save the document names as its `base`, or
 * else in the last save.
 */
export interface SaveLayer {
  info: LayerInfo
  pixels: Uint8Array | null
  /** With null pixels: the tiles changed since, each the straight RGBA8 of its part of the document (`tileBounds`). */
  tiles?: TilePixels[]
}

export interface DocumentToSave {
  width: number
  height: number
  /** Bottom first. */
  layers: SaveLayer[]
  /**
   * The save (its `seq`) that layers without pixels build on (plan M1.3).
   * If the project's last save is another one, say from another tab, or of
   * another size, the save is refused with a StaleSaveError: the caller
   * saves whole layers instead, so what is saved is what it shows.
   */
  base?: number
}

/** A save built on a save that is no longer the last one. Nothing was written: save whole layers. */
export class StaleSaveError extends Error {
  constructor() {
    super('the project was saved elsewhere since')
    this.name = 'StaleSaveError'
  }
}

/** Whether an error, maybe from across the worker, is a StaleSaveError. */
export function isStaleSave(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'StaleSaveError'
}

export interface SaveReport {
  backend: TileBackendKind
  /** The save's number: the `base` for the next save that builds on it. */
  seq: number
  /** Tiles written, and tiles kept from the last save because they didn't change. */
  written: number
  kept: number
  /** Encoded bytes written. */
  bytes: number
}

/**
 * A document saved since its outline was read (another tab saved it while it
 * opened): its tiles may be gone. Read the outline again.
 */
export class StaleLoadError extends Error {
  constructor() {
    super('the project was saved elsewhere while it opened')
    this.name = 'StaleLoadError'
  }
}

/** Whether an error, maybe from across the worker, is a StaleLoadError. */
export function isStaleLoad(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'StaleLoadError'
}

/**
 * A saved document without its pixels: its size, its layers bottom first and
 * where their tiles are (plan M1.4). Opening reads this first, makes the
 * layers, and then reads the tiles a batch at a time (`readTiles`).
 */
export interface DocumentOutline {
  /** The save it is. */
  seq: number
  width: number
  height: number
  /** Where its tiles are kept. */
  backend: TileBackendKind
  layers: ManifestLayer[]
}

/** Some tiles of one layer of an outline, to read. */
export interface TileRequest {
  /** The outline's save. */
  seq: number
  backend: TileBackendKind
  layerId: string
  tiles: TileEntry[]
}

export interface SavedDocument {
  /** The save's number, to build the next save on. */
  seq: number
  width: number
  height: number
  /** Bottom first. A layer without pixels has none. */
  layers: StoredLayer[]
  /** Tiles that were missing or couldn't be decoded: they load as transparent. */
  unreadableTiles: number
}

/**
 * Where documents are saved: an engine-independent store of layers as tiles
 * (plan M1.2). The persistence worker runs one; `createDocumentStore` gives
 * the client for it.
 */
export interface DocumentStore {
  /** Save a document. Resolves once it is committed; until then the last save stays as it was. */
  save(projectId: string, doc: DocumentToSave): Promise<SaveReport>
  /** The project's saved document, or null when it has none (it was never saved, or saved before the tile store). */
  load(projectId: string): Promise<SavedDocument | null>
  /** The project's saved document without its pixels, or null when it has none: the first step of opening it. */
  outline(projectId: string): Promise<DocumentOutline | null>
  /**
   * Tiles of an outline, decoded: premultiplied RGBA8, 256 × 256, in the
   * order asked for. A tile missing or that doesn't decode is null. Rejects
   * with a StaleLoadError when the project was saved again since the outline,
   * and its tiles may be gone.
   */
  readTiles(projectId: string, request: TileRequest): Promise<(Uint8Array | null)[]>
  /** Copy a saved document to another project. False when there is none to copy. */
  copy(fromProjectId: string, toProjectId: string): Promise<boolean>
  /** Remove a project's saved document. Nothing to remove is fine. */
  delete(projectId: string): Promise<void>
  /** The projects that have something saved: a manifest, or tiles in any backend. */
  storedProjects(): Promise<string[]>
}

interface Backends {
  /** Where saves write. */
  write: TileBackend
  /** Every backend this context can read, by kind: projects saved elsewhere still open. */
  read: Partial<Record<TileBackendKind, TileBackend>>
}

/** OPFS where it can be written (in a worker), otherwise IndexedDB. */
export async function openBackends(): Promise<Backends> {
  const idb = new IdbTileBackend()
  const root = await openOpfsRoot()
  const opfs = root ? new OpfsTileBackend(root.dir) : null
  return { write: opfs && root?.writable ? opfs : idb, read: { idb, ...(opfs ? { opfs } : {}) } }
}

async function readManifest(projectId: string): Promise<DocumentManifest | null> {
  return (await (await getDB()).get('documents', projectId)) ?? null
}

/**
 * Commit a save: one transaction writes the manifest. The first commit of a
 * project saved the old way also removes its whole-layer records, so it is
 * either still saved the old way or wholly the new. The commit is on disk
 * when this resolves (strict durability; Firefox and Safari default to
 * relaxed): the tiles it replaced are removed right after, and a power cut
 * mustn't bring back a manifest that refers to them.
 */
async function commitManifest(manifest: DocumentManifest, dropOldLayout: boolean) {
  const tx = (await getDB()).transaction(['documents', 'layers', 'tiles'], 'readwrite', { durability: 'strict' })
  await inTransaction(tx, async () => {
    await tx.objectStore('documents').put(manifest)
    if (!dropOldLayout) return
    for (const name of ['layers', 'tiles'] as const) {
      const store = tx.objectStore(name)
      for (let c = await store.index('by-projectId').openKeyCursor(manifest.projectId); c; c = await c.continue()) {
        await store.delete(c.primaryKey)
      }
    }
  })
}

const positionKey = (x: number, y: number) => `${x}_${y}`

/**
 * Saves documents as 256 × 256 tiles (plan D1, D7). A save cuts each layer
 * into tiles, skips empty ones and keeps the ones whose hash matches the last
 * save; the rest are compressed and written under new names. Committing the
 * manifest makes the save count, all at once, and then the tiles it replaced
 * are removed. Saves, copies and deletes of a project run one at a time.
 */
export class TileStore implements DocumentStore {
  private readonly backends: Promise<Backends>
  /** Projects whose stored tiles were checked against their manifest since this store started. */
  private readonly swept = new Set<string>()
  /** Called as work goes on, a tile at a time: the persistence worker reports it, to show it hasn't stalled. */
  onProgress: (() => void) | null = null

  constructor(backends: Backends | Promise<Backends> = openBackends()) {
    this.backends = Promise.resolve(backends)
  }

  /** Where saves are written. */
  async backend(): Promise<TileBackendKind> {
    return (await this.backends).write.kind
  }

  save(projectId: string, doc: DocumentToSave): Promise<SaveReport> {
    // Every document has a layer: a save without any comes from an engine that's gone, and would wipe the project.
    if (doc.layers.length === 0) return Promise.reject(new Error('there are no layers to save'))
    return withDocumentLock(projectId, 'exclusive', async () => {
      const { write, read } = await this.backends
      const previous = await readManifest(projectId)
      if (doc.base !== undefined && doc.layers.some((l) => l.pixels === null)) {
        const usable =
          previous?.format === TILE_FORMAT && previous.seq === doc.base &&
          previous.width === doc.width && previous.height === doc.height
        if (!usable) throw new StaleSaveError()
      }
      // Tiles of another format are never mixed in. Only a newer version writes one, and this one can't open it.
      const before = previous?.format === TILE_FORMAT ? tilesByLayer(previous) : null
      // Tiles kept from the last save have to be where this save writes.
      const sameStore = previous?.backend === write.kind

      const writer = write.begin(projectId)
      const report: SaveReport = { backend: write.kind, seq: 0, written: 0, kept: 0, bytes: 0 }
      const layers: ManifestLayer[] = []
      let manifest: DocumentManifest
      try {
        for (const layer of doc.layers) {
          const info = savedLayerInfo(layer.info)
          const { pixels } = layer
          const old = before?.get(info.id)
          let tiles: TileEntry[]
          if (pixels) {
            if (pixels.length !== doc.width * doc.height * 4) {
              throw new Error(`layer “${info.name}” has ${pixels.length} bytes, not ${doc.width} × ${doc.height} × 4`)
            }
            tiles = []
            for (let y = 0; y < tileRows(doc.height); y++) {
              for (let x = 0; x < tileColumns(doc.width); x++) {
                this.onProgress?.()
                const tile = cutTile(pixels, doc.width, doc.height, x, y)
                if (isEmptyTile(tile)) continue
                const hash = await hashTile(tile)
                const last = sameStore ? old?.get(positionKey(x, y)) : undefined
                if (last?.hash === hash) {
                  tiles.push(last)
                  report.kept++
                  continue
                }
                const { codec, data } = await encodeTile(tile)
                tiles.push({ x, y, hash, codec, ref: await writer.put(info.id, x, y, data) })
                report.written++
                report.bytes += data.byteLength
              }
            }
          } else {
            // What was saved for it (nothing, for a new layer), with the changed tiles on top.
            const result = new Map(old ?? [])
            const written = new Set<string>()
            for (const changed of layer.tiles ?? []) {
              this.onProgress?.()
              const key = positionKey(changed.x, changed.y)
              const bounds = tileBounds(changed.x, changed.y, doc.width, doc.height)
              if (
                !Number.isInteger(changed.x) || !Number.isInteger(changed.y) || changed.x < 0 || changed.y < 0 ||
                bounds.width <= 0 || bounds.height <= 0 || changed.pixels.length !== bounds.width * bounds.height * 4
              ) {
                throw new Error(`a changed tile of layer “${info.name}” doesn't fit the document`)
              }
              const tile = tileFromPixels(changed.pixels, bounds.width, bounds.height)
              if (isEmptyTile(tile)) {
                result.delete(key)
                continue
              }
              const hash = await hashTile(tile)
              const last = sameStore ? old?.get(key) : undefined
              if (last?.hash === hash) {
                result.set(key, last)
                continue
              }
              const { codec, data } = await encodeTile(tile)
              result.set(key, { x: changed.x, y: changed.y, hash, codec, ref: await writer.put(info.id, changed.x, changed.y, data) })
              written.add(key)
              report.written++
              report.bytes += data.byteLength
            }
            const unchanged = [...result].filter(([key]) => !written.has(key)).map(([, entry]) => entry)
            if (sameStore || unchanged.length === 0) {
              report.kept += unchanged.length
            } else {
              // The rest are in the backend the last save used: move them here.
              const source = read[previous!.backend]
              if (!source) throw new Error(`the saved layer “${info.name}” can't be read here`)
              for (const entry of unchanged) result.delete(positionKey(entry.x, entry.y))
              for (const entry of await moveTiles(source, writer, projectId, info, unchanged, report, this.onProgress)) {
                result.set(positionKey(entry.x, entry.y), entry)
              }
            }
            tiles = [...result.values()].sort((a, b) => a.y - b.y || a.x - b.x)
          }
          layers.push({ info, tiles })
        }
        await writer.finish()
        manifest = {
          projectId,
          seq: (previous?.seq ?? 0) + 1,
          backend: write.kind,
          format: TILE_FORMAT,
          width: doc.width,
          height: doc.height,
          layers,
          savedAt: new Date(),
        }
        await commitManifest(manifest, previous === null)
      } catch (err) {
        // Tiles written before the failure belong to no manifest: the next save sweeps them.
        this.swept.delete(projectId)
        throw err
      }

      // The save counts from here. Removing what it replaced can fail without harm: the next save sweeps.
      await this.removeReplaced(projectId, previous, manifest).catch(() => this.swept.delete(projectId))
      report.seq = manifest.seq
      return report
    })
  }

  load(projectId: string): Promise<SavedDocument | null> {
    return withDocumentLock(projectId, 'shared', async () => {
      const manifest = await readManifest(projectId)
      if (!manifest) return null
      if (manifest.format !== TILE_FORMAT) throw new Error('it was saved by a newer version of QUAR Artist')
      const source = (await this.backends).read[manifest.backend]
      if (!source) throw new Error("its layers are kept in storage this browser can't open now")

      const { width, height } = manifest
      let unreadableTiles = 0
      const layers: StoredLayer[] = []
      for (const { info: stored, tiles } of manifest.layers) {
        const info = savedLayerInfo(stored)
        if (tiles.length === 0) {
          layers.push({ info, pixels: null })
          continue
        }
        const found = await source.readLayer(projectId, info.id, tiles.map((t) => t.ref))
        const pixels = new Uint8ClampedArray(width * height * 4)
        for (const tile of tiles) {
          this.onProgress?.()
          const data = found.get(tile.ref)
          const decoded = data && (await decodeTile(tile.codec, data).catch(() => null))
          if (decoded) placeTile(decoded, pixels, width, height, tile.x, tile.y)
          else unreadableTiles++
        }
        layers.push({ info, pixels: new Uint8Array(pixels.buffer) })
      }
      return { seq: manifest.seq, width, height, layers, unreadableTiles }
    })
  }

  outline(projectId: string): Promise<DocumentOutline | null> {
    return withDocumentLock(projectId, 'shared', async () => {
      const manifest = await readManifest(projectId)
      if (!manifest) return null
      if (manifest.format !== TILE_FORMAT) throw new Error('it was saved by a newer version of QUAR Artist')
      if (!(await this.backends).read[manifest.backend]) {
        throw new Error("its layers are kept in storage this browser can't open now")
      }
      const { seq, width, height, backend } = manifest
      return { seq, width, height, backend, layers: manifest.layers.map((l) => ({ info: savedLayerInfo(l.info), tiles: l.tiles })) }
    })
  }

  readTiles(projectId: string, { seq, backend, layerId, tiles }: TileRequest): Promise<(Uint8Array | null)[]> {
    // Shared, so no save removes tiles while they are read. Saves can come in
    // between two reads, though: tiles never change once written, so the
    // outline's are good until a later save removes them.
    return withDocumentLock(projectId, 'shared', async () => {
      const source = (await this.backends).read[backend]
      if (!source) throw new Error("its layers are kept in storage this browser can't open now")
      const found = await source.readLayer(projectId, layerId, tiles.map((t) => t.ref))
      const decoded: (Uint8Array | null)[] = []
      for (const tile of tiles) {
        this.onProgress?.()
        const data = found.get(tile.ref)
        decoded.push(data ? await decodeTile(tile.codec, data).catch(() => null) : null)
      }
      // A tile that isn't there: removed by a save made since, or lost.
      if (tiles.some((t) => !found.has(t.ref))) {
        if ((await readManifest(projectId))?.seq !== seq) throw new StaleLoadError()
      }
      return decoded
    })
  }

  copy(fromProjectId: string, toProjectId: string): Promise<boolean> {
    return withDocumentLock(fromProjectId, 'shared', () =>
      withDocumentLock(toProjectId, 'exclusive', async () => {
        const source = await readManifest(fromProjectId)
        if (!source) return false
        const { write, read } = await this.backends
        const from = read[source.backend]
        if (!from) throw new Error("its layers are kept in storage this browser can't open now")

        const writer = write.begin(toProjectId)
        const report: SaveReport = { backend: write.kind, seq: 1, written: 0, kept: 0, bytes: 0 }
        const layers: ManifestLayer[] = []
        for (const { info, tiles } of source.layers) {
          layers.push({ info, tiles: await moveTiles(from, writer, fromProjectId, info, tiles, report, this.onProgress, true) })
        }
        await writer.finish()
        await commitManifest(
          { ...source, projectId: toProjectId, seq: 1, backend: write.kind, layers, savedAt: new Date() },
          false,
        )
        return true
      }),
    )
  }

  delete(projectId: string): Promise<void> {
    return withDocumentLock(projectId, 'exclusive', async () => {
      // The manifest goes first, so nothing refers to the tiles about to go.
      await (await getDB()).delete('documents', projectId)
      const { read } = await this.backends
      for (const backend of Object.values(read)) {
        this.onProgress?.()
        await backend.sweep(projectId, null)
      }
      this.swept.delete(projectId)
    })
  }

  async storedProjects(): Promise<string[]> {
    const ids = new Set((await (await getDB()).getAllKeys('documents')) as string[])
    for (const backend of Object.values((await this.backends).read)) {
      for (const id of await backend.listProjects()) ids.add(id)
    }
    return [...ids]
  }

  /** Remove the tiles a commit replaced, and the layers it dropped. */
  private async removeReplaced(projectId: string, previous: DocumentManifest | null, manifest: DocumentManifest) {
    const { write, read } = await this.backends
    if (previous && previous.backend !== write.kind) {
      // The project moved to another backend: what it had in the old one goes.
      await read[previous.backend]?.sweep(projectId, null)
    }
    if (!this.swept.has(projectId)) {
      // Once per project, or after a failed save: check every stored tile, for leftovers of saves that stopped.
      await write.sweep(projectId, manifest)
      this.swept.add(projectId)
      return
    }
    if (!previous || previous.backend !== write.kind) return
    const now = new Map(manifest.layers.map((l) => [l.info.id, new Set(l.tiles.map((t) => t.ref))]))
    for (const { info, tiles } of previous.layers) {
      const kept = now.get(info.id)
      if (!kept) {
        await write.removeLayer(projectId, info.id)
        continue
      }
      const replaced = tiles.filter((t) => !kept.has(t.ref)).map((t) => t.ref)
      if (replaced.length > 0) await write.removeTiles(projectId, info.id, replaced)
    }
  }
}

function tilesByLayer(manifest: DocumentManifest): Map<string, Map<string, TileEntry>> {
  return new Map(manifest.layers.map((l) => [l.info.id, new Map(l.tiles.map((t) => [positionKey(t.x, t.y), t]))]))
}

/**
 * Copy a layer's encoded tiles from one backend's project into a writer.
 * Missing tiles are left out, or fail the copy when `strict`.
 */
async function moveTiles(
  source: TileBackend,
  writer: { put(layerId: string, x: number, y: number, data: Uint8Array): Promise<string> },
  projectId: string,
  info: LayerInfo,
  tiles: readonly TileEntry[],
  report: SaveReport,
  onProgress: (() => void) | null,
  strict = false,
): Promise<TileEntry[]> {
  if (tiles.length === 0) return []
  const stored = await source.readLayer(projectId, info.id, tiles.map((t) => t.ref))
  const moved: TileEntry[] = []
  for (const tile of tiles) {
    onProgress?.()
    const data = stored.get(tile.ref)
    if (!data) {
      if (strict) throw new Error(`a tile of layer “${info.name}” is missing`)
      continue
    }
    moved.push({ ...tile, ref: await writer.put(info.id, tile.x, tile.y, data) })
    report.written++
    report.bytes += data.byteLength
  }
  return moved
}
