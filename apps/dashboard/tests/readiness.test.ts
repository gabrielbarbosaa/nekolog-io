import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HEALTH = readFileSync(
  fileURLToPath(new URL('../app/health/route.ts', import.meta.url)),
  'utf8',
)
const LOGIN = readFileSync(
  fileURLToPath(new URL('../app/(auth)/login/page.tsx', import.meta.url)),
  'utf8',
)

const pair = await import('node:crypto').then(({ generateKeyPairSync }) =>
  generateKeyPairSync('ed25519'),
)

const REAL = {
  private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  public: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}

describe('a dashboard whose signing key does not load', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('says so instead of answering a blank error', async () => {
    process.env.AUTH_JWT_PRIVATE_KEY = 'dev-only-fake-ed25519-private-key'
    process.env.AUTH_JWT_PUBLIC_KEY = 'dev-only-fake-ed25519-public-key'

    const { readiness, AUTH_KEYS } = await import('../lib/readiness')
    const state = await readiness()

    expect(state.ready).toBe(false)
    if (state.ready) {
      return
    }
    expect(state.problem).toBe(AUTH_KEYS)
    expect(state.detail).toContain('AUTH_JWT_PRIVATE_KEY')
    expect(state.detail, 'the fix is the point of the message').toContain('pnpm dev:env')
    expect(
      state.detail,
      'a running server keeps the environment it started with, which is the trap',
    ).toContain('restart')
  })

  it('says nothing is wrong when the pair is real', async () => {
    process.env.AUTH_JWT_PRIVATE_KEY = REAL.private
    process.env.AUTH_JWT_PUBLIC_KEY = REAL.public

    const { readiness } = await import('../lib/readiness')

    expect((await readiness()).ready).toBe(true)
  })

  it('refuses the variable being missing altogether', async () => {
    process.env.AUTH_JWT_PRIVATE_KEY = ''
    process.env.AUTH_JWT_PUBLIC_KEY = ''

    const { readiness } = await import('../lib/readiness')

    expect((await readiness()).ready).toBe(false)
  })
})

describe('what asks before answering', () => {
  it('health answers 503, so a deploy and the doctor both notice', () => {
    expect(HEALTH).toContain('await readiness()')
    expect(HEALTH).toMatch(/status: 'degraded'[\s\S]{0,200}status: 503/)
    expect(HEALTH).toContain("status: 'ok'")
  })

  it('the sign-in screen checks before it draws a form nobody could use', () => {
    expect(LOGIN).toContain('await readiness()')
    expect(
      LOGIN.indexOf('readiness()'),
      'it has to run before the session lookup, which is what throws',
    ).toBeLessThan(LOGIN.indexOf('currentSession()'))
  })
})
