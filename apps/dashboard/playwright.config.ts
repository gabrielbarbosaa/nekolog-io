import { generateKeyPairSync } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3186)

export const BASE_URL = `http://localhost:${PORT}`
export const DATABASE_URL =
  process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
export const REDIS_URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379'
export const MAILPIT_URL = process.env.MAILPIT_TEST_URL ?? 'http://localhost:8025'
export const SMTP_URL = process.env.SMTP_TEST_URL ?? 'smtp://localhost:1025'
export const OTP_SECRET = 'the otp secret the end to end run signs codes with'

const pair = generateKeyPairSync('ed25519')

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env.CI === 'true',
  reporter: [['list']],
  use: { baseURL: BASE_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      APP_ENV: 'dev',
      APP_URL: BASE_URL,
      DATABASE_URL,
      REDIS_URL,
      SMTP_URL,
      EMAIL_FROM: 'no-reply@nekolog.test',
      EMAIL_ALLOWLIST: '@acme.test',
      AUTH_OTP_SECRET: OTP_SECRET,
      AUTH_JWT_PRIVATE_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      AUTH_JWT_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  },
})
