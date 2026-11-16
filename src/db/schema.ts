import { openDB, type IDBPDatabase, type IDBPTransaction, type DBSchema, type StoreNames } from 'idb'
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
  thumbnailBlob?: Blob
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

export interface TileRecord {
  id?: number
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
}

export type QuarDB = IDBPDatabase<QuarDBSchema>
type UpgradeTransaction = IDBPTransaction<QuarDBSchema, StoreNames<QuarDBSchema>[], 'versionchange'>

export const DB_NAME = 'QuarArtistDB'

/**
 * Schema versions:
 * 1. Projects keyed by an auto-incremented number.
 * 2. Projects keyed by a UUID (plan D12). Upgrading rekeys version 1 projects
 *    and points their layers and tiles at the new ids.
 */
export const DB_VERSION = 2

let dbInstance: QuarDB | null = null

export async function getDB(): Promise<QuarDB> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<QuarDBSchema>(DB_NAME, DB_VERSION, {
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
        return
      }
      if (oldVersion < 2) await rekeyProjects(db, tx)
    },
  })

  return dbInstance
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
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
