import { generateKeyPairSync } from 'node:crypto'
import {
  ACCESS_COOKIE,
  createSession,
  loadSigningKey,
  REFRESH_COOKIE,
  rotateRefresh,
  sessionKey,
  sessionLives,
  signAccessToken,
} from '@internal/auth'
import { nodeRedis, type RedisClient } from '@nekolog-io/adapters'
import Redis from 'ioredis'
import { afterAll, describe, expect, it } from 'vitest'

const URL_ = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379'
const ORIGIN = 'https://dashboard.test'

async function answers(): Promise<boolean> {
  const probe = new Redis(URL_, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  try {
    await probe.connect()
    await probe.ping()
    return true
  } catch {
    return false
  } finally {
    probe.disconnect()
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.REDIS_TEST_REQUIRED === '1') {
    throw new Error(
      `REDIS_TEST_REQUIRED is set but nothing answered at ${URL_}. These tests must not be skipped here.`,
    )
  }
  process.stderr.write(
    `\nSkipping the proxy integration tests: nothing answered at ${URL_}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const pair = generateKeyPairSync('ed25519')
process.env.APP_URL = ORIGIN
process.env.REDIS_URL = URL_
process.env.AUTH_JWT_PRIVATE_KEY = pair.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
process.env.AUTH_JWT_PUBLIC_KEY = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const { NextRequest } = await import('next/server')
const { proxy } = await import('../proxy.ts')

const raw = new Redis(URL_, { lazyConnect: true })
const store = { redis: nodeRedis(raw) as RedisClient }
const SOMEWHERE = { device: 'Firefox on Linux x86_64', country: 'BR' }

afterAll(() => {
  raw.disconnect()
})

let seed = 0
function user(): string {
  seed += 1
  return `usr_proxy_${process.pid}_${seed}`
}

function request(
  options: { method?: string; path?: string; origin?: string | null; cookie?: string } = {},
): InstanceType<typeof NextRequest> {
  const headers = new Headers()
  if (options.origin !== null) {
    headers.set('origin', options.origin ?? ORIGIN)
  }
  if (options.cookie !== undefined) {
    headers.set('cookie', options.cookie)
  }
  return new NextRequest(`${ORIGIN}${options.path ?? '/'}`, {
    method: options.method ?? 'GET',
    headers,
  })
}

function setCookies(response: Response): Map<string, string> {
  const written = new Map<string, string>()
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const at = (pair as string).indexOf('=')
    written.set((pair as string).slice(0, at), line)
  }
  return written
}

function forwardedCookie(response: Response): string | null {
  return response.headers.get('x-middleware-request-cookie')
}

describe.skipIf(!reachable)('the Origin every unsafe request has to carry', () => {
  it('refuses a POST that carries none at all', async () => {
    const refused = await proxy(request({ method: 'POST', origin: null }))

    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'bad_origin' })
  })

  it('refuses a POST from another site, and a DELETE from one too', async () => {
    for (const method of ['POST', 'DELETE']) {
      const refused = await proxy(request({ method, origin: 'https://evil.test' }))
      expect(refused.status, method).toBe(403)
    }
  })

  it('lets a POST from this site through', async () => {
    expect((await proxy(request({ method: 'POST' }))).status).not.toBe(403)
  })

  it('lets a GET from anywhere through, because reading is not writing', async () => {
    expect((await proxy(request({ origin: null }))).status).not.toBe(403)
  })

  it('leaves /health alone, which is what the container is watched by', async () => {
    expect(
      (await proxy(request({ method: 'POST', path: '/health', origin: null }))).status,
    ).not.toBe(403)
  })

  it('still sends the security headers on a refusal', async () => {
    const refused = await proxy(request({ method: 'POST', origin: null }))

    expect(refused.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(refused.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe.skipIf(!reachable)('renewing the access token without the person noticing', () => {
  it('leaves a request with a valid access token exactly as it found it', async () => {
    const signing = await loadSigningKey(process.env.AUTH_JWT_PRIVATE_KEY as string)
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    const token = await signAccessToken(signing, { sub: 'whoever', sid: session.sid })

    const carried = `${ACCESS_COOKIE}=${token}; ${REFRESH_COOKIE}=${session.refreshToken}`
    const response = await proxy(request({ cookie: carried }))

    expect(setCookies(response).size).toBe(0)
    expect(forwardedCookie(response)).toBe(carried)
  })

  it('renews an expired one and hands the fresh token to the request behind it', async () => {
    const signing = await loadSigningKey(process.env.AUTH_JWT_PRIVATE_KEY as string)
    const userId = user()
    const session = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    const stale = await signAccessToken(signing, { sub: userId, sid: session.sid }, -10)

    const response = await proxy(
      request({
        cookie: `theme=dark; ${ACCESS_COOKIE}=${stale}; ${REFRESH_COOKIE}=${session.refreshToken}`,
      }),
    )

    const written = setCookies(response)
    const fresh = written.get(ACCESS_COOKIE) ?? ''
    const rotated = written.get(REFRESH_COOKIE) ?? ''

    expect(fresh, 'no new access token was written').not.toBe('')
    expect(fresh).not.toContain(stale)
    expect(rotated).not.toContain(session.refreshToken)
    for (const line of [fresh, rotated]) {
      expect(line).toContain('HttpOnly')
      expect(line).toContain('Secure')
      expect(line).toContain('Path=/')
      expect(line).not.toContain('Domain=')
    }

    const carried = forwardedCookie(response) ?? ''
    expect(
      carried,
      'the server components of this request would still see the old token',
    ).toContain(`${ACCESS_COOKIE}=`)
    expect(carried).not.toContain(stale)
    expect(carried, 'it dropped a cookie that was not ours').toContain('theme=dark')
  })

  it('renews with no Max-Age when the device was not remembered', async () => {
    const session = await createSession(store, { userId: user(), remember: false, ...SOMEWHERE })

    const response = await proxy(request({ cookie: `${REFRESH_COOKIE}=${session.refreshToken}` }))

    expect(setCookies(response).get(ACCESS_COOKIE)).not.toContain('Max-Age')
  })

  it('leaves a request with no refresh cookie exactly as it found it', async () => {
    const response = await proxy(request({ cookie: 'theme=dark' }))

    expect(setCookies(response).size).toBe(0)
    expect(forwardedCookie(response)).toBe('theme=dark')
  })
})

describe.skipIf(!reachable)('what the proxy does with a session that is over', () => {
  it('clears both cookies when the refresh token belongs to nobody', async () => {
    const response = await proxy(request({ cookie: `${REFRESH_COOKIE}=nosuchsid.invented` }))
    const written = setCookies(response)

    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(written.get(name), name).toContain('Max-Age=0')
      expect(written.get(name), name).toContain('Secure')
    }
    expect(forwardedCookie(response) ?? '').not.toContain(REFRESH_COOKIE)
  })

  it('clears them when a used token comes back after the grace window, and ends the session', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    await rotateRefresh(store, session.refreshToken)
    await raw.hset(sessionKey(session.sid), 'prevUntil', '0')

    const response = await proxy(request({ cookie: `${REFRESH_COOKIE}=${session.refreshToken}` }))

    expect(setCookies(response).get(ACCESS_COOKIE)).toContain('Max-Age=0')
    expect(setCookies(response).get(REFRESH_COOKIE)).toContain('Max-Age=0')
    expect(await sessionLives(store, session.sid)).toBe(false)
  })
})
