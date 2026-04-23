import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  workers: 1,
  fullyParallel: false,
  use: {
    headless: true,
    baseURL: process.env.BASE_URL ?? 'http://host.docker.internal:5173',
  },
  projects: [
    {
      name: 'chromium-dev',
      use: { browserName: 'chromium' },
    },
  ],
})
