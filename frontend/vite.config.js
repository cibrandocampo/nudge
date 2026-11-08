import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// The production nginx's security headers (CSP and friends), read from the
// include nginx itself loads, so `vite preview` serves the build under the
// exact same policy and the E2E suite catches a CSP regression before it
// reaches production. Not applied to the dev server: its HMR client needs
// inline scripts the policy forbids.
const nginxHeaders = readFileSync(new URL('./nginx-security-headers.conf', import.meta.url), 'utf8')
const securityHeaders = Object.fromEntries(
  [...nginxHeaders.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm)].map(([, name, value]) => [name, value]),
)
if (!securityHeaders['Content-Security-Policy']) {
  throw new Error('nginx-security-headers.conf: no Content-Security-Policy found to mirror on vite preview')
}

export default defineConfig({
  server: {
    // In the dev Docker container the backend is reachable as "backend".
    // changeOrigin must stay false (default) so the original Host header
    // (e.g. "localhost:5173") reaches Django; changing it to "backend:8000"
    // would fail Django's ALLOWED_HOSTS check.
    proxy: {
      '/api':           { target: 'http://backend:8000' },
      '/admin':         { target: 'http://backend:8000' },
      '/django-static': { target: 'http://backend:8000' },
    },
    allowedHosts: true,
  },
  preview: {
    // Used by the `frontend-preview` service in dev/docker-compose.yml to
    // serve a production build for offline E2E tests (T069–T071). Mirrors
    // the dev-server proxy so /api/* hits the backend Django container.
    proxy: {
      '/api':           { target: 'http://backend:8000' },
      '/admin':         { target: 'http://backend:8000' },
      '/django-static': { target: 'http://backend:8000' },
    },
    headers: securityHeaders,
    allowedHosts: true,
    host: true,
    port: 4173,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      // injectManifest lets us write a custom SW with push handlers
      // while still getting Workbox's precaching injected automatically.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      manifest: {
        id: '/',
        name: 'Nudge',
        short_name: 'Nudge',
        description: 'A gentle reminder for recurring things.',
        theme_color: '#1a1a2e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'lifestyle'],
        icons: [
          { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
})
