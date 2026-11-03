import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const browser = process.env.NEKOLOG_BROWSER ?? 'chromium'

export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser }],
    },
  },
})
