import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TimelapseRecorder } from './TimelapseRecorder.ts'

// Polyfill ImageData for jsdom
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(sw: number | Uint8ClampedArray, sh?: number, _sett?: any) {
      if (typeof sw === 'number') {
        this.width = sw
        this.height = sh!
        this.data = new Uint8ClampedArray(sw * sh! * 4)
      } else {
        this.data = sw
        this.width = sh!
        this.height = _sett
      }
    }
  }
}

// ── Mock MediaRecorder ──
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true)

  state = 'inactive'
  ondataavailable: ((e: any) => void) | null = null
  onstop: (() => void) | null = null

  constructor(
    public stream: MediaStream,
    public options?: MediaRecorderOptions,
  ) {}

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    // Simulate data available
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['test-data'], { type: 'video/webm' }) })
    }
    if (this.onstop) {
      this.onstop()
    }
  }
}

// ── Mock captureStream ──
const mockRequestFrame = vi.fn()
const mockTrack = { requestFrame: mockRequestFrame }
const mockStream = {
  getVideoTracks: vi.fn().mockReturnValue([mockTrack]),
} as unknown as MediaStream

// Define captureStream on HTMLCanvasElement.prototype if it doesn't exist (jsdom)
if (!HTMLCanvasElement.prototype.captureStream) {
  HTMLCanvasElement.prototype.captureStream = function () {
    return mockStream
  }
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockReturnValue(mockStream)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
  } as any)
  mockRequestFrame.mockClear()
})

describe('TimelapseRecorder', () => {
  it('starts in idle state with 0 frames', () => {
    const recorder = new TimelapseRecorder()
    expect(recorder.getState()).toBe('idle')
    expect(recorder.getFrameCount()).toBe(0)
  })

  it('transitions to recording state on startRecording', () => {
    const recorder = new TimelapseRecorder()
    recorder.startRecording()
    expect(recorder.getState()).toBe('recording')
    expect(recorder.getFrameCount()).toBe(0)
  })

  it('increments frame count on captureFrame', () => {
    const recorder = new TimelapseRecorder()
    recorder.startRecording()

    const pixels = new Uint8ClampedArray(4 * 4 * 4) // 4x4 image
    recorder.captureFrame(pixels, 4, 4)
    expect(recorder.getFrameCount()).toBe(1)

    recorder.captureFrame(pixels, 4, 4)
    expect(recorder.getFrameCount()).toBe(2)
  })

  it('calls requestFrame on the video track', () => {
    const recorder = new TimelapseRecorder()
    recorder.startRecording()

    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    recorder.captureFrame(pixels, 4, 4)
    expect(mockRequestFrame).toHaveBeenCalledTimes(1)
  })

  it('ignores captureFrame when not recording', () => {
    const recorder = new TimelapseRecorder()
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    recorder.captureFrame(pixels, 4, 4)
    expect(recorder.getFrameCount()).toBe(0)
  })

  it('returns a blob on stopRecording', async () => {
    const recorder = new TimelapseRecorder()
    recorder.startRecording()

    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    recorder.captureFrame(pixels, 4, 4)

    const blob = await recorder.stopRecording()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('video/webm')
    expect(recorder.getState()).toBe('idle')
    expect(recorder.getFrameCount()).toBe(0)
  })

  it('rejects stopRecording when not recording', async () => {
    const recorder = new TimelapseRecorder()
    await expect(recorder.stopRecording()).rejects.toThrow('Not recording')
  })

  it('resets state on discard', () => {
    const recorder = new TimelapseRecorder()
    recorder.startRecording()
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    recorder.captureFrame(pixels, 4, 4)
    recorder.captureFrame(pixels, 4, 4)

    recorder.discard()
    expect(recorder.getState()).toBe('idle')
    expect(recorder.getFrameCount()).toBe(0)
  })

  it('uses the configured resolution', () => {
    const recorder = new TimelapseRecorder()
    recorder.setResolution('4k')
    expect(recorder.getResolution()).toBe('4k')
  })

  it('prevents resolution change while recording', () => {
    const recorder = new TimelapseRecorder()
    recorder.setResolution('2k')
    recorder.startRecording()
    recorder.setResolution('4k')
    expect(recorder.getResolution()).toBe('2k')
  })

  it('does not start recording if already recording', () => {
    const recorder = new TimelapseRecorder()
    recorder.startRecording()
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    recorder.captureFrame(pixels, 4, 4)

    // Starting again should not reset frame count
    recorder.startRecording()
    expect(recorder.getFrameCount()).toBe(1)
  })

  it('detects codec support via isTypeSupported', () => {
    MockMediaRecorder.isTypeSupported.mockReturnValueOnce(false)
    MockMediaRecorder.isTypeSupported.mockReturnValueOnce(true) // VP8

    const recorder = new TimelapseRecorder()
    recorder.startRecording()
    expect(recorder.getState()).toBe('recording')
  })
})
