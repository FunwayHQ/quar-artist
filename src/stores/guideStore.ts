import { create } from 'zustand'

export type SymmetryType = 'vertical' | 'horizontal' | 'quadrant' | 'radial'
export type PerspectiveType = '1-point' | '2-point'

export interface VanishingPoint {
  x: number
  y: number
}

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
  resetGuides: () => void
}

const DEFAULTS = {
  gridEnabled: false,
  gridSpacing: 32,
  gridSnap: false,
  gridColor: '#ffffff',
  gridOpacity: 0.15,
  isometricEnabled: false,
  isometricSpacing: 32,
  perspectiveEnabled: false,
  perspectiveType: '1-point' as PerspectiveType,
  vanishingPoints: [{ x: 512, y: 384 }],
  horizonY: 384,
  perspectiveLineCount: 12,
  symmetryEnabled: false,
  symmetryType: 'vertical' as SymmetryType,
  symmetryAxes: 6,
  symmetryRotation: 0,
  symmetryCenterX: 512,
  symmetryCenterY: 384,
  symmetryColor: '#F59E0B',
  quickShapeEnabled: false,
}

export const useGuideStore = create<GuideStore>((set) => ({
  ...DEFAULTS,

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
  resetGuides: () => set(DEFAULTS),
}))
