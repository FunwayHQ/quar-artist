import { useRef, useEffect, useCallback } from 'react'
import type { HSBColor } from '../../types/color.ts'
import styles from './ClassicPicker.module.css'

interface ClassicPickerProps {
  color: HSBColor
  onChange: (color: HSBColor) => void
}

const SV_SIZE = 180
const HUE_WIDTH = 20
const GAP = 8

/**
 * Classic color picker: SV square + vertical hue bar.
 * Rendered with Canvas 2D for performance.
 */
export function ClassicPicker({ color, onChange }: ClassicPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef<'none' | 'hue' | 'sv'>('none')

  const totalWidth = SV_SIZE + GAP + HUE_WIDTH

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = totalWidth * dpr
    canvas.height = SV_SIZE * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, totalWidth, SV_SIZE)

    // SV square
    const gradH = ctx.createLinearGradient(0, 0, SV_SIZE, 0)
    gradH.addColorStop(0, '#fff')
    gradH.addColorStop(1, `hsl(${color.h}, 100%, 50%)`)
    ctx.fillStyle = gradH
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE)

    const gradV = ctx.createLinearGradient(0, 0, 0, SV_SIZE)
    gradV.addColorStop(0, 'rgba(0,0,0,0)')
    gradV.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = gradV
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE)

    // SV indicator
    const sx = color.s * SV_SIZE
    const sy = (1 - color.b) * SV_SIZE
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

    // Hue bar
    const hueX = SV_SIZE + GAP
    for (let y = 0; y < SV_SIZE; y++) {
      const hue = (y / SV_SIZE) * 360
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`
      ctx.fillRect(hueX, y, HUE_WIDTH, 1)
    }

    // Hue indicator
    const hy = (color.h / 360) * SV_SIZE
    ctx.fillStyle = '#fff'
    ctx.fillRect(hueX - 2, hy - 2, HUE_WIDTH + 4, 4)
    ctx.fillStyle = '#000'
    ctx.fillRect(hueX - 1, hy - 1, HUE_WIDTH + 2, 2)
  }, [color, totalWidth])

  useEffect(() => {
    draw()
  }, [draw])

  const handlePointerEvent = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = totalWidth / rect.width
    const scaleY = SV_SIZE / rect.height
    const x = (clientX - rect.left) * scaleX
    const y = (clientY - rect.top) * scaleY

    if (draggingRef.current === 'sv') {
      const s = Math.max(0, Math.min(1, x / SV_SIZE))
      const b = Math.max(0, Math.min(1, 1 - y / SV_SIZE))
      onChange({ h: color.h, s, b })
    } else if (draggingRef.current === 'hue') {
      const h = Math.max(0, Math.min(360, (y / SV_SIZE) * 360))
      onChange({ ...color, h })
    }
  }, [color, onChange, totalWidth])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (totalWidth / rect.width)

    if (x <= SV_SIZE) {
      draggingRef.current = 'sv'
    } else if (x >= SV_SIZE + GAP) {
      draggingRef.current = 'hue'
    } else {
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handlePointerEvent(e.clientX, e.clientY)
  }, [handlePointerEvent, totalWidth])

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
      className={styles.classic}
      style={{ width: totalWidth, height: SV_SIZE }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="slider"
      aria-label="Classic color picker"
      aria-valuetext={`Hue ${Math.round(color.h)}°, Saturation ${Math.round(color.s * 100)}%, Brightness ${Math.round(color.b * 100)}%`}
    />
  )
}
