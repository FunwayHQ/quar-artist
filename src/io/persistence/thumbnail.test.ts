import { describe, it, expect, vi, afterEach } from 'vitest'
import { THUMBNAIL_ENCODE_MS, THUMBNAIL_MAX_SIDE, encodeLayersThumbnail, encodeThumbnail, thumbnailSize } from './thumbnail.ts'

describe('thumbnailSize', () => {
  it('fits the longest side to the thumbnail size, keeping the aspect ratio', () => {
    expect(thumbnailSize(1920, 1080)).toEqual({ width: THUMBNAIL_MAX_SIDE, height: 225 })
    expect(thumbnailSize(2480, 3508)).toEqual({ width: 283, height: THUMBNAIL_MAX_SIDE })
  })

  it('never enlarges a small document', () => {
    expect(thumbnailSize(64, 48)).toEqual({ width: 64, height: 48 })
  })

  it('keeps at least one pixel on a very thin document', () => {
    expect(thumbnailSize(8192, 1)).toEqual({ width: THUMBNAIL_MAX_SIDE, height: 1 })
  })
})

describe('encodeThumbnail', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  class FakeImageData {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
    }
  }

  /** jsdom has no 2D canvas: stand in one whose encoder returns `encoded`. */
  function fakeCanvas(encoded: Blob | null) {
    const ctx = { putImageData: vi.fn(), drawImage: vi.fn(), globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingQuality: 'low' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(encoded))
    vi.stubGlobal('ImageData', FakeImageData)
  }

  it('returns the encoded image as bytes with its type, which every browser can store', async () => {
    fakeCanvas(new Blob([new Uint8Array([9, 8, 7])], { type: 'image/webp' }))
    const image = await encodeThumbnail(new Uint8Array(16), 2, 2)
    expect(image?.type).toBe('image/webp')
    expect(image?.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(image!.data)).toEqual(new Uint8Array([9, 8, 7]))
  })

  it('gives up, returning null, on an encoder that never calls back', async () => {
    fakeCanvas(null)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      const image = encodeThumbnail(new Uint8Array(16), 2, 2)
      await vi.advanceTimersByTimeAsync(THUMBNAIL_ENCODE_MS)
      expect(await image).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns null when the image can't be encoded", async () => {
    fakeCanvas(null)
    expect(await encodeThumbnail(new Uint8Array(16), 2, 2)).toBeNull()
  })

  it("draws on an OffscreenCanvas in a worker, encoding with convertToBlob, not Firefox's old toBlob, which never calls back", async () => {
    const ctx = { putImageData: vi.fn(), drawImage: vi.fn(), globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingQuality: 'low' }
    const toBlob = vi.fn(() => new Promise(() => {}))
    class FakeOffscreenCanvas {
      readonly width: number
      readonly height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext() {
        return ctx
      }
      convertToBlob({ type }: { type: string }) {
        return Promise.resolve(new Blob([new Uint8Array([1, 2])], { type }))
      }
      toBlob = toBlob
    }
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    vi.stubGlobal('ImageData', FakeImageData)

    const image = await encodeLayersThumbnail([{ pixels: new Uint8Array(16), opacity: 1, visible: true, blendMode: 'normal' }], 2, 2, 'image/png')

    expect(image?.type).toBe('image/png')
    expect(new Uint8Array(image!.data)).toEqual(new Uint8Array([1, 2]))
    expect(toBlob).not.toHaveBeenCalled()
  })

  it('returns null without a 2D canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(await encodeThumbnail(new Uint8Array(16), 2, 2)).toBeNull()
  })
})

