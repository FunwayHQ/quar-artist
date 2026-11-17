/**
 * The real engine saved by a real document session (plan M1.4): what counts
 * as an edit to save, end to end. PixiJS is mocked as in CanvasManager.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'

// The same mocks as CanvasManager.test.ts: PixiJS can't run in jsdom.
vi.mock('../layers/blendModes.ts', () => ({}))

vi.mock('pixi.js', () => {
  const mockTexture = {
    destroy: vi.fn(),
    width: 800,
    height: 600,
  }
  class MockApplication {}
  class MockSprite {
    texture: unknown
    alpha = 1
    mask: unknown = null
    position = { set: vi.fn() }
    blendMode = 'normal'
    constructor(texture?: unknown) {
      this.texture = texture ?? mockTexture
    }
  }
  class MockGraphics {
    clear = vi.fn()
    circle = vi.fn()
    fill = vi.fn()
    rect = vi.fn()
  }
  class MockContainer {
    blendMode = 'normal'
    addChild = vi.fn()
    removeChild = vi.fn()
    removeChildren = vi.fn()
  }
  class MockTexture {
    destroy = vi.fn()
    static from = vi.fn(() => new MockTexture())
  }
  return {
    Application: MockApplication,
    RenderTexture: { create: vi.fn(() => ({ ...mockTexture, destroy: vi.fn() })) },
    Sprite: MockSprite,
    Graphics: MockGraphics,
    Container: MockContainer,
    Texture: MockTexture,
  }
})

vi.mock('../renderer.ts', () => ({
  createRenderer: vi.fn().mockResolvedValue({
    renderer: { type: 0x01, resize: vi.fn(), render: vi.fn() },
    stage: {
      position: { set: vi.fn() },
      scale: { set: vi.fn() },
      rotation: 0,
      addChild: vi.fn(),
    },
    destroy: vi.fn(),
  }),
}))

vi.mock('../utils/readback.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/readback.ts')>()),
  writeTiles: vi.fn(),
}))

// jsdom has no 2D canvas to draw thumbnails with.
vi.mock('../../io/persistence/thumbnail.ts', () => ({
  encodeLayersThumbnail: vi.fn(async () => null),
  encodeThumbnail: vi.fn(async () => null),
}))

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

import { CanvasManager } from './CanvasManager.ts'
import { DocumentSession } from '../../io/persistence/DocumentSession.ts'
import { MetadataDB } from '../../io/persistence/MetadataDB.ts'
import { IdbTileBackend } from '../../io/tiles/IdbTileBackend.ts'
import { TileStore } from '../../io/tiles/TileStore.ts'
import { DB_NAME, resetDB } from '../../db/schema.ts'
import type { LayerInfo } from '../../types/layer.ts'

const info = (id: string, name: string): LayerInfo => ({
  id,
  name,
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  alphaLock: false,
  clippingMask: false,
  locked: false,
})

describe('CanvasManager with a DocumentSession (plan M1.4)', () => {
  let cm: CanvasManager
  let container: HTMLDivElement

  beforeEach(async () => {
    cm = new CanvasManager()
    container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true })
    document.body.appendChild(container)
    await cm.init(container, 4, 4)
    // Layer thumbnails read pixels back, which the mocked renderer can't.
    vi.spyOn(cm.layerManager, 'updateThumbnails').mockImplementation(() => {})
  })

  afterEach(() => {
    cm.destroy()
    container.remove()
    vi.restoreAllMocks()
  })

  it("doesn't mark the project unsaved, or change its modified date, when a layer is chosen", async () => {
    resetDB()
    await deleteDB(DB_NAME)
    const db = new MetadataDB()
    const idb = new IdbTileBackend()
    const tiles = new TileStore({ write: idb, read: { idb } })
    const projectId = await db.createProject('Painting', 4, 4, 72)
    const blank = () => new Uint8Array(4 * 4 * 4)
    const { seq } = await tiles.save(projectId, {
      width: 4,
      height: 4,
      layers: [{ info: info('a', 'A'), pixels: blank() }, { info: info('b', 'B'), pixels: blank() }],
    })
    const modified = (await db.getProject(projectId))!.updatedAt

    // Opened as ProjectService does: the layers, then the session on top of the save.
    cm.loadDocument([{ info: info('a', 'A'), pixels: null }, { info: info('b', 'B'), pixels: null }], 'b')
    const session = new DocumentSession(projectId, db, tiles, undefined, 10)
    session.setBase({ seq, width: 4, height: 4, layers: new Set(['a', 'b']) })
    session.attach(cm)
    await new Promise((resolve) => setTimeout(resolve, 20))

    cm.layerManager.setActiveLayer('a')
    cm.syncBrushToActiveLayer()
    const unsaved = session.hasUnsavedChanges
    await session.flush()
    const record = (await db.getProject(projectId))!

    expect({ unsaved, updatedAt: record.updatedAt.getTime() }).toEqual({ unsaved: false, updatedAt: modified.getTime() })

    // Closing remembers the layer chosen, still without changing the modified date.
    expect(await session.close()).toBe(true)
    const closed = (await db.getProject(projectId))!
    expect(closed.activeLayerId).toBe('a')
    expect(closed.updatedAt.getTime()).toBe(modified.getTime())
  })
})
