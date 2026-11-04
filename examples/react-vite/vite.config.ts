import nekolog from '@nekolog-io/bundler-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), nekolog()],
  build: { outDir: 'dist', sourcemap: true },
})
