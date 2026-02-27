import { useRef, useEffect, useCallback, useState } from 'react'
import type { CurvePoint } from '@app-types/filter.ts'
import { computeSingleChannelLUT } from '@engine/shaders/filters/curvesFilter.ts'
import styles from './CurvesEditor.module.css'

interface CurvesEditorProps {
  points: CurvePoint[]
  onChange: (points: CurvePoint[]) => void
  channelColor?: string
}

const CANVAS_SIZE = 256
const DISPLAY_SIZE = 256
const POINT_RADIUS = 5
const SNAP_DISTANCE = 10

export function CurvesEditor({ points, onChange, channelColor = '#F59E0B' }: CurvesEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)

  const toCanvas = (p: CurvePoint) => ({
    x: p.x * DISPLAY_SIZE / 255,
    y: DISPLAY_SIZE - (p.y * DISPLAY_SIZE / 255),
  })

  const fromCanvas = (cx: number, cy: number): CurvePoint => ({
    x: Math.round(Math.max(0, Math.min(255, cx * 255 / DISPLAY_SIZE))),
    y: Math.round(Math.max(0, Math.min(255, (DISPLAY_SIZE - cy) * 255 / DISPLAY_SIZE))),
  })

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = DISPLAY_SIZE / rect.width
    const scaleY = DISPLAY_SIZE / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  const findPointIndex = useCallback((cx: number, cy: number): number => {
    for (let i = 0; i < points.length; i++) {
      const cp = toCanvas(points[i])
      const dist = Math.sqrt((cx - cp.x) ** 2 + (cy - cp.y) ** 2)
      if (dist <= SNAP_DISTANCE) return i
    }
    return -1
  }, [points])

  // Draw the curve
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const pos = (CANVAS_SIZE / 4) * i
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, CANVAS_SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(CANVAS_SIZE, pos)
      ctx.stroke()
    }

    // Diagonal guide (identity line)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, CANVAS_SIZE)
    ctx.lineTo(CANVAS_SIZE, 0)
    ctx.stroke()
    ctx.setLineDash([])

    // Compute and draw the curve from LUT
    const lut = computeSingleChannelLUT(points)
    ctx.strokeStyle = channelColor
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x < 256; x++) {
      const y = CANVAS_SIZE - lut[x] * CANVAS_SIZE
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Draw control points
    for (const point of points) {
      const cp = toCanvas(point)
      ctx.beginPath()
      ctx.arc(cp.x, cp.y, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = channelColor
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }, [points, channelColor])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e)
    const idx = findPointIndex(x, y)

    if (idx >= 0) {
      setDraggingIndex(idx)
    } else {
      // Add new point
      const newPoint = fromCanvas(x, y)
      const newPoints = [...points, newPoint].sort((a, b) => a.x - b.x)
      onChange(newPoints)
      // Find the index of the newly added point
      const newIdx = newPoints.findIndex((p) => p.x === newPoint.x && p.y === newPoint.y)
      setDraggingIndex(newIdx)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingIndex === null) return

    const { x, y } = getCanvasCoords(e)
    const newPoint = fromCanvas(x, y)

    // Don't allow moving endpoints past boundaries (keep first and last fixed at x extremes)
    const isFirst = draggingIndex === 0
    const isLast = draggingIndex === points.length - 1

    if (isFirst) newPoint.x = 0
    if (isLast) newPoint.x = 255

    // Clamp x between neighbors
    if (!isFirst && draggingIndex > 0) {
      newPoint.x = Math.max(points[draggingIndex - 1].x + 1, newPoint.x)
    }
    if (!isLast && draggingIndex < points.length - 1) {
      newPoint.x = Math.min(points[draggingIndex + 1].x - 1, newPoint.x)
    }

    const newPoints = [...points]
    newPoints[draggingIndex] = newPoint
    onChange(newPoints)
  }

  const handleMouseUp = () => {
    setDraggingIndex(null)
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e)
    const idx = findPointIndex(x, y)

    // Delete point (but not endpoints)
    if (idx > 0 && idx < points.length - 1) {
      const newPoints = points.filter((_, i) => i !== idx)
      onChange(newPoints)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    />
  )
}
