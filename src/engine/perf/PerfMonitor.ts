/**
 * Performance monitoring singleton.
 * Uses circular buffers to track rolling averages for key metrics.
 * Enabled in dev mode, exposed as window.__QUAR_PERF for console inspection.
 */

const BUFFER_SIZE = 60

interface MetricBuffer {
  samples: Float64Array
  index: number
  count: number
}

export interface MetricStats {
  avg: number
  min: number
  max: number
  last: number
}

class PerfMonitorImpl {
  enabled = false
  private metrics = new Map<string, MetricBuffer>()
  private marks = new Map<string, number>()

  /** Record a start mark for a timed section. */
  mark(label: string): void {
    if (!this.enabled) return
    this.marks.set(label, performance.now())
  }

  /** Measure elapsed time from a mark, record the sample. */
  measure(label: string, startMark: string): void {
    if (!this.enabled) return
    const start = this.marks.get(startMark)
    if (start === undefined) return
    const elapsed = performance.now() - start
    this.recordSample(label, elapsed)
    this.marks.delete(startMark)
  }

  /** Record a raw numeric sample for a metric. */
  recordSample(label: string, value: number): void {
    if (!this.enabled) return
    let buf = this.metrics.get(label)
    if (!buf) {
      buf = { samples: new Float64Array(BUFFER_SIZE), index: 0, count: 0 }
      this.metrics.set(label, buf)
    }
    buf.samples[buf.index] = value
    buf.index = (buf.index + 1) % BUFFER_SIZE
    if (buf.count < BUFFER_SIZE) buf.count++
  }

  /** Get stats for a metric. Returns null if no samples. */
  getStats(label: string): MetricStats | null {
    const buf = this.metrics.get(label)
    if (!buf || buf.count === 0) return null

    let min = Infinity
    let max = -Infinity
    let sum = 0

    for (let i = 0; i < buf.count; i++) {
      const v = buf.samples[i]
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }

    const lastIdx = (buf.index - 1 + BUFFER_SIZE) % BUFFER_SIZE
    return {
      avg: sum / buf.count,
      min,
      max,
      last: buf.samples[lastIdx],
    }
  }

  /** Get all metrics as a summary object. */
  getMetrics(): Record<string, MetricStats> {
    const result: Record<string, MetricStats> = {}
    for (const [label] of this.metrics) {
      const stats = this.getStats(label)
      if (stats) result[label] = stats
    }
    return result
  }

  /** Clear all recorded data. */
  clear(): void {
    this.metrics.clear()
    this.marks.clear()
  }
}

/** Singleton instance. */
export const PerfMonitor = new PerfMonitorImpl()

// Expose in dev mode for console inspection
if (import.meta.env?.DEV) {
  PerfMonitor.enabled = true
  ;(globalThis as Record<string, unknown>).__QUAR_PERF = PerfMonitor
}
