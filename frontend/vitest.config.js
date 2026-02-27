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
      exclude: ['src/main.jsx', 'src/App.jsx', 'src/i18n/**', 'src/sw.js', 'src/test/**'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
})
