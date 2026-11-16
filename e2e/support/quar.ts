/**
 * Playwright fixture for the engine harness (e2e/harness). Tests get a `quar`
 * object that opens the harness page and wraps `window.__quar`.
 *
 *   import { test, expect } from '../support/quar.ts'
 *   test('…', async ({ quar }) => {
 *     await quar.open({ width: 32, height: 32 })
 *     …
 *   })
 */
import { test as base, expect as baseExpect, type BrowserContext, type Page } from '@playwright/test'
import type { LayerInfo } from '../../src/types/layer.ts'
import type { ToolType } from '../../src/types/engine.ts'
import type {
  BrushOptions,
  HarnessInfo,
  LayerProps,
  PointerOptions,
  PointInput,
  Rect,
  RendererPreference,
  RGBA,
  SelectionState,
} from '../harness/protocol.ts'
import { Pixels, channelDistance, formatColor } from './pixels.ts'
import { decodePng } from './png.ts'

export { Pixels }

export class Quar {
  readonly page: Page
  private readonly renderer: RendererPreference
  private _info: HarnessInfo | null = null

  constructor(page: Page, renderer: RendererPreference) {
    this.page = page
    this.renderer = renderer
  }

  get info(): HarnessInfo {
    if (!this._info) throw new Error('quar.open() has not been called')
    return this._info
  }

  /** Load the harness page with a fresh document and wait for the engine. */
  async open(size: { width: number; height: number } = { width: 32, height: 32 }): Promise<HarnessInfo> {
    const query = new URLSearchParams({ w: String(size.width), h: String(size.height), renderer: this.renderer })
    await this.page.goto(`/e2e/harness/index.html?${query}`)
    await this.page.waitForFunction(() => window.__quarBoot !== undefined)
    this._info = await this.page.evaluate(() => window.__quarBoot!)
    // Never report WebGL results under the WebGPU project.
    base.skip(
      this.renderer === 'webgpu' && this._info.backend !== 'webgpu',
      'WebGPU was requested, but the browser has no adapter and fell back to WebGL',
    )
    return this._info
  }

  layers(): Promise<LayerInfo[]> {
    return this.page.evaluate(() => window.__quar!.layers())
  }

  activeLayerId(): Promise<string> {
    return this.page.evaluate(() => window.__quar!.activeLayerId())
  }

  /** The bottom layer every document starts with. */
  async baseLayerId(): Promise<string> {
    return (await this.layers())[0].id
  }

  addLayer(name?: string): Promise<string> {
    return this.page.evaluate((n) => window.__quar!.addLayer(n), name)
  }

  selectLayer(id: string): Promise<void> {
    return this.page.evaluate((i) => window.__quar!.selectLayer(i), id)
  }

  setLayerProps(id: string, props: LayerProps): Promise<void> {
    return this.page.evaluate(([i, p]) => window.__quar!.setLayerProps(i, p), [id, props] as const)
  }

  mergeDown(id: string): Promise<void> {
    return this.page.evaluate((i) => window.__quar!.mergeDown(i), id)
  }

  fillRect(layerId: string, color: RGBA, rect?: Rect): Promise<void> {
    return this.page.evaluate(([i, c, r]) => window.__quar!.fillRect(i, c, r), [layerId, color, rect] as const)
  }

  setBrush(options: BrushOptions): Promise<void> {
    return this.page.evaluate((o) => window.__quar!.setBrush(o), options)
  }

  setTool(tool: ToolType): Promise<void> {
    return this.page.evaluate((t) => window.__quar!.setTool(t), tool)
  }

  stroke(points: PointInput[], options?: PointerOptions): Promise<void> {
    return this.page.evaluate(([p, o]) => window.__quar!.stroke(p, o), [points, options] as const)
  }

  tap(x: number, y: number, options?: PointerOptions): Promise<void> {
    return this.page.evaluate(([px, py, o]) => window.__quar!.tap(px, py, o), [x, y, options] as const)
  }

  selectRect(rect: Rect): Promise<void> {
    return this.page.evaluate((r) => window.__quar!.selectRect(r), rect)
  }

  selection(): Promise<SelectionState> {
    return this.page.evaluate(() => window.__quar!.selection())
  }

  undo(): Promise<boolean> {
    return this.page.evaluate(() => window.__quar!.undo())
  }

  redo(): Promise<boolean> {
    return this.page.evaluate(() => window.__quar!.redo())
  }

  async readLayer(layerId: string): Promise<Pixels> {
    return Pixels.decode(await this.page.evaluate((i) => window.__quar!.readLayer(i), layerId))
  }

  async readComposite(): Promise<Pixels> {
    return Pixels.decode(await this.page.evaluate(() => window.__quar!.readComposite()))
  }

  /** Export a PNG through the app's export path and decode the file exactly. */
  async exportPng(): Promise<Pixels> {
    const { base64 } = await this.page.evaluate(() => window.__quar!.exportPng())
    return decodePng(Buffer.from(base64, 'base64'))
  }
}

export interface HarnessWorkerOptions {
  /** Backend to request. Set per project in playwright.config.ts. */
  renderer: RendererPreference
}

interface HarnessWorkerFixtures extends HarnessWorkerOptions {
  /**
   * One browser context per worker, so the HTTP cache stays warm and each
   * test's page load doesn't refetch every engine module. Each test still
   * gets its own page, and so its own engine and GPU context. The harness
   * keeps no state in storage.
   */
  harnessContext: BrowserContext
}

export const test = base.extend<{ quar: Quar }, HarnessWorkerFixtures>({
  renderer: ['webgl', { scope: 'worker', option: true }],
  harnessContext: [
    async ({ browser }, use, workerInfo) => {
      const { baseURL, viewport, deviceScaleFactor } = workerInfo.project.use
      const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor })
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  quar: async ({ harnessContext, renderer }, use) => {
    const page = await harnessContext.newPage()
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.stack ?? err.message))
    await use(new Quar(page, renderer))
    await page.close()
    // Exceptions thrown inside event handlers don't reach page.evaluate.
    baseExpect(errors, 'uncaught errors in the harness page').toEqual([])
  },
})

export const expect = baseExpect.extend({
  /** Compare colours channel by channel: `expect(pixels.at(x, y)).toMatchColor([r, g, b, a], 3)` */
  toMatchColor(received: RGBA, expected: RGBA, tolerance = 2) {
    const distance = channelDistance(received, expected)
    const pass = distance <= tolerance
    return {
      pass,
      name: 'toMatchColor',
      expected,
      actual: received,
      message: () =>
        `expected ${formatColor(received)} ${pass ? 'not ' : ''}to be within ±${tolerance} of ` +
        `${formatColor(expected)} (largest channel difference: ${distance})`,
    }
  },

  /** Compare two images: `expect(after).toMatchPixels(before, 1)` */
  toMatchPixels(received: Pixels, expected: Pixels, tolerance = 0) {
    const mismatches = received.diff(expected, tolerance)
    const pass = mismatches.length === 0
    const first = mismatches[0]
    return {
      pass,
      name: 'toMatchPixels',
      message: () =>
        pass
          ? `expected images to differ by more than ±${tolerance}`
          : `${mismatches.length} of ${received.width * received.height} pixels differ by more than ±${tolerance}; ` +
            `first at (${first.x}, ${first.y}): ${formatColor(first.actual)} vs ${formatColor(first.expected)}`,
    }
  },
})
