import { defineConfig, devices } from '@playwright/test'
import type { HarnessWorkerOptions } from './e2e/support/quar.ts'

/**
 * Projects:
 * - chromium, firefox, webkit: every spec. The engine harness (e2e/gpu) runs
 *   on WebGL 2 here. Chromium uses the full browser in new headless mode
 *   (`channel: 'chromium'`), which renders on the real GPU; Playwright's
 *   default headless shell only offers SwiftShader.
 * - chromium-webgpu: the harness specs on WebGPU. Opt in with QUAR_WEBGPU=1
 *   (`npm run e2e:webgpu`); the specs skip themselves if the machine has no
 *   WebGPU adapter.
 */
const webgpuProjects = process.env.QUAR_WEBGPU
  ? [
      {
        name: 'chromium-webgpu',
        testMatch: 'gpu/**/*.spec.ts',
        use: {
          ...devices['Desktop Chrome'],
          channel: 'chromium',
          renderer: 'webgpu' as const,
          launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU'] },
        },
      },
    ]
  : []

export default defineConfig<HarnessWorkerOptions>({
  testDir: './e2e',
  // A cold browser's first WebGPU adapter request can take 15 s or more while
  // several browsers start at once, so app start-up alone can approach 30 s.
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    ...webgpuProjects,
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
})
