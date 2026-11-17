export type SymmetryType = 'vertical' | 'horizontal' | 'quadrant' | 'radial'
export type PerspectiveType = '1-point' | '2-point'

export interface VanishingPoint {
  x: number
  y: number
}

/**
 * The drawing guides and symmetry a document keeps, saved with its project
 * and shown again when it opens (plan M1.4). QuickShape isn't one of them:
 * it is the user's, whatever the document.
 */
export interface DocumentGuides {
  gridEnabled: boolean
  gridSpacing: number
  gridSnap: boolean
  gridColor: string
  gridOpacity: number

  isometricEnabled: boolean
  isometricSpacing: number

  perspectiveEnabled: boolean
  perspectiveType: PerspectiveType
  vanishingPoints: VanishingPoint[]
  horizonY: number
  perspectiveLineCount: number

  symmetryEnabled: boolean
  symmetryType: SymmetryType
  symmetryAxes: number
  /** In radians. */
  symmetryRotation: number
  symmetryCenterX: number
  symmetryCenterY: number
  symmetryColor: string
}
