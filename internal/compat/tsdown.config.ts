import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/smoke.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'es2022',
  deps: { alwaysBundle: [/@nekolog-io\//] },
})
