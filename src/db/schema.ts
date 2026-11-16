import { openDB, type IDBPDatabase, type IDBPTransaction, type DBSchema, type StoreNames } from 'idb'
import type { ColorSpace, StoredImage } from '../types/project.ts'
import type { DocumentManifest } from '../io/tiles/tileFormat.ts'
import { createId } from '../utils/id.ts'

export interface ProjectRecord {
  /** A UUID (plan D12). */
  id: string
  name: string
  width: number
  height: number
  dpi: number
  createdAt: Date
  updatedAt: Date
  /** The Gallery thumbnail, written on each save. */
  thumbnail?: StoredImage
  colorSpace?: ColorSpace
  /** The stack (Gallery folder) the project is in, if any. */
  stackId?: string
  /** The layer that was active at the last save. */
  activeLayerId?: string
  /** Set when the project is deleted. The Gallery hides it until the delete is undone or made final. */
  deletedAt?: Date
}

/** A Gallery stack: a named folder of projects (PRD 4.9). */
export interface StackRecord {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
}

export interface LayerRecord {
  id?: number
  projectId: string
  layerId: string
  name: string
  blendMode: string
  opacity: number
  visible: boolean
  locked: boolean
  alphaLock: boolean
  clippingMask: boolean
  order: number
}

/** A whole layer's pixels, as versions up to 3 saved them. Read to open older projects, which move to `tileData` on their next save. */
export interface TileRecord {
  id?: number
  projectId: string
  layerId: string
  key: string
  data: ArrayBuffer
}

/**
 * One encoded 256 × 256 tile, where OPFS can't be written (plan M1.2). `key`
 * is the tile's name, "column_row_save": each save writes new names, and the
 * manifest says which are the document's.
 */
export interface TileDataRecord {
  projectId: string
  layerId: string
  key: string
  data: ArrayBuffer
}

export interface SettingRecord {
  key: string
  value: string
}

interface QuarDBSchema extends DBSchema {
  projects: {
    key: string
    value: ProjectRecord
    indexes: {
      'by-name': string
      'by-updatedAt': Date
    }
  }
  layers: {
    key: number
    value: LayerRecord
    indexes: {
      'by-projectId': string
      'by-project-layer': [string, string]
    }
  }
  tiles: {
    key: number
    value: TileRecord
    indexes: {
      'by-projectId': string
      'by-project-layer-key': [string, string, string]
    }
  }
  settings: {
    key: string
    value: SettingRecord
  }
  stacks: {
    key: string
    value: StackRecord
  }
  /** Each project's saved document: its layers and where their tiles are. */
  documents: {
    key: string
    value: DocumentManifest
  }
  tileData: {
    key: [string, string, string]
    value: TileDataRecord
  }
}

export type QuarDB = IDBPDatabase<QuarDBSchema>
type UpgradeTransaction = IDBPTransaction<QuarDBSchema, StoreNames<QuarDBSchema>[], 'versionchange'>

export const DB_NAME = 'QuarArtistDB'

/**
 * Schema versions:
 * 1. Projects keyed by an auto-incremented number.
 * 2. Projects keyed by a UUID (plan D12). Upgrading rekeys version 1 projects
 *    and points their layers and tiles at the new ids.
 * 3. Adds the stacks store (Gallery folders).
 * 4. Adds the documents and tileData stores of the tile store (plan M1.2).
 *    Projects saved before keep their layers and tiles stores until their next save.
 */
export const DB_VERSION = 4

/**
 * Database events the user may need to act on:
 * - blocked: an upgrade waits for QUAR Artist in another tab to close;
 * - blocking: a newer QUAR Artist in another tab needs the database, so this tab let it go;
 * - terminated: the browser closed the database.
 */
export type DatabaseEvent = 'blocked' | 'blocking' | 'terminated'

let dbInstance: QuarDB | null = null
let opening: Promise<QuarDB> | null = null
let onDatabaseEvent: ((event: DatabaseEvent) => void) | null = null

/** Hear about database events (see DatabaseEvent). */
export function setDatabaseEventListener(listener: ((event: DatabaseEvent) => void) | null) {
  onDatabaseEvent = listener
}

/** The open database. Concurrent first calls share one connection. */
export function getDB(): Promise<QuarDB> {
  if (dbInstance) return Promise.resolve(dbInstance)
  opening ??= openQuarDB().then(
    (db) => {
      dbInstance = db
      opening = null
      return db
    },
    (err: unknown) => {
      opening = null
      throw err
    },
  )
  return opening
}

function openQuarDB(): Promise<QuarDB> {
  return openDB<QuarDBSchema>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        createProjectsStore(db)

        const layers = db.createObjectStore('layers', { keyPath: 'id', autoIncrement: true })
        layers.createIndex('by-projectId', 'projectId')
        layers.createIndex('by-project-layer', ['projectId', 'layerId'])

        const tiles = db.createObjectStore('tiles', { keyPath: 'id', autoIncrement: true })
        tiles.createIndex('by-projectId', 'projectId')
        tiles.createIndex('by-project-layer-key', ['projectId', 'layerId', 'key'])

        db.createObjectStore('settings', { keyPath: 'key' })
      } else if (oldVersion < 2) {
        await rekeyProjects(db, tx)
      }
      if (oldVersion < 3) db.createObjectStore('stacks', { keyPath: 'id' })
      if (oldVersion < 4) {
        db.createObjectStore('documents', { keyPath: 'projectId' })
        // One record per (project, layer, tile): the key can't repeat.
        db.createObjectStore('tileData', { keyPath: ['projectId', 'layerId', 'key'] })
      }
    },
    blocked() {
      onDatabaseEvent?.('blocked')
    },
    blocking(_currentVersion, _blockedVersion, event) {
      // Close, so the newer version can upgrade instead of waiting for this tab.
      ;(event.target as IDBDatabase).close()
      dbInstance = null
      onDatabaseEvent?.('blocking')
    },
    terminated() {
      dbInstance = null
      onDatabaseEvent?.('terminated')
    },
  })
}

function createProjectsStore(db: QuarDB) {
  const projects = db.createObjectStore('projects', { keyPath: 'id' })
  projects.createIndex('by-name', 'name')
  projects.createIndex('by-updatedAt', 'updatedAt')
  return projects
}

/** Version 1 to 2: give every project a UUID, and point its layers and tiles at it. */
async function rekeyProjects(db: QuarDB, tx: UpgradeTransaction) {
  // Version 1 records have numeric ids; the schema types describe version 2.
  const oldProjects = (await tx.objectStore('projects').getAll()) as unknown as (Omit<ProjectRecord, 'id'> & {
    id: number
  })[]
  db.deleteObjectStore('projects')
  const projects = createProjectsStore(db)

  const newIds = new Map<number, string>()
  for (const project of oldProjects) {
    const id = createId()
    newIds.set(project.id, id)
    await projects.add({ ...project, id })
  }

  // Layers and tiles keep their own row ids. Rows whose project no longer
  // exists can't be opened, so they are dropped rather than rekeyed.
  for (let cursor = await tx.objectStore('layers').openCursor(); cursor; cursor = await cursor.continue()) {
    const projectId = newIds.get(cursor.value.projectId as unknown as number)
    if (projectId === undefined) await cursor.delete()
    else await cursor.update({ ...cursor.value, projectId })
  }
  for (let cursor = await tx.objectStore('tiles').openCursor(); cursor; cursor = await cursor.continue()) {
    const projectId = newIds.get(cursor.value.projectId as unknown as number)
    if (projectId === undefined) await cursor.delete()
    else await cursor.update({ ...cursor.value, projectId })
  }
}

/** Close and reset the cached DB instance (for testing). */
export function resetDB() {
  dbInstance?.close()
  dbInstance = null
  opening = null
}
