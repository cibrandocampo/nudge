import { defineConfig } from '@playwright/test'

// Two frontend targets:
//   - chromium-dev:      Vite dev server on host port 15173 — HMR, fast iteration.
//   - chromium-preview:  Vite preview of the production build on host port 14173 —
//     used by offline specs because the SW precaches the full hashed bundle.
// Dev compose maps these via "1<port>" prefix to avoid clashing with other
// local projects on the standard 5173/4173/8000 ports.
// The `BASE_URL` env var still overrides per-project config so manual runs
// targeting a remote URL keep working.
const envBase = process.env.BASE_URL

// Historical note: pre-Chromium-145, an e2e container reaching the
// frontend via `http://host.docker.internal:port` could opt into a
// secure context with `--unsafely-treat-insecure-origin-as-secure`.
// That flag stopped working for SW registration around Chromium 145
// even when listed verbatim. The reliable replacement is to launch
// the container with `--network=host` so the app is reached at
// `http://localhost:port`, which Chromium auto-treats as secure.
// Kept the flag for any leftover non-localhost runs but the supported
// invocation now is BASE_URL=http://localhost:<port> + --network=host.
const insecureOriginFlags = envBase && envBase.includes('host.docker.internal')
  ? [`--unsafely-treat-insecure-origin-as-secure=${envBase}`]
  : []

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
        baseURL: envBase ?? 'http://localhost:15173',
        launchOptions: { args: insecureOriginFlags },
      },
      testIgnore: /offline-.*\.spec\.js/,
    },
    {
      name: 'chromium-preview',
      use: {
        browserName: 'chromium',
        baseURL: envBase ?? 'http://localhost:14173',
        launchOptions: { args: insecureOriginFlags },
      },
      testMatch: /offline-.*\.spec\.js/,
    },
  ],
})
