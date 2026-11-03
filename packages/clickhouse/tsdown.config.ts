import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/log-store.ts', 'src/usage-store.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
})
