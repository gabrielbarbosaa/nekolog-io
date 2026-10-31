import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateApiKey, hashApiKey, type KeyRecord, memoryKeyStore } from '@internal/adapters'
import { createLogger } from '@nekolog-io/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIngestApp, createKeyAuthenticator } from '../src/index.ts'

const KEY = generateApiKey('secret')
const PUBLIC_KEY = generateApiKey('public')
const BROWSER_ORIGIN = 'https://app.example.com'

const RECORD: KeyRecord = {
  projectId: 'p_demo',
  environmentId: 'e_dev',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
}

type StoredRow = {
  projectId: string
  environmentId: string
  batchId: string
  service: string
  level: string
  message: string
}

const stored: StoredRow[] = []
let endpoint = ''
let server: Server

const keyStore = memoryKeyStore()

const app = createIngestApp({
  authenticate: createKeyAuthenticator({ keyStore }),
  sink: (batch, principal) => {
    for (const accepted of batch.accepted) {
      stored.push({
        projectId: principal.projectId,
        environmentId: principal.environmentId,
        batchId: batch.batchId,
        service: batch.resource.service,
        level: accepted.event.level,
        message: accepted.event.message,
      })
    }
  },
})

async function toRequest(incoming: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of incoming) {
    chunks.push(chunk as Buffer)
  }

  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') {
      headers.set(name, value)
    }
  }

  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD'
  return new Request(`http://127.0.0.1${incoming.url ?? '/'}`, {
    method: incoming.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : null,
  })
}

async function gzip(value: unknown): Promise<ArrayBuffer> {
  const source = new Response(new TextEncoder().encode(JSON.stringify(value))).body
  if (source === null) {
    throw new Error('no stream')
  }
  return new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

function send(body: string | ArrayBuffer, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${endpoint}/v1/logs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...headers },
    body,
  })
}

beforeAll(async () => {
  await keyStore.set(await hashApiKey(KEY), RECORD)
  await keyStore.set(await hashApiKey(PUBLIC_KEY), {
    ...RECORD,
    originAllowlist: [BROWSER_ORIGIN],
  })

  server = createServer((incoming, outgoing) => {
    void (async () => {
      const response = await app.fetch(await toRequest(incoming))
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the sdk talking to the ingest app over real http', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${endpoint}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('carries a batch from the node sdk all the way to the sink', async () => {
    const before = stored.length
    const log = createLogger({
      apiKey: KEY,
      service: 'checkout-api',
      level: 'trace',
      transport: { endpoint, flushIntervalMs: 0 },
    })

    log.info('Pedido criado', { orderId: 123 })
    log.error(new TypeError('boom'), { step: 'pagamento' })
    await log.flush()

    const arrived = stored.slice(before)
    expect(arrived.map((row) => [row.level, row.message])).toEqual([
      ['info', 'Pedido criado'],
      ['error', 'boom'],
    ])
    expect(arrived[0]?.service).toBe('checkout-api')
  })

  it('stamps project and environment from the key, never from the client', async () => {
    const before = stored.length

    const response = await send(
      JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b20',
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'liar', runtime: 'node' },
        projectId: 'p_someone_else',
        environmentId: 'e_production',
        events: [{ timestamp: '2026-10-31T12:00:00.000Z', level: 'info', message: 'nice try' }],
      }),
    )

    expect(response.status).toBe(202)
    expect(stored.slice(before)).toEqual([
      expect.objectContaining({ projectId: 'p_demo', environmentId: 'e_dev' }),
    ])
  })

  it('refuses an unknown key with the stable code', async () => {
    const response = await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${generateApiKey('secret')}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_key' } })
  })

  it('takes a browser-shaped request: key in the query, text/plain, no preflight', async () => {
    const before = stored.length

    const response = await fetch(`${endpoint}/v1/logs?key=${PUBLIC_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: BROWSER_ORIGIN },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b30',
        sdk: { name: '@nekolog-io/browser', version: '0.0.0' },
        resource: { service: 'checkout-web', runtime: 'browser' },
        events: [{ timestamp: '2026-10-31T12:00:00.000Z', level: 'info', message: 'from a tab' }],
      }),
    })

    expect(response.status).toBe(202)
    expect(response.headers.get('access-control-allow-origin')).toBe(BROWSER_ORIGIN)
    expect(stored.slice(before).map((row) => row.message)).toEqual(['from a tab'])
  })

  it('refuses the same request from an origin not on the list', async () => {
    const before = stored.length

    const response = await fetch(`${endpoint}/v1/logs?key=${PUBLIC_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://evil.test' },
      body: '{}',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'origin_not_allowed' } })
    expect(stored.slice(before)).toEqual([])
  })

  it('refuses a secret key that travelled in the URL', async () => {
    const response = await fetch(`${endpoint}/v1/logs?key=${KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'secret_key_in_url' } })
  })

  it('answers a real preflight', async () => {
    const response = await fetch(`${endpoint}/v1/logs`, {
      method: 'OPTIONS',
      headers: { origin: BROWSER_ORIGIN },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(BROWSER_ORIGIN)
    expect(response.headers.get('access-control-allow-headers')).toContain('traceparent')
  })

  it('accepts a really gzipped request', async () => {
    const before = stored.length
    const body = await gzip({
      schemaVersion: 1,
      batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b21',
      sdk: { name: '@nekolog-io/node', version: '0.0.0' },
      resource: { service: 'gzipped', runtime: 'node' },
      events: [
        { timestamp: '2026-10-31T12:00:00.000Z', level: 'warn', message: 'came in compressed' },
      ],
    })

    const response = await send(body, { 'content-encoding': 'gzip' })

    expect(response.status).toBe(202)
    expect(stored.slice(before).map((row) => row.message)).toEqual(['came in compressed'])
  })

  it('refuses a tiny gzip that unpacks into megabytes', async () => {
    const before = stored.length
    const source = new Response(new Uint8Array(4 * 1024 * 1024)).body
    if (source === null) {
      throw new Error('no stream')
    }
    const bomb = await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()

    expect(bomb.byteLength).toBeLessThan(8 * 1024)

    const response = await send(bomb, { 'content-encoding': 'gzip' })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } })
    expect(stored.slice(before)).toEqual([])
  })
})
