import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

// https://astro.build/config
export default defineConfig({
  site: 'https://nudge.cibran.es',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [tailwind()],
})
