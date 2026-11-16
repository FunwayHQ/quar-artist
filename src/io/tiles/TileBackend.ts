import type { DocumentManifest, TileBackendKind } from './tileFormat.ts'

/**
 * Writes one save's tiles, each under a name of its own, so nothing the last
 * committed manifest refers to is touched. They count once a manifest that
 * refers to them is committed; until then they are garbage if the save stops.
 */
export interface TileWriter {
  /** Store an encoded tile, and return the reference a manifest keeps for it. */
  put(layerId: string, x: number, y: number, data: Uint8Array): Promise<string>
  /** Wait until every tile put so far is stored. */
  finish(): Promise<void>
}

/** Where tiles are kept. Manifests are kept in IndexedDB's documents store, whichever the backend. */
export interface TileBackend {
  readonly kind: TileBackendKind
  begin(projectId: string): TileWriter
  /** The stored bytes of some of a layer's tiles, by reference. Tiles that aren't there are left out. */
  readLayer(projectId: string, layerId: string, refs: readonly string[]): Promise<Map<string, Uint8Array>>
  /** Remove some of a layer's tiles. */
  removeTiles(projectId: string, layerId: string, refs: readonly string[]): Promise<void>
  /** Remove all of a layer's tiles. */
  removeLayer(projectId: string, layerId: string): Promise<void>
  /** Remove the project's tiles `keep` doesn't refer to: all of them when it is null. */
  sweep(projectId: string, keep: DocumentManifest | null): Promise<void>
}

/** The bytes as a standalone ArrayBuffer, copied only when they are a view into a larger buffer. */
export function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer
  return bytes.slice().buffer
}

/** The tile references of each layer in a manifest. */
export function refsByLayer(manifest: DocumentManifest): Map<string, Set<string>> {
  return new Map(manifest.layers.map((l) => [l.info.id, new Set(l.tiles.map((t) => t.ref))]))
}

/** A tile name unique to one save: its position, then the save's own id. */
export function tileName(x: number, y: number, saveId: string): string {
  return `${x}_${y}_${saveId}`
}
