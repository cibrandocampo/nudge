import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'

// https://astro.build/config
export default defineConfig({
  site: 'https://nudge.cibran.es',
  output: 'static',
  trailingSlash: 'ignore',
  // Tailwind 4 is a Vite plugin (the `@astrojs/tailwind` integration is
  // deprecated). Theme tokens live in `src/styles/global.css` via `@theme`.
  vite: {
    plugins: [tailwindcss()],
  },
})
