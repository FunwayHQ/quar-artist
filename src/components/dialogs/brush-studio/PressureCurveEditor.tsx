import { useRef, useEffect, useCallback, useState } from 'react'
import type { PressureCurvePoints } from '@engine/brush/PressureCurve.ts'

interface PressureCurveEditorProps {
  value: PressureCurvePoints
  onChange: (curve: PressureCurvePoints) => void
  size?: number
}

export function PressureCurveEditor({ value, onChange, size = 200 }: PressureCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = useState<1 | 2 | null>(null)

  // CSS coordinates → normalized [0,1]
  const fromCSS = useCallback((cx: number, cy: number) => ({
    x: Math.max(0, Math.min(1, cx / size)),
    y: Math.max(0, Math.min(1, 1 - cy / size)),
  }), [size])

  // Normalized [0,1] → CSS coordinates
  const toCSS = useCallback((nx: number, ny: number) => ({
    x: nx * size,
    y: (1 - ny) * size,
  }), [size])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    // All drawing from here uses CSS-space coordinates (0..size)
    const w = size
    const h = size

    ctx.clearRect(0, 0, w, h)

    // Background with subtle gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
    bgGrad.addColorStop(0, 'rgba(15, 15, 17, 0.9)')
    bgGrad.addColorStop(1, 'rgba(8, 8, 10, 0.95)')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, w, h)

    // Grid lines — subtle crosshatch
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const pos = (i / 4) * w
      const alpha = i === 2 ? 0.08 : 0.04
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(w, pos)
      ctx.stroke()
    }

    // Diagonal reference (linear) — dashed
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(w, 0)
    ctx.stroke()
    ctx.setLineDash([])

    const [cp1x, cp1y, cp2x, cp2y] = value
    const p0 = toCSS(0, 0)
    const p1 = toCSS(cp1x, cp1y)
    const p2 = toCSS(cp2x, cp2y)
    const p3 = toCSS(1, 1)

    // Control arm lines — thin, amber-tinted
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(p3.x, p3.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()

    // Curve glow (blurred under-layer)
    ctx.save()
    ctx.filter = 'blur(4px)'
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
    ctx.stroke()
    ctx.restore()

    // Main Bezier curve
    ctx.strokeStyle = '#F59E0B'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
    ctx.stroke()

    // Control points — amber circles with glow
    for (const cp of [p1, p2]) {
      // Glow
      ctx.save()
      ctx.filter = 'blur(3px)'
      ctx.fillStyle = 'rgba(245, 158, 11, 0.5)'
      ctx.beginPath()
      ctx.arc(cp.x, cp.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Solid point
      ctx.fillStyle = '#F59E0B'
      ctx.beginPath()
      ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2)
      ctx.fill()

      // Inner dot
      ctx.fillStyle = 'rgba(10, 10, 11, 0.5)'
      ctx.beginPath()
      ctx.arc(cp.x, cp.y, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Endpoints — small subtle dots
    for (const ep of [p0, p3]) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.beginPath()
      ctx.arc(ep.x, ep.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Axis labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.font = "8px 'IBM Plex Mono', monospace"
    ctx.textAlign = 'center'
    ctx.fillText('PRESSURE', w / 2, h - 4)
    ctx.save()
    ctx.translate(10, h / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('OUTPUT', 0, 0)
    ctx.restore()
  }, [value, size, toCSS])

  useEffect(() => {
    draw()
  }, [draw])

  const getCanvasPos = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const pos = getCanvasPos(e)
    const p1 = toCSS(value[0], value[1])
    const p2 = toCSS(value[2], value[3])

    const dist1 = Math.hypot(pos.x - p1.x, pos.y - p1.y)
    const dist2 = Math.hypot(pos.x - p2.x, pos.y - p2.y)

    if (dist1 < 20 && dist1 <= dist2) {
      setDragging(1)
    } else if (dist2 < 20) {
      setDragging(2)
    }
  }, [value, toCSS, getCanvasPos])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    e.preventDefault()
    const pos = getCanvasPos(e)
    const { x, y } = fromCSS(pos.x, pos.y)

    if (dragging === 1) {
      onChange([x, y, value[2], value[3]])
    } else {
      onChange([value[0], value[1], x, y])
    }
  }, [dragging, value, onChange, fromCSS, getCanvasPos])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-subtle)',
        cursor: dragging ? 'grabbing' : 'crosshair',
        display: 'block',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  )
}
