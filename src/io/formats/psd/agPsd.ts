/**
 * ag-psd, set up to work without a canvas (plan M1.7). It makes image data
 * with a 2D canvas unless told otherwise, which workers don't have, and the
 * app gives and takes pixels as arrays anyway. Only thumbnails and canvas
 * output, which the app never asks for, would need one.
 */
import { decodeLayerPixels, initializeCanvas, readPsd, writePsdUint8Array } from 'ag-psd'

initializeCanvas(
  () => {
    throw new Error('PSD files are read and written without a canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
)

export { decodeLayerPixels, readPsd, writePsdUint8Array }
export type { Layer, LayerEffectSolidFill, LayerMaskData, PixelData, Psd } from 'ag-psd'
