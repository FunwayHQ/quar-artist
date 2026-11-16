/**
 * The persistence worker (plan D7, M1.2): saves and loads documents off the
 * main thread. Cutting layers into tiles, hashing and compressing them don't
 * hold up painting, and OPFS files are written with sync access handles,
 * which only workers have.
 */
import { TileStore } from './TileStore.ts'
import { serveDocumentStore, type StorePort } from './storeProtocol.ts'

serveDocumentStore(new TileStore(), globalThis as unknown as StorePort)
