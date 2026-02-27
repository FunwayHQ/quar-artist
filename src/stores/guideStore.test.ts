import { describe, it, expect, beforeEach } from 'vitest'
import { useGuideStore } from './guideStore.ts'

describe('guideStore', () => {
  beforeEach(() => {
    useGuideStore.getState().resetGuides()
  })

  // ── Defaults ──

  it('has correct default values', () => {
    const s = useGuideStore.getState()
    expect(s.gridEnabled).toBe(false)
    expect(s.gridSpacing).toBe(32)
    expect(s.gridSnap).toBe(false)
    expect(s.gridColor).toBe('#ffffff')
    expect(s.gridOpacity).toBe(0.15)
    expect(s.isometricEnabled).toBe(false)
    expect(s.isometricSpacing).toBe(32)
    expect(s.perspectiveEnabled).toBe(false)
    expect(s.perspectiveType).toBe('1-point')
    expect(s.vanishingPoints).toEqual([{ x: 512, y: 384 }])
    expect(s.horizonY).toBe(384)
    expect(s.perspectiveLineCount).toBe(12)
    expect(s.symmetryEnabled).toBe(false)
    expect(s.symmetryType).toBe('vertical')
    expect(s.symmetryAxes).toBe(6)
    expect(s.symmetryRotation).toBe(0)
    expect(s.symmetryCenterX).toBe(512)
    expect(s.symmetryCenterY).toBe(384)
    expect(s.symmetryColor).toBe('#F59E0B')
    expect(s.quickShapeEnabled).toBe(false)
  })

  // ── Grid setters ──

  it('setGridEnabled toggles grid', () => {
    useGuideStore.getState().setGridEnabled(true)
    expect(useGuideStore.getState().gridEnabled).toBe(true)
    useGuideStore.getState().setGridEnabled(false)
    expect(useGuideStore.getState().gridEnabled).toBe(false)
  })

  it('setGridSpacing updates spacing', () => {
    useGuideStore.getState().setGridSpacing(64)
    expect(useGuideStore.getState().gridSpacing).toBe(64)
  })

  it('setGridSnap updates snap', () => {
    useGuideStore.getState().setGridSnap(true)
    expect(useGuideStore.getState().gridSnap).toBe(true)
  })

  it('setGridColor updates color', () => {
    useGuideStore.getState().setGridColor('#ff0000')
    expect(useGuideStore.getState().gridColor).toBe('#ff0000')
  })

  it('setGridOpacity updates opacity', () => {
    useGuideStore.getState().setGridOpacity(0.5)
    expect(useGuideStore.getState().gridOpacity).toBe(0.5)
  })

  // ── Isometric setters ──

  it('setIsometricEnabled toggles isometric', () => {
    useGuideStore.getState().setIsometricEnabled(true)
    expect(useGuideStore.getState().isometricEnabled).toBe(true)
  })

  it('setIsometricSpacing updates spacing', () => {
    useGuideStore.getState().setIsometricSpacing(48)
    expect(useGuideStore.getState().isometricSpacing).toBe(48)
  })

  // ── Perspective setters ──

  it('setPerspectiveEnabled toggles perspective', () => {
    useGuideStore.getState().setPerspectiveEnabled(true)
    expect(useGuideStore.getState().perspectiveEnabled).toBe(true)
  })

  it('setPerspectiveType updates type', () => {
    useGuideStore.getState().setPerspectiveType('2-point')
    expect(useGuideStore.getState().perspectiveType).toBe('2-point')
  })

  it('setVanishingPoints updates VPs', () => {
    const vps = [{ x: 100, y: 200 }, { x: 800, y: 200 }]
    useGuideStore.getState().setVanishingPoints(vps)
    expect(useGuideStore.getState().vanishingPoints).toEqual(vps)
  })

  it('setHorizonY updates horizon', () => {
    useGuideStore.getState().setHorizonY(512)
    expect(useGuideStore.getState().horizonY).toBe(512)
  })

  it('setPerspectiveLineCount updates line count', () => {
    useGuideStore.getState().setPerspectiveLineCount(24)
    expect(useGuideStore.getState().perspectiveLineCount).toBe(24)
  })

  // ── Symmetry setters ──

  it('setSymmetryEnabled toggles symmetry', () => {
    useGuideStore.getState().setSymmetryEnabled(true)
    expect(useGuideStore.getState().symmetryEnabled).toBe(true)
  })

  it('setSymmetryType updates type', () => {
    useGuideStore.getState().setSymmetryType('radial')
    expect(useGuideStore.getState().symmetryType).toBe('radial')
  })

  it('setSymmetryAxes updates axes', () => {
    useGuideStore.getState().setSymmetryAxes(8)
    expect(useGuideStore.getState().symmetryAxes).toBe(8)
  })

  it('setSymmetryRotation updates rotation', () => {
    useGuideStore.getState().setSymmetryRotation(Math.PI / 4)
    expect(useGuideStore.getState().symmetryRotation).toBeCloseTo(Math.PI / 4)
  })

  it('setSymmetryCenterX/Y updates center', () => {
    useGuideStore.getState().setSymmetryCenterX(256)
    useGuideStore.getState().setSymmetryCenterY(128)
    expect(useGuideStore.getState().symmetryCenterX).toBe(256)
    expect(useGuideStore.getState().symmetryCenterY).toBe(128)
  })

  it('setSymmetryColor updates color', () => {
    useGuideStore.getState().setSymmetryColor('#00ff00')
    expect(useGuideStore.getState().symmetryColor).toBe('#00ff00')
  })

  // ── QuickShape ──

  it('setQuickShapeEnabled toggles quickshape', () => {
    useGuideStore.getState().setQuickShapeEnabled(true)
    expect(useGuideStore.getState().quickShapeEnabled).toBe(true)
  })

  // ── Reset ──

  it('resetGuides restores all defaults', () => {
    const s = useGuideStore.getState()
    s.setGridEnabled(true)
    s.setGridSpacing(128)
    s.setSymmetryEnabled(true)
    s.setSymmetryType('radial')
    s.setPerspectiveEnabled(true)
    s.setQuickShapeEnabled(true)

    s.resetGuides()

    const after = useGuideStore.getState()
    expect(after.gridEnabled).toBe(false)
    expect(after.gridSpacing).toBe(32)
    expect(after.symmetryEnabled).toBe(false)
    expect(after.symmetryType).toBe('vertical')
    expect(after.perspectiveEnabled).toBe(false)
    expect(after.quickShapeEnabled).toBe(false)
  })
})
