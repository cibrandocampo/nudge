import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

// https://astro.build/config
export default defineConfig({
  site: 'https://cibrandocampo.github.io',
  base: '/nudge',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [tailwind()],
})
