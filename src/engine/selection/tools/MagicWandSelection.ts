import type { SelectionMode, MagicWandOptions } from '../../../types/selection.ts'
import type { SelectionManager } from '../SelectionManager.ts'

/**
 * Magic wand selection tool.
 * Click to select pixels of similar color.
 * Supports contiguous (flood fill) and non-contiguous (global) modes.
 */
export class MagicWandSelection {
  private options: MagicWandOptions = {
    tolerance: 10,
    contiguous: true,
  }

  /** Update tool options. */
  setOptions(opts: Partial<MagicWandOptions>) {
    if (opts.tolerance !== undefined) {
      this.options.tolerance = Math.max(0, Math.min(255, opts.tolerance))
    }
    if (opts.contiguous !== undefined) {
      this.options.contiguous = opts.contiguous
    }
  }

  /** Get current options. */
  getOptions(): Readonly<MagicWandOptions> {
    return { ...this.options }
  }

  /**
   * Execute magic wand selection at a point.
   * Unlike other tools, this is a single-click action (no drag).
   *
   * @param x Click x coordinate
   * @param y Click y coordinate
   * @param pixels RGBA pixel data of the target layer
   * @param manager The selection manager to apply to
   * @param mode Selection mode (replace/add/subtract/intersect)
   */
  select(
    x: number,
    y: number,
    pixels: Uint8Array | Uint8ClampedArray,
    manager: SelectionManager,
    mode: SelectionMode,
  ) {
    manager.magicWand(
      x,
      y,
      pixels,
      this.options.tolerance,
      this.options.contiguous,
      mode,
    )
  }
}
