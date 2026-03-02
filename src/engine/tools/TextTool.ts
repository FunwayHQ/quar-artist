import type { TextProperties } from '../../types/text.ts'
import { WEB_SAFE_FONTS } from '../../types/text.ts'
import { isGoogleFontsConsented, GOOGLE_FONTS_POPULAR, loadGoogleFont } from '../../utils/googleFonts.ts'

export interface RasterizedText {
  pixels: Uint8ClampedArray
  width: number
  height: number
  /** Offset from the click point to place the rasterized text */
  offsetX: number
  offsetY: number
}

/**
 * Rasterizes text to pixel data via an offscreen Canvas 2D context.
 * The result can be imported as a new layer via CanvasManager.importImageToNewLayer().
 */
export class TextTool {
  /**
   * Rasterize a multi-line text string onto a document-sized canvas at the given position.
   */
  rasterize(
    text: string,
    props: TextProperties,
    canvasX: number,
    canvasY: number,
    docWidth: number,
    docHeight: number,
  ): RasterizedText | null {
    if (!text.trim()) return null

    const canvas = document.createElement('canvas')
    canvas.width = docWidth
    canvas.height = docHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Build CSS font string
    const fontString = this.buildFontString(props)
    ctx.font = fontString
    ctx.fillStyle = props.color
    ctx.textAlign = props.textAlign
    ctx.textBaseline = 'top'

    // Split into lines and render
    const lines = text.split('\n')
    const lineHeight = props.fontSize * 1.3
    let x = canvasX
    if (props.textAlign === 'center') {
      x = canvasX
    } else if (props.textAlign === 'right') {
      x = canvasX
    }

    for (let i = 0; i < lines.length; i++) {
      const y = canvasY + i * lineHeight
      ctx.fillText(lines[i], x, y)
    }

    const imageData = ctx.getImageData(0, 0, docWidth, docHeight)
    return {
      pixels: imageData.data,
      width: docWidth,
      height: docHeight,
      offsetX: 0,
      offsetY: 0,
    }
  }

  /** Build a CSS font string from TextProperties. */
  buildFontString(props: TextProperties): string {
    const style = props.fontStyle === 'italic' ? 'italic' : 'normal'
    const weight = props.fontWeight === 'bold' ? 'bold' : 'normal'
    return `${style} ${weight} ${props.fontSize}px "${props.fontFamily}"`
  }

  /**
   * Get available fonts. If Google Fonts consent is given, includes
   * Google Fonts. Otherwise uses the web-safe font list.
   */
  async getAvailableFonts(): Promise<string[]> {
    const base = [...WEB_SAFE_FONTS] as string[]
    if (isGoogleFontsConsented()) {
      const googleFonts = [...GOOGLE_FONTS_POPULAR] as string[]
      const merged = new Set([...base, ...googleFonts])
      return Array.from(merged).sort((a, b) => a.localeCompare(b))
    }
    return base
  }

  /**
   * Ensure a Google Font is loaded before rasterizing.
   * Call this before rasterize() when using a Google Font.
   */
  async ensureFontLoaded(family: string): Promise<void> {
    if (isGoogleFontsConsented() && GOOGLE_FONTS_POPULAR.includes(family as any)) {
      await loadGoogleFont(family)
    }
  }
}
