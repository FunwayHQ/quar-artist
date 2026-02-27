import type { StampPosition } from '../../types/brush.ts'
import type { SymmetryType } from '../../stores/guideStore.ts'

/**
 * Pure math engine for stamp mirroring across symmetry axes.
 * Called from BrushEngine.renderStamps() to duplicate strokes.
 */
export class SymmetryEngine {
  enabled = false
  type: SymmetryType = 'vertical'
  axes = 6
  rotation = 0
  centerX = 512
  centerY = 384

  /**
   * Given original stamps, returns original + all mirrored copies.
   * When disabled, returns input unchanged.
   */
  getMirroredStamps(stamps: StampPosition[]): StampPosition[] {
    if (!this.enabled || stamps.length === 0) return stamps

    switch (this.type) {
      case 'vertical':
        return this.mirrorVertical(stamps)
      case 'horizontal':
        return this.mirrorHorizontal(stamps)
      case 'quadrant':
        return this.mirrorQuadrant(stamps)
      case 'radial':
        return this.mirrorRadial(stamps)
      default:
        return stamps
    }
  }

  private mirrorVertical(stamps: StampPosition[]): StampPosition[] {
    const result: StampPosition[] = [...stamps]
    for (const s of stamps) {
      result.push({
        ...s,
        x: 2 * this.centerX - s.x,
      })
    }
    return result
  }

  private mirrorHorizontal(stamps: StampPosition[]): StampPosition[] {
    const result: StampPosition[] = [...stamps]
    for (const s of stamps) {
      result.push({
        ...s,
        y: 2 * this.centerY - s.y,
      })
    }
    return result
  }

  private mirrorQuadrant(stamps: StampPosition[]): StampPosition[] {
    const result: StampPosition[] = [...stamps]
    for (const s of stamps) {
      // Mirror vertical
      result.push({ ...s, x: 2 * this.centerX - s.x })
      // Mirror horizontal
      result.push({ ...s, y: 2 * this.centerY - s.y })
      // Mirror both
      result.push({
        ...s,
        x: 2 * this.centerX - s.x,
        y: 2 * this.centerY - s.y,
      })
    }
    return result
  }

  private mirrorRadial(stamps: StampPosition[]): StampPosition[] {
    const n = this.axes
    if (n <= 1) return stamps

    const result: StampPosition[] = [...stamps]
    const cx = this.centerX
    const cy = this.centerY

    for (const s of stamps) {
      const dx = s.x - cx
      const dy = s.y - cy

      for (let k = 1; k < n; k++) {
        const angle = (2 * Math.PI * k) / n
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        result.push({
          ...s,
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        })
      }
    }
    return result
  }
}
