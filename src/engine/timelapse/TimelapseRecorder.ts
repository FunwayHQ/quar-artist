export type TimelapseState = 'idle' | 'recording'

export type TimelapseResolution = '1080p' | '2k' | '4k'

const RESOLUTION_MAP: Record<TimelapseResolution, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '2k':    { width: 2560, height: 1440 },
  '4k':    { width: 3840, height: 2160 },
}

/**
 * Records a timelapse of the painting session using MediaRecorder + captureStream.
 * Frames are captured manually after each stroke/action via captureFrame().
 */
export class TimelapseRecorder {
  private state: TimelapseState = 'idle'
  private frameCount = 0
  private resolution: TimelapseResolution = '1080p'

  private offscreenCanvas: HTMLCanvasElement | null = null
  private offscreenCtx: CanvasRenderingContext2D | null = null
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null

  /** Reusable temp canvas for scaling source frames. */
  private srcCanvas: HTMLCanvasElement | null = null
  private srcCtx: CanvasRenderingContext2D | null = null

  /** Callback fired when frame count changes. */
  private onFrameCountChange: ((count: number) => void) | null = null

  /** Set callback for frame count updates. */
  setFrameCountCallback(cb: ((count: number) => void) | null) {
    this.onFrameCountChange = cb
  }

  getState(): TimelapseState {
    return this.state
  }

  getFrameCount(): number {
    return this.frameCount
  }

  getResolution(): TimelapseResolution {
    return this.resolution
  }

  setResolution(res: TimelapseResolution): void {
    if (this.state === 'recording') return
    this.resolution = res
  }

  /** Start recording. Creates offscreen canvas + MediaRecorder. */
  startRecording(): void {
    if (this.state === 'recording') return

    const { width, height } = RESOLUTION_MAP[this.resolution]

    this.offscreenCanvas = document.createElement('canvas')
    this.offscreenCanvas.width = width
    this.offscreenCanvas.height = height
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')

    // captureStream(0) = manual frame request mode
    this.stream = this.offscreenCanvas.captureStream(0)

    // Try VP9, fall back to VP8, then default
    const mimeTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ]
    let mimeType = ''
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        mimeType = mt
        break
      }
    }

    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data)
      }
    }

    this.mediaRecorder.start()
    this.state = 'recording'
    this.frameCount = 0
  }

  /**
   * Capture a single frame from current composite pixels.
   * Called after stroke end, flood fill, layer move, filter apply, etc.
   */
  captureFrame(pixels: Uint8ClampedArray, width: number, height: number): void {
    if (this.state !== 'recording' || !this.offscreenCtx || !this.offscreenCanvas) return

    const targetW = this.offscreenCanvas.width
    const targetH = this.offscreenCanvas.height

    // Create ImageData from the source pixels
    const imageData = new ImageData(pixels, width, height)

    // Reuse temp canvas for scaling, resize if needed
    if (!this.srcCanvas || !this.srcCtx || this.srcCanvas.width !== width || this.srcCanvas.height !== height) {
      this.srcCanvas = document.createElement('canvas')
      this.srcCanvas.width = width
      this.srcCanvas.height = height
      this.srcCtx = this.srcCanvas.getContext('2d')
      if (!this.srcCtx) return
    }

    this.srcCtx.putImageData(imageData, 0, 0)
    this.offscreenCtx.clearRect(0, 0, targetW, targetH)
    this.offscreenCtx.drawImage(this.srcCanvas!, 0, 0, width, height, 0, 0, targetW, targetH)

    // Request a frame from the stream
    const track = this.stream?.getVideoTracks()[0]
    if (track && 'requestFrame' in track) {
      ;(track as any).requestFrame()
    }

    this.frameCount++
    this.onFrameCountChange?.(this.frameCount)
  }

  /** Stop recording and return the WebM blob. */
  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (this.state !== 'recording' || !this.mediaRecorder) {
        reject(new Error('Not recording'))
        return
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' })
        this.cleanup()
        resolve(blob)
      }

      this.mediaRecorder.stop()
    })
  }

  /** Discard current recording without saving. */
  discard(): void {
    if (this.state === 'recording' && this.mediaRecorder) {
      this.mediaRecorder.onstop = null
      this.mediaRecorder.stop()
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.state = 'idle'
    this.frameCount = 0
    this.chunks = []
    this.mediaRecorder = null
    this.stream = null
    this.offscreenCanvas = null
    this.offscreenCtx = null
    this.srcCanvas = null
    this.srcCtx = null
  }
}
