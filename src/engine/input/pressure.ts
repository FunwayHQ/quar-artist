import type { PointerState } from '../../types/engine.ts'

/**
 * The pressure to paint with.
 *
 * Pens report real pressure, 0 included. A pen lifting off reports 0, and
 * reading that as 0.5 put a blob at the end of every pen stroke (F49).
 * Mice, and touch screens without pressure sensing, report 0.5 (or 0 on some
 * platforms) while pressed; they paint at 0.5.
 */
export function strokePressure(state: Pick<PointerState, 'pressure' | 'pointerType'>): number {
  return state.pointerType === 'pen' ? state.pressure : state.pressure || 0.5
}
