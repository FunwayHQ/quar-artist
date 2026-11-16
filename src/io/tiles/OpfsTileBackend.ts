import { createId } from '../../utils/id.ts'
import { refsByLayer, tileName, type TileBackend, type TileWriter } from './TileBackend.ts'
import type { DocumentManifest } from './tileFormat.ts'

/**
 * FileSystemSyncAccessHandle, which TypeScript only declares for workers.
 * Early versions (Safari before 16.4, Chrome before 108) return promises from
 * some of these, so every call is awaited.
 */
interface SyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number | Promise<number>
  truncate(size: number): void | Promise<void>
  flush(): void | Promise<void>
  close(): void | Promise<void>
}
type SyncFileHandle = FileSystemFileHandle & { createSyncAccessHandle?(): Promise<SyncAccessHandle> }

const ROOT = 'quar-artist'

export interface OpfsRoot {
  dir: FileSystemDirectoryHandle
  /**
   * Whether files can be written here. Writes use sync access handles, the
   * kind every browser with OPFS has, and those only exist in workers.
   * Elsewhere tiles can still be read and removed.
   */
  writable: boolean
}

/** The OPFS folder for tiles, or null without OPFS (private windows, sites without HTTPS). */
export async function openOpfsRoot(): Promise<OpfsRoot | null> {
  try {
    const storage = globalThis.navigator?.storage
    if (typeof storage?.getDirectory !== 'function') return null
    const dir = await (await storage.getDirectory()).getDirectoryHandle(ROOT, { create: true })
    return { dir, writable: await canWrite(dir) }
  } catch {
    return null
  }
}

async function canWrite(dir: FileSystemDirectoryHandle): Promise<boolean> {
  // A file of its own: another tab's worker probing at the same moment holds its own handle.
  const name = `.probe-${createId()}`
  try {
    const probe = (await dir.getFileHandle(name, { create: true })) as SyncFileHandle
    if (typeof probe.createSyncAccessHandle !== 'function') return false
    await (await probe.createSyncAccessHandle()).close()
    return true
  } catch {
    return false
  } finally {
    await dir.removeEntry(name).catch(() => undefined)
  }
}

const projectDirName = (projectId: string) => `p-${encodeURIComponent(projectId)}`
const layerDirName = (layerId: string) => `l-${encodeURIComponent(layerId)}`

/**
 * Tiles as OPFS files, quar-artist/p-<project>/l-<layer>/<column>_<row>_<save>,
 * written from the persistence worker.
 */
export class OpfsTileBackend implements TileBackend {
  readonly kind = 'opfs' as const
  private readonly root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
  }

  begin(projectId: string): TileWriter {
    return new OpfsTileWriter(this.root, projectId)
  }

  async readLayer(projectId: string, layerId: string, refs: readonly string[]): Promise<Map<string, Uint8Array>> {
    const found = new Map<string, Uint8Array>()
    const dir = await this.layerDir(projectId, layerId)
    if (!dir) return found
    for (const ref of refs) {
      const data = await readFile(dir, ref)
      if (data) found.set(ref, data)
    }
    return found
  }

  async removeTiles(projectId: string, layerId: string, refs: readonly string[]): Promise<void> {
    const dir = await this.layerDir(projectId, layerId)
    if (!dir) return
    for (const ref of refs) await removeIfThere(dir, ref)
  }

  async removeLayer(projectId: string, layerId: string): Promise<void> {
    const project = await this.projectDir(projectId)
    if (project) await removeIfThere(project, layerDirName(layerId))
  }

  async sweep(projectId: string, keep: DocumentManifest | null): Promise<void> {
    if (!keep) {
      await removeIfThere(this.root, projectDirName(projectId))
      return
    }
    const project = await this.projectDir(projectId)
    if (!project) return
    const refs = new Map([...refsByLayer(keep)].map(([id, set]) => [layerDirName(id), set]))
    for (const [name, handle] of await listEntries(project)) {
      const kept = refs.get(name)
      if (!kept || handle.kind !== 'directory') {
        await removeIfThere(project, name)
        continue
      }
      const layer = handle as FileSystemDirectoryHandle
      for (const [file] of await listEntries(layer)) {
        if (!kept.has(file)) await removeIfThere(layer, file)
      }
    }
  }

  private async projectDir(projectId: string): Promise<FileSystemDirectoryHandle | null> {
    return childDir(this.root, projectDirName(projectId))
  }

  private async layerDir(projectId: string, layerId: string): Promise<FileSystemDirectoryHandle | null> {
    const project = await this.projectDir(projectId)
    return project && childDir(project, layerDirName(layerId))
  }
}

class OpfsTileWriter implements TileWriter {
  private readonly root: FileSystemDirectoryHandle
  private readonly projectId: string
  private readonly saveId = createId().slice(0, 13)
  private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle>>()

  constructor(root: FileSystemDirectoryHandle, projectId: string) {
    this.root = root
    this.projectId = projectId
  }

  async put(layerId: string, x: number, y: number, data: Uint8Array): Promise<string> {
    const name = tileName(x, y, this.saveId)
    await writeFile(await this.layerDir(layerId), name, data)
    return name
  }

  /** Each put has written and flushed its file by the time it resolves. */
  async finish(): Promise<void> {}

  private layerDir(layerId: string): Promise<FileSystemDirectoryHandle> {
    let dir = this.dirs.get(layerId)
    if (!dir) {
      dir = this.root
        .getDirectoryHandle(projectDirName(this.projectId), { create: true })
        .then((project) => project.getDirectoryHandle(layerDirName(layerId), { create: true }))
      // A failure isn't kept: the next put tries again.
      dir.catch(() => this.dirs.delete(layerId))
      this.dirs.set(layerId, dir)
    }
    return dir
  }
}

/** A directory's entries, all read before anything in it changes. */
async function listEntries(dir: FileSystemDirectoryHandle): Promise<[string, FileSystemHandle][]> {
  const entries: [string, FileSystemHandle][] = []
  for await (const entry of dir.entries()) entries.push(entry)
  return entries
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array): Promise<void> {
  const file = (await dir.getFileHandle(name, { create: true })) as SyncFileHandle
  if (typeof file.createSyncAccessHandle !== 'function') throw new Error('files can only be written from a worker')
  const handle = await file.createSyncAccessHandle()
  try {
    await handle.truncate(0)
    await handle.write(data as Uint8Array<ArrayBuffer>, { at: 0 })
    await handle.flush()
  } finally {
    await handle.close()
  }
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

async function childDir(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await dir.getDirectoryHandle(name)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

async function removeIfThere(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.removeEntry(name, { recursive: true })
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
}

function isNotFound(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined
  // A name that belongs to a file where a folder is expected, or the reverse, counts as not there.
  return name === 'NotFoundError' || name === 'TypeMismatchError'
}
