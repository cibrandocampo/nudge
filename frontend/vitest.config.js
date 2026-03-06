import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://localhost/api'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: 'src/test/setup.js',
    css: {
      modules: { classNameStrategy: 'non-scoped' },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**'],
      exclude: ['src/main.jsx', 'src/App.jsx', 'src/i18n/**', 'src/sw.js', 'src/test/**', 'src/**/__tests__/**'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
})
