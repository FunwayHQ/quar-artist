/**
 * Canvas size limits by device class (PRD §8: iOS Safari's 256 MB canvas
 * budget). Phones and tablets get 4096 px a side, desktops 8192 px.
 */
export const DESKTOP_MAX_CANVAS_SIDE = 8192
export const MOBILE_MAX_CANVAS_SIDE = 4096

type NavigatorLike = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>

/** Whether this is a phone or tablet. iPadOS Safari presents itself as a Mac, but Macs have no touch screen. */
export function isMobileDevice(nav: NavigatorLike | undefined = globalThis.navigator): boolean {
  if (!nav) return false
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)) return true
  return /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1
}

/** The largest width or height a document may have on this device. */
export function maxCanvasSide(nav?: NavigatorLike): number {
  return isMobileDevice(nav) ? MOBILE_MAX_CANVAS_SIDE : DESKTOP_MAX_CANVAS_SIDE
}

/** Why a document size can't be used on this device, or null if it can. */
export function canvasSizeProblem(width: number, height: number, maxSide = maxCanvasSide()): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return 'Width and height must be whole numbers of at least 1 px'
  }
  if (width > maxSide || height > maxSide) {
    return `This device supports canvases up to ${maxSide} × ${maxSide} px`
  }
  return null
}
