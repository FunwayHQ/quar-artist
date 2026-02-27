export type FilterType = 'gaussianBlur' | 'sharpen' | 'hsbAdjustment' | 'curves'

export interface CurvePoint {
  x: number // 0–255
  y: number // 0–255
}

export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue'

export interface GaussianBlurParams {
  type: 'gaussianBlur'
  radius: number // 1–100
}

export interface SharpenParams {
  type: 'sharpen'
  amount: number // 0–500 (percent)
  radius: number // 0.1–100
  threshold: number // 0–255
}

export interface HSBAdjustmentParams {
  type: 'hsbAdjustment'
  hueShift: number // -180 to +180
  saturation: number // -100 to +100
  brightness: number // -100 to +100
}

export interface CurvesParams {
  type: 'curves'
  channels: Record<CurveChannel, CurvePoint[]>
}

export type FilterParams =
  | GaussianBlurParams
  | SharpenParams
  | HSBAdjustmentParams
  | CurvesParams

export function defaultGaussianBlurParams(): GaussianBlurParams {
  return { type: 'gaussianBlur', radius: 5 }
}

export function defaultSharpenParams(): SharpenParams {
  return { type: 'sharpen', amount: 100, radius: 1, threshold: 0 }
}

export function defaultHSBAdjustmentParams(): HSBAdjustmentParams {
  return { type: 'hsbAdjustment', hueShift: 0, saturation: 0, brightness: 0 }
}

export function defaultCurvesParams(): CurvesParams {
  const identity: CurvePoint[] = [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]
  return {
    type: 'curves',
    channels: {
      rgb: [...identity],
      red: [...identity],
      green: [...identity],
      blue: [...identity],
    },
  }
}

export function defaultParamsForFilter(filterType: FilterType): FilterParams {
  switch (filterType) {
    case 'gaussianBlur':
      return defaultGaussianBlurParams()
    case 'sharpen':
      return defaultSharpenParams()
    case 'hsbAdjustment':
      return defaultHSBAdjustmentParams()
    case 'curves':
      return defaultCurvesParams()
  }
}
