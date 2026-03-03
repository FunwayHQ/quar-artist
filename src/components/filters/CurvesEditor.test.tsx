import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CurvesEditor } from './CurvesEditor.tsx'

// Mock computeSingleChannelLUT to avoid heavy computation in tests
vi.mock('@engine/shaders/filters/curvesFilter.ts', () => ({
  computeSingleChannelLUT: () => {
    const lut = new Float32Array(256)
    for (let i = 0; i < 256; i++) lut[i] = i / 255
    return lut
  },
}))

// Mock canvas 2D context
const mockCtx = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  setLineDash: vi.fn(),
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Mock canvas getContext
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx)
  // Mock pointer capture (not in jsdom)
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = vi.fn()
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  }
})

describe('CurvesEditor', () => {
  const defaultPoints = [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]

  it('renders a canvas element', () => {
    const { container } = render(
      <CurvesEditor points={defaultPoints} onChange={vi.fn()} />,
    )
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas!.width).toBe(256)
    expect(canvas!.height).toBe(256)
  })

  it('draws the curve on mount', () => {
    render(<CurvesEditor points={defaultPoints} onChange={vi.fn()} />)
    // Should have drawn grid lines and curve
    expect(mockCtx.beginPath).toHaveBeenCalled()
    expect(mockCtx.stroke).toHaveBeenCalled()
  })

  it('calls onChange when clicking to add a point', () => {
    const onChange = vi.fn()
    const { container } = render(
      <CurvesEditor points={defaultPoints} onChange={onChange} />,
    )
    const canvas = container.querySelector('canvas')!

    // Mock getBoundingClientRect
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 256,
      bottom: 256,
      width: 256,
      height: 256,
      x: 0,
      y: 0,
      toJSON: () => {},
    }))

    // Click in the middle of the canvas (away from existing points)
    fireEvent.pointerDown(canvas, { clientX: 128, clientY: 128, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    const newPoints = onChange.mock.calls[0][0]
    expect(newPoints.length).toBe(3) // original 2 + 1 new
  })

  it('calls onChange when double-clicking to delete a non-endpoint', () => {
    const onChange = vi.fn()
    const points = [
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ]
    const { container } = render(
      <CurvesEditor points={points} onChange={onChange} />,
    )
    const canvas = container.querySelector('canvas')!

    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 256,
      bottom: 256,
      width: 256,
      height: 256,
      x: 0,
      y: 0,
      toJSON: () => {},
    }))

    // Double-click on the middle point (128, 200 in curve space = 128, 256-200*256/255 in canvas)
    const canvasX = 128
    const canvasY = 256 - (200 * 256 / 255)
    fireEvent.doubleClick(canvas, { clientX: canvasX, clientY: canvasY })
    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastCall.length).toBe(2) // removed middle point
  })
})
