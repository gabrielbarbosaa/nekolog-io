import {
  cachedBlockedEnvironments,
  generateApiKey,
  hashApiKey,
  type KeyRecord,
  type KeyStore,
  memoryKeyStore,
  memoryQuotaStore,
} from '@internal/adapters'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createKeyAuthenticator, QUOTA_RETRY_AFTER_SECONDS } from './authenticate.ts'
import { keyFromRequest } from './keys.ts'

const PUBLIC_KEY = generateApiKey('public')
const SECRET_KEY = generateApiKey('secret')

const WRITABLE: KeyRecord = {
  projectId: 'p_1',
  environmentId: 'e_1',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
}

let store: KeyStore

async function setup(records: Record<string, KeyRecord>) {
  const entries = await Promise.all(
    Object.entries(records).map(async ([key, record]) => [await hashApiKey(key), record] as const),
  )
  store = memoryKeyStore(Object.fromEntries(entries))
  return createKeyAuthenticator({ keyStore: store })
}

function request(init: { headers?: Record<string, string>; url?: string } = {}): Request {
  return new Request(init.url ?? 'https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers: init.headers,
  })
}

function withBearer(key: string, extra: Record<string, string> = {}): Request {
  return request({ headers: { authorization: `Bearer ${key}`, ...extra } })
}

describe('finding the key on the request', () => {
  it('reads a Bearer header', () => {
    const found = keyFromRequest(withBearer(SECRET_KEY))

    expect(found).toEqual({
      ok: true,
      found: { key: { kind: 'secret', value: SECRET_KEY }, location: 'header' },
    })
  })

  it('does not care how the Bearer scheme is capitalised', () => {
    const found = keyFromRequest(request({ headers: { authorization: `bearer ${SECRET_KEY}` } }))

    expect(found.ok).toBe(true)
  })

  it('reads a public key from the query, which is all sendBeacon can do', () => {
    const found = keyFromRequest(
      request({ url: `https://ingest.nekolog.io/v1/logs?key=${PUBLIC_KEY}` }),
    )

    expect(found).toMatchObject({ ok: true, found: { location: 'query' } })
  })

  it('refuses a secret key in the query with its own code', () => {
    const found = keyFromRequest(
      request({ url: `https://ingest.nekolog.io/v1/logs?key=${SECRET_KEY}` }),
    )

    expect(found).toMatchObject({ ok: false, code: 'secret_key_in_url' })
  })

  it('prefers the header when both carry a key', () => {
    const found = keyFromRequest(
      new Request(`https://ingest.nekolog.io/v1/logs?key=${PUBLIC_KEY}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET_KEY}` },
      }),
    )

    expect(found).toMatchObject({ ok: true, found: { location: 'header' } })
  })

  it.each([
    ['nothing at all', {}],
    ['an empty header', { authorization: '' }],
    ['another scheme', { authorization: `Basic ${PUBLIC_KEY}` }],
    ['a token that is not a key', { authorization: 'Bearer hello' }],
    ['the word Bearer alone', { authorization: 'Bearer' }],
  ])('refuses %s', (_name, headers) => {
    expect(keyFromRequest(request({ headers }))).toMatchObject({
      ok: false,
      code: 'invalid_key',
    })
  })

  it('still refuses a secret key in the query when the header carries a good one', () => {
    const found = keyFromRequest(
      new Request(`https://ingest.nekolog.io/v1/logs?key=${SECRET_KEY}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${PUBLIC_KEY}` },
      }),
    )

    expect(found).toMatchObject({ ok: false, code: 'secret_key_in_url' })
  })

  it('does not fall back to the query when the header holds a broken key', () => {
    const found = keyFromRequest(
      new Request(`https://ingest.nekolog.io/v1/logs?key=${PUBLIC_KEY}`, {
        method: 'POST',
        headers: { authorization: 'Bearer broken' },
      }),
    )

    expect(found).toMatchObject({ ok: true, found: { location: 'query' } })
  })
})

describe('the authenticator', () => {
  it('accepts a known key and reports project and environment', async () => {
    const authenticate = await setup({ [SECRET_KEY]: WRITABLE })

    const outcome = await authenticate(withBearer(SECRET_KEY))

    expect(outcome).toEqual({
      ok: true,
      principal: {
        projectId: 'p_1',
        environmentId: 'e_1',
        keyKind: 'secret',
        keyLocation: 'header',
        allowedOrigin: null,
      },
    })
  })

  it('refuses a key the store does not know', async () => {
    const authenticate = await setup({})

    expect(await authenticate(withBearer(SECRET_KEY))).toMatchObject({
      ok: false,
      code: 'invalid_key',
    })
  })

  it('refuses a key that may read but not write', async () => {
    const authenticate = await setup({ [SECRET_KEY]: { ...WRITABLE, scopes: ['logs:read'] } })

    expect(await authenticate(withBearer(SECRET_KEY))).toMatchObject({
      ok: false,
      code: 'invalid_key',
    })
  })

  it('refuses a key whose environment is over quota', async () => {
    const authenticate = await setup({ [SECRET_KEY]: { ...WRITABLE, blocked: true } })

    expect(await authenticate(withBearer(SECRET_KEY))).toMatchObject({
      ok: false,
      code: 'quota_exceeded',
    })
  })

  it('never looks a malformed key up at all', async () => {
    const authenticate = await setup({})
    const get = vi.spyOn(store, 'get')

    await authenticate(request({ headers: { authorization: 'Bearer nope' } }))

    expect(get).not.toHaveBeenCalled()
  })
})

describe('allowed origins', () => {
  const allowlisted: KeyRecord = { ...WRITABLE, originAllowlist: ['https://*.example.com'] }

  it('lets a matching origin through', async () => {
    const authenticate = await setup({ [PUBLIC_KEY]: allowlisted })

    const outcome = await authenticate(
      withBearer(PUBLIC_KEY, { origin: 'https://app.example.com' }),
    )

    expect(outcome).toMatchObject({
      ok: true,
      principal: { allowedOrigin: 'https://app.example.com' },
    })
  })

  it('refuses an origin outside the list', async () => {
    const authenticate = await setup({ [PUBLIC_KEY]: allowlisted })

    expect(
      await authenticate(withBearer(PUBLIC_KEY, { origin: 'https://evil.test' })),
    ).toMatchObject({ ok: false, code: 'origin_not_allowed' })
  })

  it('refuses a public key with no Origin once a list exists, which is the whole point', async () => {
    const authenticate = await setup({ [PUBLIC_KEY]: allowlisted })

    expect(await authenticate(withBearer(PUBLIC_KEY))).toMatchObject({
      ok: false,
      code: 'origin_not_allowed',
    })
  })

  it('lets a public key with no list through from anywhere', async () => {
    const authenticate = await setup({ [PUBLIC_KEY]: WRITABLE })

    expect(
      await authenticate(withBearer(PUBLIC_KEY, { origin: 'https://anywhere.test' })),
    ).toMatchObject({ ok: true })
  })

  it('does not check the origin of a secret key, which does not live in a browser', async () => {
    const authenticate = await setup({ [SECRET_KEY]: allowlisted })

    expect(
      await authenticate(withBearer(SECRET_KEY, { origin: 'https://evil.test' })),
    ).toMatchObject({ ok: true, principal: { allowedOrigin: null } })
  })
})

describe('the hash it looks up by', () => {
  beforeAll(() => undefined)

  it('is the hash of the key, never the key itself', async () => {
    const lookedUp: string[] = []
    const authenticate = createKeyAuthenticator({
      keyStore: {
        async get(keyHash) {
          lookedUp.push(keyHash)
          return null
        },
        async set() {},
        async delete() {},
      },
    })

    await authenticate(withBearer(SECRET_KEY))

    expect(lookedUp).toEqual([await hashApiKey(SECRET_KEY)])
    expect(lookedUp[0]).not.toContain('nekolog_')
  })
})

describe('the daily quota block', () => {
  const blocking = (...environmentIds: string[]) =>
    cachedBlockedEnvironments(
      memoryQuotaStore(
        environmentIds.map((environmentId) => ({
          environmentId,
          blockedAt: 0,
          events: 10_500,
          quota: 10_000,
        })),
      ),
    )

  it('refuses a key whose environment the jobs have blocked', async () => {
    const keyStore = memoryKeyStore({ [await hashApiKey(SECRET_KEY)]: WRITABLE })
    const authenticate = createKeyAuthenticator({ keyStore, blocks: blocking('e_1') })

    expect(await authenticate(withBearer(SECRET_KEY))).toMatchObject({
      ok: false,
      code: 'quota_exceeded',
      retryAfter: QUOTA_RETRY_AFTER_SECONDS,
    })
  })

  it('lets a key through when some other environment is the one blocked', async () => {
    const keyStore = memoryKeyStore({ [await hashApiKey(SECRET_KEY)]: WRITABLE })
    const authenticate = createKeyAuthenticator({ keyStore, blocks: blocking('e_2') })

    expect(await authenticate(withBearer(SECRET_KEY))).toMatchObject({ ok: true })
  })

  it('tells a key that was revoked apart from one that is over quota', async () => {
    const keyStore = memoryKeyStore({
      [await hashApiKey(SECRET_KEY)]: { ...WRITABLE, blocked: true },
    })
    const authenticate = createKeyAuthenticator({ keyStore })

    expect(await authenticate(withBearer(SECRET_KEY))).toMatchObject({
      code: 'quota_exceeded',
      message: 'This environment is over its quota',
      retryAfter: QUOTA_RETRY_AFTER_SECONDS,
    })
  })

  it('never asks about blocks for a key it already refused', async () => {
    const asked: string[] = []
    const keyStore = memoryKeyStore({})
    const authenticate = createKeyAuthenticator({
      keyStore,
      blocks: {
        async isBlocked(environmentId) {
          asked.push(environmentId)
          return true
        },
      },
    })

    await authenticate(withBearer(SECRET_KEY))

    expect(asked).toEqual([])
  })

  it('ingests as before when no block list is wired up', async () => {
    const keyStore = memoryKeyStore({ [await hashApiKey(SECRET_KEY)]: WRITABLE })

    expect(await createKeyAuthenticator({ keyStore })(withBearer(SECRET_KEY))).toMatchObject({
      ok: true,
    })
  })
})
