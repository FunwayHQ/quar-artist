import { useRef, useEffect, useCallback } from 'react'
import type { HSBColor, HarmonyMode } from '../../types/color.ts'
import { getHarmonyHues, hsbToHex } from '../../types/color.ts'
import styles from './ColorDisc.module.css'

interface ColorDiscProps {
  color: HSBColor
  harmonyMode: HarmonyMode
  onChange: (color: HSBColor) => void
}

const DISC_SIZE = 200
const RING_WIDTH = 16
const SV_MARGIN = 6

/**
 * HSB Color Disc: outer hue ring + inner SB square.
 * Rendered with Canvas 2D for performance.
 */
export function ColorDisc({ color, harmonyMode, onChange }: ColorDiscProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef<'none' | 'hue' | 'sv'>('none')

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const size = DISC_SIZE
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size, size)

    const cx = size / 2
    const cy = size / 2
    const outerR = size / 2 - 1
    const innerR = outerR - RING_WIDTH

    // Draw hue ring
    for (let angle = 0; angle < 360; angle += 1) {
      const rad = (angle - 90) * (Math.PI / 180)
      const nextRad = (angle - 89) * (Math.PI / 180)
      ctx.beginPath()
      ctx.arc(cx, cy, outerR, rad, nextRad)
      ctx.arc(cx, cy, innerR, nextRad, rad, true)
      ctx.closePath()
      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`
      ctx.fill()
    }

    // Draw hue indicator
    const hueRad = (color.h - 90) * (Math.PI / 180)
    const hueIndicatorR = (outerR + innerR) / 2
    const hx = cx + Math.cos(hueRad) * hueIndicatorR
    const hy = cy + Math.sin(hueRad) * hueIndicatorR
    ctx.beginPath()
    ctx.arc(hx, hy, RING_WIDTH / 2 - 1, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(hx, hy, RING_WIDTH / 2 - 3, 0, Math.PI * 2)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()

    // Draw harmony dots on hue ring
    const harmonyHues = getHarmonyHues(color.h, harmonyMode)
    for (const hh of harmonyHues) {
      const hr = (hh - 90) * (Math.PI / 180)
      const dhx = cx + Math.cos(hr) * hueIndicatorR
      const dhy = cy + Math.sin(hr) * hueIndicatorR
      ctx.beginPath()
      ctx.arc(dhx, dhy, 4, 0, Math.PI * 2)
      ctx.fillStyle = hsbToHex({ h: hh, s: 1, b: 1 })
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Draw SB square inside the ring
    const svSize = (innerR - SV_MARGIN) * Math.SQRT2
    const svX = cx - svSize / 2
    const svY = cy - svSize / 2

    // S gradient (left white to right pure hue)
    const gradH = ctx.createLinearGradient(svX, svY, svX + svSize, svY)
    gradH.addColorStop(0, '#fff')
    gradH.addColorStop(1, `hsl(${color.h}, 100%, 50%)`)
    ctx.fillStyle = gradH
    ctx.fillRect(svX, svY, svSize, svSize)

    // B gradient (bottom black overlay)
    const gradV = ctx.createLinearGradient(svX, svY, svX, svY + svSize)
    gradV.addColorStop(0, 'rgba(0,0,0,0)')
    gradV.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = gradV
    ctx.fillRect(svX, svY, svSize, svSize)

    // SB indicator
    const sx = svX + color.s * svSize
    const sy = svY + (1 - color.b) * svSize
    ctx.beginPath()
    ctx.arc(sx, sy, 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(sx, sy, 4, 0, Math.PI * 2)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [color, harmonyMode])

  useEffect(() => {
    draw()
  }, [draw])

  const getInteraction = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left) * (DISC_SIZE / rect.width)
    const y = (clientY - rect.top) * (DISC_SIZE / rect.height)

    const cx = DISC_SIZE / 2
    const cy = DISC_SIZE / 2
    const dx = x - cx
    const dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    const outerR = DISC_SIZE / 2 - 1
    const innerR = outerR - RING_WIDTH

    // Check if in hue ring
    if (dist >= innerR - 4 && dist <= outerR + 4) {
      return 'hue' as const
    }

    // Check if in SV square
    const svSize = (innerR - SV_MARGIN) * Math.SQRT2
    const svX = cx - svSize / 2
    const svY = cy - svSize / 2
    if (x >= svX && x <= svX + svSize && y >= svY && y <= svY + svSize) {
      return 'sv' as const
    }

    return null
  }, [])

  const handlePointerEvent = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left) * (DISC_SIZE / rect.width)
    const y = (clientY - rect.top) * (DISC_SIZE / rect.height)

    const cx = DISC_SIZE / 2
    const cy = DISC_SIZE / 2
    const outerR = DISC_SIZE / 2 - 1
    const innerR = outerR - RING_WIDTH

    if (draggingRef.current === 'hue') {
      const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI) + 90
      const h = ((angle % 360) + 360) % 360
      onChange({ ...color, h })
    } else if (draggingRef.current === 'sv') {
      const svSize = (innerR - SV_MARGIN) * Math.SQRT2
      const svX = cx - svSize / 2
      const svY = cy - svSize / 2
      const s = Math.max(0, Math.min(1, (x - svX) / svSize))
      const b = Math.max(0, Math.min(1, 1 - (y - svY) / svSize))
      onChange({ h: color.h, s, b })
    }
  }, [color, onChange])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const interaction = getInteraction(e.clientX, e.clientY)
    if (!interaction) return
    draggingRef.current = interaction
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handlePointerEvent(e.clientX, e.clientY)
  }, [getInteraction, handlePointerEvent])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current === 'none') return
    handlePointerEvent(e.clientX, e.clientY)
  }, [handlePointerEvent])

  const handlePointerUp = useCallback(() => {
    draggingRef.current = 'none'
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={styles.disc}
      style={{ width: DISC_SIZE, height: DISC_SIZE }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="slider"
      aria-label="Color disc"
      aria-valuetext={`Hue ${Math.round(color.h)}°, Saturation ${Math.round(color.s * 100)}%, Brightness ${Math.round(color.b * 100)}%`}
    />
  )
}
