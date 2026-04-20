import { defineConfig } from '@playwright/test'

// Two frontend targets:
//   - chromium-dev:      Vite dev server (:5173) — HMR, fast iteration.
//   - chromium-preview:  Vite preview of the production build (:4173) —
//     used by offline specs because the SW precaches the full hashed bundle.
// The `BASE_URL` env var still overrides per-project config so manual runs
// targeting a remote URL keep working.
const envBase = process.env.BASE_URL

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.js',
  timeout: 30_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Both projects (chromium-dev and chromium-preview) hit the same backend.
  // Running them in parallel lets a mutation in one project race against an
  // assertion in the other — we observed flakes of `delete a lot` when a
  // preview test was mid-sync. Serialise to one worker per project.
  workers: 1,
  fullyParallel: false,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-dev',
      use: {
        browserName: 'chromium',
        baseURL: envBase ?? 'http://localhost:5173',
      },
      testIgnore: /offline-.*\.spec\.js/,
    },
    {
      name: 'chromium-preview',
      use: {
        browserName: 'chromium',
        baseURL: envBase ?? 'http://localhost:4173',
      },
      testMatch: /offline-.*\.spec\.js/,
    },
  ],
})
