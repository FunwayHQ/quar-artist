import { create } from 'zustand'
import type { DocumentGuides, PerspectiveType, SymmetryType, VanishingPoint } from '../types/guides.ts'

export type { DocumentGuides, PerspectiveType, SymmetryType, VanishingPoint }

interface GuideStore {
  // Grid
  gridEnabled: boolean
  gridSpacing: number
  gridSnap: boolean
  gridColor: string
  gridOpacity: number

  // Isometric
  isometricEnabled: boolean
  isometricSpacing: number

  // Perspective
  perspectiveEnabled: boolean
  perspectiveType: PerspectiveType
  vanishingPoints: VanishingPoint[]
  horizonY: number
  perspectiveLineCount: number

  // Symmetry
  symmetryEnabled: boolean
  symmetryType: SymmetryType
  symmetryAxes: number
  symmetryRotation: number
  symmetryCenterX: number
  symmetryCenterY: number
  symmetryColor: string

  // QuickShape
  quickShapeEnabled: boolean

  // Actions
  setGridEnabled: (v: boolean) => void
  setGridSpacing: (v: number) => void
  setGridSnap: (v: boolean) => void
  setGridColor: (v: string) => void
  setGridOpacity: (v: number) => void
  setIsometricEnabled: (v: boolean) => void
  setIsometricSpacing: (v: number) => void
  setPerspectiveEnabled: (v: boolean) => void
  setPerspectiveType: (v: PerspectiveType) => void
  setVanishingPoints: (v: VanishingPoint[]) => void
  setHorizonY: (v: number) => void
  setPerspectiveLineCount: (v: number) => void
  setSymmetryEnabled: (v: boolean) => void
  setSymmetryType: (v: SymmetryType) => void
  setSymmetryAxes: (v: number) => void
  setSymmetryRotation: (v: number) => void
  setSymmetryCenterX: (v: number) => void
  setSymmetryCenterY: (v: number) => void
  setSymmetryColor: (v: string) => void
  setQuickShapeEnabled: (v: boolean) => void
  /** Show a document's guides (opening it, plan M1.4). QuickShape stays as it is. */
  loadGuides: (guides: DocumentGuides) => void
  /** Every guide off, centred on a document of this size, and QuickShape off. */
  resetGuides: (width?: number, height?: number) => void
}

/** The guides of a document of this size that has none of its own yet: all off, centred on it (part of F33). */
export function defaultGuides(width = 1024, height = 768): DocumentGuides {
  const cx = width / 2
  const cy = height / 2
  return {
    gridEnabled: false,
    gridSpacing: 32,
    gridSnap: false,
    gridColor: '#ffffff',
    gridOpacity: 0.15,
    isometricEnabled: false,
    isometricSpacing: 32,
    perspectiveEnabled: false,
    perspectiveType: '1-point',
    vanishingPoints: [{ x: cx, y: cy }],
    horizonY: cy,
    perspectiveLineCount: 12,
    symmetryEnabled: false,
    symmetryType: 'vertical',
    symmetryAxes: 6,
    symmetryRotation: 0,
    symmetryCenterX: cx,
    symmetryCenterY: cy,
    symmetryColor: '#F59E0B',
  }
}

/** The document's part of the guide settings. */
export function documentGuides(state: DocumentGuides): DocumentGuides {
  const d = defaultGuides()
  const out = {} as Record<keyof DocumentGuides, unknown>
  for (const key of Object.keys(d) as (keyof DocumentGuides)[]) out[key] = state[key]
  const guides = out as unknown as DocumentGuides
  return { ...guides, vanishingPoints: guides.vanishingPoints.map(({ x, y }) => ({ x, y })) }
}

const SYMMETRY_TYPES: readonly SymmetryType[] = ['vertical', 'horizontal', 'quadrant', 'radial']
const PERSPECTIVE_TYPES: readonly PerspectiveType[] = ['1-point', '2-point']

/**
 * The guides a project saved, made valid: anything missing, of the wrong
 * kind or out of the range the Drawing Guides dialog allows takes the
 * default for a document of this size.
 */
export function savedGuides(saved: unknown, width: number, height: number): DocumentGuides {
  const d = defaultGuides(width, height)
  if (typeof saved !== 'object' || saved === null) return d
  const s = saved as Record<string, unknown>
  const flag = (key: keyof DocumentGuides) => (typeof s[key] === 'boolean' ? (s[key] as boolean) : (d[key] as boolean))
  const num = (key: keyof DocumentGuides, min = -Infinity, max = Infinity, integer = false) => {
    const v = s[key]
    const ok = typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v))
    return ok ? v : (d[key] as number)
  }
  // Points far off the document are as good as lost: half a million pixels is beyond any canvas.
  const coord = (key: keyof DocumentGuides) => num(key, -500_000, 500_000)
  const color = (key: keyof DocumentGuides) => {
    const v = s[key]
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : (d[key] as string)
  }
  const points = Array.isArray(s.vanishingPoints)
    ? s.vanishingPoints.filter(
        (p): p is VanishingPoint =>
          typeof p === 'object' && p !== null &&
          [(p as VanishingPoint).x, (p as VanishingPoint).y].every((v) => typeof v === 'number' && Math.abs(v) <= 500_000),
      )
    : []
  return {
    gridEnabled: flag('gridEnabled'),
    gridSpacing: num('gridSpacing', 4, 256),
    gridSnap: flag('gridSnap'),
    gridColor: color('gridColor'),
    gridOpacity: num('gridOpacity', 0, 1),
    isometricEnabled: flag('isometricEnabled'),
    isometricSpacing: num('isometricSpacing', 8, 256),
    perspectiveEnabled: flag('perspectiveEnabled'),
    perspectiveType: PERSPECTIVE_TYPES.includes(s.perspectiveType as PerspectiveType)
      ? (s.perspectiveType as PerspectiveType)
      : d.perspectiveType,
    vanishingPoints:
      points.length > 0 && points.length <= 3 ? points.map(({ x, y }) => ({ x, y })) : d.vanishingPoints,
    horizonY: coord('horizonY'),
    perspectiveLineCount: num('perspectiveLineCount', 4, 48, true),
    symmetryEnabled: flag('symmetryEnabled'),
    symmetryType: SYMMETRY_TYPES.includes(s.symmetryType as SymmetryType) ? (s.symmetryType as SymmetryType) : d.symmetryType,
    symmetryAxes: num('symmetryAxes', 2, 24, true),
    symmetryRotation: num('symmetryRotation', 0, 2 * Math.PI),
    symmetryCenterX: coord('symmetryCenterX'),
    symmetryCenterY: coord('symmetryCenterY'),
    symmetryColor: color('symmetryColor'),
  }
}

export const useGuideStore = create<GuideStore>((set) => ({
  ...defaultGuides(),
  quickShapeEnabled: false,

  setGridEnabled: (v) => set({ gridEnabled: v }),
  setGridSpacing: (v) => set({ gridSpacing: v }),
  setGridSnap: (v) => set({ gridSnap: v }),
  setGridColor: (v) => set({ gridColor: v }),
  setGridOpacity: (v) => set({ gridOpacity: v }),
  setIsometricEnabled: (v) => set({ isometricEnabled: v }),
  setIsometricSpacing: (v) => set({ isometricSpacing: v }),
  setPerspectiveEnabled: (v) => set({ perspectiveEnabled: v }),
  setPerspectiveType: (v) => set({ perspectiveType: v }),
  setVanishingPoints: (v) => set({ vanishingPoints: v }),
  setHorizonY: (v) => set({ horizonY: v }),
  setPerspectiveLineCount: (v) => set({ perspectiveLineCount: v }),
  setSymmetryEnabled: (v) => set({ symmetryEnabled: v }),
  setSymmetryType: (v) => set({ symmetryType: v }),
  setSymmetryAxes: (v) => set({ symmetryAxes: v }),
  setSymmetryRotation: (v) => set({ symmetryRotation: v }),
  setSymmetryCenterX: (v) => set({ symmetryCenterX: v }),
  setSymmetryCenterY: (v) => set({ symmetryCenterY: v }),
  setSymmetryColor: (v) => set({ symmetryColor: v }),
  setQuickShapeEnabled: (v) => set({ quickShapeEnabled: v }),
  loadGuides: (guides) => set(documentGuides(guides)),
  resetGuides: (width, height) => set({ ...defaultGuides(width, height), quickShapeEnabled: false }),
}))
