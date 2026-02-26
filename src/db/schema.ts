import { openDB, type IDBPDatabase, type DBSchema } from 'idb'

export interface ProjectRecord {
  id?: number
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
  projectId: number
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
  projectId: number
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
    key: number
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
      'by-projectId': number
      'by-project-layer': [number, string]
    }
  }
  tiles: {
    key: number
    value: TileRecord
    indexes: {
      'by-projectId': number
      'by-project-layer-key': [number, string, string]
    }
  }
  settings: {
    key: string
    value: SettingRecord
  }
}

export type QuarDB = IDBPDatabase<QuarDBSchema>

let dbInstance: QuarDB | null = null

export async function getDB(): Promise<QuarDB> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<QuarDBSchema>('QuarArtistDB', 1, {
    upgrade(db) {
      // Projects store
      const projects = db.createObjectStore('projects', {
        keyPath: 'id',
        autoIncrement: true,
      })
      projects.createIndex('by-name', 'name')
      projects.createIndex('by-updatedAt', 'updatedAt')

      // Layers store
      const layers = db.createObjectStore('layers', {
        keyPath: 'id',
        autoIncrement: true,
      })
      layers.createIndex('by-projectId', 'projectId')
      layers.createIndex('by-project-layer', ['projectId', 'layerId'])

      // Tiles store
      const tiles = db.createObjectStore('tiles', {
        keyPath: 'id',
        autoIncrement: true,
      })
      tiles.createIndex('by-projectId', 'projectId')
      tiles.createIndex('by-project-layer-key', ['projectId', 'layerId', 'key'])

      // Settings store
      db.createObjectStore('settings', { keyPath: 'key' })
    },
  })

  return dbInstance
}

/** Close and reset the cached DB instance (for testing). */
export function resetDB() {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
