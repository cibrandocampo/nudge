import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
    // Allow external tunnels (ngrok, Tailscale, etc.) for mobile testing
    allowedHosts: 'all',
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
        name: 'Nudge',
        short_name: 'Nudge',
        description: 'A gentle reminder for recurring things.',
        theme_color: '#1a1a2e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
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
