/**
 * Review of plan M1.7's PSD export in the project service. Fails now, passes
 * once fixed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { ProjectService } from './ProjectService.ts'
import { MetadataDB } from './MetadataDB.ts'
import { DB_NAME, resetDB } from '../../db/schema.ts'
import { IdbTileBackend } from '../tiles/IdbTileBackend.ts'
import { TileStore } from '../tiles/TileStore.ts'
import { useProjectStore } from '../../stores/projectStore.ts'
import { useUIStore } from '../../stores/uiStore.ts'
import { readPsd } from '../formats/psd/agPsd.ts'
import * as fileAccess from '../files/fileAccess.ts'
import { FakeDocumentEngine, layerInfo } from '../../test/fakeDocumentEngine.ts'

vi.mock('../importImage.ts', () => ({ decodeImageBlob: vi.fn() }))
vi.mock('../files/fileAccess.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/fileAccess.ts')>()),
  canPickSaveFile: vi.fn(() => false),
  downloadFile: vi.fn(),
}))
// jsdom has no 2D canvas to draw thumbnails with.
vi.mock('./thumbnail.ts', () => ({
  encodeLayersThumbnail: vi.fn(async () => ({ type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer })),
  encodeThumbnail: vi.fn(async () => null),
}))

const files = vi.mocked(fileAccess)
const initialProjectState = useProjectStore.getState()

/** 2 × 2 opaque pixels of one grey. */
function filled(value: number) {
  const pixels = new Uint8Array(2 * 2 * 4).fill(value)
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
  return pixels
}

describe('ProjectService.exportPsd (review of plan M1.7)', () => {
  let db: MetadataDB
  let tiles: TileStore
  let service: ProjectService

  beforeEach(async () => {
    resetDB()
    await deleteDB(DB_NAME)
    useProjectStore.setState(initialProjectState, true)
    useUIStore.setState({ toasts: [] })
    files.downloadFile.mockReset()
    db = new MetadataDB()
    const idb = new IdbTileBackend()
    tiles = new TileStore({ write: idb, read: { idb } })
    service = new ProjectService(db, { debounceMs: 10, store: tiles })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("doesn't write a filter or transform preview into the composite of a file whose layers are written without it", async () => {
    const id = await db.createProject('Painting', 2, 2, 72)
    await tiles.save(id, { width: 2, height: 2, layers: [{ info: layerInfo('bg', 'Background'), pixels: filled(10) }] })
    await db.updateProject(id, { activeLayerId: 'bg' }, { touch: false })
    await service.start()
    expect(await service.openProject(id)).toBe(true)
    const engine = new FakeDocumentEngine(2, 2)
    service.attachEngine(engine)
    await service.settled()

    // A preview is on screen (Ctrl+E works under a transform, and the filter dialog leaves the canvas live):
    // getLayerPixels gives the layer from before it, and the composite shows it.
    engine.previewing = true
    engine.composite = new Uint8ClampedArray(filled(200))

    await service.exportPsd()

    // Refusing to export, or writing a composite of the layers written, are both fine. Now the
    // file's layer is grey 10 and its composite, which viewers and file previews show, grey 200.
    const call = files.downloadFile.mock.calls[0]
    if (!call) return
    const psd = readPsd(new Uint8Array(await call[0].arrayBuffer()), { useImageData: true, skipThumbnail: true })
    expect(psd.children![0].imageData!.data[0]).toBe(10)
    expect(psd.imageData!.data[0]).toBe(10)
  })
})
