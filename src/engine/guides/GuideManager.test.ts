import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GuideManager } from './GuideManager.ts'

function createMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    closePath: vi.fn(),
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
}

describe('GuideManager', () => {
  let gm: GuideManager
  let ctx: CanvasRenderingContext2D

  beforeEach(() => {
    gm = new GuideManager()
    ctx = createMockCtx()
  })

  // ── drawOverlay dispatch ──

  it('calls drawGrid when grid enabled', () => {
    gm.gridEnabled = true
    const spy = vi.spyOn(gm, 'drawGrid')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).toHaveBeenCalledWith(ctx, 1, 1024, 768)
  })

  it('skips drawGrid when grid disabled', () => {
    gm.gridEnabled = false
    const spy = vi.spyOn(gm, 'drawGrid')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).not.toHaveBeenCalled()
  })

  it('calls drawIsometricGrid when isometric enabled', () => {
    gm.isometricEnabled = true
    const spy = vi.spyOn(gm, 'drawIsometricGrid')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).toHaveBeenCalledWith(ctx, 1, 1024, 768)
  })

  it('skips drawIsometricGrid when isometric disabled', () => {
    gm.isometricEnabled = false
    const spy = vi.spyOn(gm, 'drawIsometricGrid')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).not.toHaveBeenCalled()
  })

  it('calls drawPerspective when perspective enabled', () => {
    gm.perspectiveEnabled = true
    const spy = vi.spyOn(gm, 'drawPerspective')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).toHaveBeenCalledWith(ctx, 1, 1024, 768)
  })

  it('skips drawPerspective when perspective disabled', () => {
    gm.perspectiveEnabled = false
    const spy = vi.spyOn(gm, 'drawPerspective')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).not.toHaveBeenCalled()
  })

  it('calls drawSymmetryAxis when symmetry enabled', () => {
    gm.symmetryEnabled = true
    const spy = vi.spyOn(gm, 'drawSymmetryAxis')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).toHaveBeenCalledWith(ctx, 1, 1024, 768)
  })

  it('skips drawSymmetryAxis when symmetry disabled', () => {
    gm.symmetryEnabled = false
    const spy = vi.spyOn(gm, 'drawSymmetryAxis')
    gm.drawOverlay(ctx, 1, 1024, 768)
    expect(spy).not.toHaveBeenCalled()
  })

  // ── drawGrid ──

  it('drawGrid draws lines at spacing intervals', () => {
    gm.gridSpacing = 100
    gm.drawGrid(ctx, 1, 500, 300)
    // Vertical lines at 100, 200, 300, 400 and horizontal at 100, 200
    // Save + beginPath + strokes + restore
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.moveTo).toHaveBeenCalled()
    expect(ctx.lineTo).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
  })

  it('drawGrid sets constant 1px screen width', () => {
    gm.gridSpacing = 100
    gm.drawGrid(ctx, 2, 500, 300)
    expect(ctx.lineWidth).toBe(0.5) // 1 / zoom
  })

  it('drawGrid skips if spacing <= 0', () => {
    gm.gridSpacing = 0
    gm.drawGrid(ctx, 1, 500, 300)
    expect(ctx.beginPath).not.toHaveBeenCalled()
  })

  // ── drawSymmetryAxis ──

  it('drawSymmetryAxis draws vertical line at center', () => {
    gm.symmetryType = 'vertical'
    gm.symmetryCenterX = 512
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    expect(ctx.moveTo).toHaveBeenCalledWith(512, 0)
    expect(ctx.lineTo).toHaveBeenCalledWith(512, 768)
  })

  it('drawSymmetryAxis draws horizontal line at center', () => {
    gm.symmetryType = 'horizontal'
    gm.symmetryCenterY = 384
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 384)
    expect(ctx.lineTo).toHaveBeenCalledWith(1024, 384)
  })

  it('drawSymmetryAxis draws both lines for quadrant', () => {
    gm.symmetryType = 'quadrant'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    // Should have 4 moveTo/lineTo calls (2 lines)
    expect(ctx.moveTo).toHaveBeenCalledTimes(2)
    expect(ctx.lineTo).toHaveBeenCalledTimes(2)
  })

  it('drawSymmetryAxis draws N radial lines', () => {
    gm.symmetryType = 'radial'
    gm.symmetryAxes = 4
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    // 4 radial lines = 4 moveTo + 4 lineTo
    expect(ctx.moveTo).toHaveBeenCalledTimes(4)
    expect(ctx.lineTo).toHaveBeenCalledTimes(4)
  })

  // ── hitTestVP ──

  it('hitTestVP returns VP index when point is near VP', () => {
    gm.perspectiveEnabled = true
    gm.vanishingPoints = [{ x: 100, y: 200 }]
    expect(gm.hitTestVP(105, 202, 1)).toBe(0) // within 12px radius
  })

  it('hitTestVP returns -1 when point is far from VP', () => {
    gm.perspectiveEnabled = true
    gm.vanishingPoints = [{ x: 100, y: 200 }]
    expect(gm.hitTestVP(200, 300, 1)).toBe(-1)
  })

  it('hitTestVP returns -1 when perspective disabled', () => {
    gm.perspectiveEnabled = false
    gm.vanishingPoints = [{ x: 100, y: 200 }]
    expect(gm.hitTestVP(100, 200, 1)).toBe(-1)
  })

  it('hitTestVP checks both VPs in 2-point mode', () => {
    gm.perspectiveEnabled = true
    gm.perspectiveType = '2-point'
    gm.vanishingPoints = [{ x: 100, y: 200 }, { x: 800, y: 200 }]
    expect(gm.hitTestVP(100, 200, 1)).toBe(0)
    expect(gm.hitTestVP(800, 200, 1)).toBe(1)
    expect(gm.hitTestVP(450, 200, 1)).toBe(-1)
  })

  it('hitTestVP respects zoom-adjusted hit radius', () => {
    gm.perspectiveEnabled = true
    gm.vanishingPoints = [{ x: 100, y: 200 }]
    // At zoom=2, hit radius = 12/2 = 6px
    expect(gm.hitTestVP(105, 200, 2)).toBe(0) // 5px away, within 6
    expect(gm.hitTestVP(108, 200, 2)).toBe(-1) // 8px away, outside 6
  })

  // ── drawIsometricGrid ──

  it('drawIsometricGrid renders lines', () => {
    gm.isometricSpacing = 40
    gm.drawIsometricGrid(ctx, 1, 200, 200)
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('drawIsometricGrid skips if spacing <= 0', () => {
    gm.isometricSpacing = 0
    gm.drawIsometricGrid(ctx, 1, 200, 200)
    expect(ctx.beginPath).not.toHaveBeenCalled()
  })

  // ── drawPerspective ──

  it('drawPerspective draws horizon line and radial lines', () => {
    gm.perspectiveLineCount = 8
    gm.vanishingPoints = [{ x: 512, y: 384 }]
    gm.horizonY = 384
    gm.drawPerspective(ctx, 1, 1024, 768)
    // Should have multiple moveTo/lineTo calls
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    // VP handle should be drawn (arc call)
    expect(ctx.arc).toHaveBeenCalled()
  })

  it('drawPerspective skips if lineCount <= 0', () => {
    gm.perspectiveLineCount = 0
    gm.drawPerspective(ctx, 1, 1024, 768)
    expect(ctx.beginPath).not.toHaveBeenCalled()
  })

  it('drawPerspective draws 2 VP handles in 2-point mode', () => {
    gm.perspectiveLineCount = 8
    gm.perspectiveType = '2-point'
    gm.vanishingPoints = [{ x: 100, y: 200 }, { x: 800, y: 200 }]
    gm.drawPerspective(ctx, 1, 1024, 768)
    // 2 VP handles = 2 arc calls
    expect(ctx.arc).toHaveBeenCalledTimes(2)
  })

  // ── hitTestSymmetryCenter ──

  it('hitTestSymmetryCenter returns true when near center in quadrant mode', () => {
    gm.symmetryEnabled = true
    gm.symmetryType = 'quadrant'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    expect(gm.hitTestSymmetryCenter(515, 386, 1)).toBe(true)
  })

  it('hitTestSymmetryCenter returns true when near center in radial mode', () => {
    gm.symmetryEnabled = true
    gm.symmetryType = 'radial'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    expect(gm.hitTestSymmetryCenter(512, 384, 1)).toBe(true)
  })

  it('hitTestSymmetryCenter returns false for vertical/horizontal modes', () => {
    gm.symmetryEnabled = true
    gm.symmetryType = 'vertical'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    expect(gm.hitTestSymmetryCenter(512, 384, 1)).toBe(false)
  })

  it('hitTestSymmetryCenter returns false when symmetry disabled', () => {
    gm.symmetryEnabled = false
    gm.symmetryType = 'quadrant'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    expect(gm.hitTestSymmetryCenter(512, 384, 1)).toBe(false)
  })

  it('hitTestSymmetryCenter returns false when far from center', () => {
    gm.symmetryEnabled = true
    gm.symmetryType = 'quadrant'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    expect(gm.hitTestSymmetryCenter(600, 500, 1)).toBe(false)
  })

  it('hitTestSymmetryCenter respects zoom-adjusted hit radius', () => {
    gm.symmetryEnabled = true
    gm.symmetryType = 'quadrant'
    gm.symmetryCenterX = 100
    gm.symmetryCenterY = 200
    // At zoom=2, hit radius = 12/2 = 6px
    expect(gm.hitTestSymmetryCenter(105, 200, 2)).toBe(true)   // 5px away, within 6
    expect(gm.hitTestSymmetryCenter(108, 200, 2)).toBe(false)   // 8px away, outside 6
  })

  // ── drawSymmetryAxis with center handle ──

  it('drawSymmetryAxis draws center handle for quadrant mode', () => {
    gm.symmetryType = 'quadrant'
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    // Center handle draws an arc
    expect(ctx.arc).toHaveBeenCalledTimes(1)
  })

  it('drawSymmetryAxis draws center handle for radial mode', () => {
    gm.symmetryType = 'radial'
    gm.symmetryAxes = 4
    gm.symmetryCenterX = 512
    gm.symmetryCenterY = 384
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    // Center handle draws an arc
    expect(ctx.arc).toHaveBeenCalledTimes(1)
  })

  it('drawSymmetryAxis does not draw center handle for vertical mode', () => {
    gm.symmetryType = 'vertical'
    gm.symmetryCenterX = 512
    gm.drawSymmetryAxis(ctx, 1, 1024, 768)
    expect(ctx.arc).not.toHaveBeenCalled()
  })
})
