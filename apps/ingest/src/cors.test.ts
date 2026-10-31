import { generateApiKey, hashApiKey, type KeyRecord, memoryKeyStore } from '@internal/adapters'
import { describe, expect, it } from 'vitest'
import { createIngestApp, type IngestPrincipal } from './app.ts'
import { createKeyAuthenticator } from './authenticate.ts'
import { ALLOWED_REQUEST_HEADERS, PREFLIGHT_MAX_AGE_SECONDS } from './cors.ts'

const PUBLIC_KEY = generateApiKey('public')
const ORIGIN = 'https://app.example.com'

const RECORD: KeyRecord = {
  projectId: 'p_1',
  environmentId: 'e_1',
  scopes: ['logs:write'],
  originAllowlist: [ORIGIN],
  blocked: false,
}

async function setup() {
  const stored: IngestPrincipal[] = []
  const keyStore = memoryKeyStore({ [await hashApiKey(PUBLIC_KEY)]: RECORD })
  const app = createIngestApp({
    authenticate: createKeyAuthenticator({ keyStore }),
    sink: (_batch, principal) => {
      stored.push(principal)
    },
  })
  return { app, stored }
}

function batch(): string {
  return JSON.stringify({
    schemaVersion: 1,
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    sdk: { name: '@nekolog-io/browser', version: '0.0.0' },
    resource: { service: 'checkout-web', runtime: 'browser' },
    events: [{ timestamp: '2026-10-31T12:00:00.000Z', level: 'info', message: 'hello' }],
  })
}

describe('preflight', () => {
  it('answers 204 and echoes the origin that asked', async () => {
    const { app } = await setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(response.headers.get('vary')).toBe('Origin')
  })

  it('allows the headers the SDK actually sends, traceparent included', async () => {
    const { app } = await setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    })
    const allowed = (response.headers.get('access-control-allow-headers') ?? '').split(', ')

    expect(allowed).toEqual([...ALLOWED_REQUEST_HEADERS])
    expect(allowed).toContain('traceparent')
    expect(response.headers.get('access-control-max-age')).toBe(String(PREFLIGHT_MAX_AGE_SECONDS))
  })

  it('never grants credentials, because this API has no cookies to protect', async () => {
    const { app } = await setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test' },
    })

    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('does not decide anything: a disallowed origin still fails on the real request', async () => {
    const { app, stored } = await setup()

    const preflight = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test' },
    })
    const post = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: {
        origin: 'https://evil.test',
        authorization: `Bearer ${PUBLIC_KEY}`,
        'content-type': 'application/json',
      },
      body: batch(),
    })

    expect(preflight.status).toBe(204)
    expect(post.status).toBe(403)
    expect(await post.json()).toMatchObject({ error: { code: 'origin_not_allowed' } })
    expect(stored).toEqual([])
  })
})

describe('cors on the real request', () => {
  it('echoes the origin on a 202', async () => {
    const { app } = await setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${PUBLIC_KEY}`,
        'content-type': 'application/json',
      },
      body: batch(),
    })

    expect(response.status).toBe(202)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('echoes the origin on a refusal too, so the browser SDK can read the code', async () => {
    const { app } = await setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: {
        origin: 'https://evil.test',
        authorization: 'Bearer nekolog_pk_doesnotexistatall',
        'content-type': 'application/json',
      },
      body: batch(),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://evil.test')
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_key' } })
  })

  it('says Vary on Origin even when there is no origin to echo', async () => {
    const { app } = await setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: { authorization: `Bearer ${PUBLIC_KEY}`, 'content-type': 'application/json' },
      body: batch(),
    })

    expect(response.headers.get('vary')).toBe('Origin')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('the browser path end to end', () => {
  it('takes a sendBeacon-shaped request: key in the query, text/plain, no headers', async () => {
    const { app, stored } = await setup()

    const response = await app.request(`https://ingest.nekolog.io/v1/logs?key=${PUBLIC_KEY}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
      body: batch(),
    })

    expect(response.status).toBe(202)
    expect(stored[0]).toMatchObject({
      projectId: 'p_1',
      keyKind: 'public',
      keyLocation: 'query',
      allowedOrigin: ORIGIN,
    })
  })

  it('refuses a secret key in the query even when everything else is right', async () => {
    const secret = generateApiKey('secret')
    const keyStore = memoryKeyStore({ [await hashApiKey(secret)]: RECORD })
    const app = createIngestApp({
      authenticate: createKeyAuthenticator({ keyStore }),
      sink: () => undefined,
    })

    const response = await app.request(`https://ingest.nekolog.io/v1/logs?key=${secret}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: batch(),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'secret_key_in_url' } })
  })
})
