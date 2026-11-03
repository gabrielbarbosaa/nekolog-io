import { createLogger as createBrowserLogger, keyedUrl } from '@nekolog-io/browser'
import {
  type FetchLike,
  parseTraceparent,
  SCHEMA_VERSION,
  type TransportTuning,
  traceForRequest,
  uuidv7,
} from '@nekolog-io/core'
import { createLogger as createNodeLogger, startRequest } from '@nekolog-io/node'

const PUBLIC_KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'
const SECRET_KEY = 'nekolog_sk_0123456789abcdef0123456789abcdef'

type Sent = { url: string; body: string; headers: Record<string, string> }

type Envelope = {
  schemaVersion: number
  batchId: string
  sdk: { name: string; version: string }
  resource: { runtime: string; service?: string }
  events: Array<{
    level: string
    message: string
    attributes?: Record<string, unknown>
    session?: { id?: string; userId?: string }
    error?: { type?: string; stack?: string }
  }>
}

const failures: string[] = []

function check(what: string, passed: boolean): void {
  if (!passed) {
    failures.push(what)
  }
}

function recorder(): { sent: Sent[]; fetch: TransportTuning } {
  const sent: Sent[] = []
  return {
    sent,
    fetch: {
      flushIntervalMs: 10,
      fetch: (async (url, init) => {
        sent.push({ url, body: init.body, headers: init.headers })
        return {
          ok: true,
          status: 202,
          headers: { get: () => null },
          text: () => Promise.resolve('{"accepted":1}'),
        }
      }) as FetchLike,
    },
  }
}

async function nodeSdkSends(): Promise<void> {
  const { sent, fetch } = recorder()
  const log = createNodeLogger({
    apiKey: SECRET_KEY,
    service: 'compat',
    release: '1.0.0',
    transport: fetch,
  })

  log.error(new TypeError('card is undefined'), { 'order.id': 'ord_7' })
  await log.flush()

  check('the node sdk sent exactly one batch', sent.length === 1)

  const batch = sent[0]
  if (batch === undefined) {
    return
  }

  const envelope = JSON.parse(batch.body) as Envelope
  const event = envelope.events[0]

  check('the batch went to /v1/logs', batch.url.endsWith('/v1/logs'))
  check(
    'the secret key travelled in the header',
    batch.headers.Authorization === `Bearer ${SECRET_KEY}`,
  )
  check('the envelope declares the schema version', envelope.schemaVersion === SCHEMA_VERSION)
  check('the batch id is a uuid', /^[0-9a-f-]{36}$/.test(envelope.batchId))
  check('the sdk names itself', envelope.sdk.name === '@nekolog-io/node')
  check('the runtime is node', envelope.resource.runtime === 'node')
  check('the service came through', envelope.resource.service === 'compat')
  check('the error kept its type', event?.error?.type === 'TypeError')
  check('the error kept a stack', typeof event?.error?.stack === 'string')
  check('the attribute came through', event?.attributes?.['order.id'] === 'ord_7')
}

async function browserSdkSends(): Promise<void> {
  const { sent, fetch } = recorder()
  const log = createBrowserLogger({
    apiKey: PUBLIC_KEY,
    service: 'compat-browser',
    sendBeacon: false,
    offline: false,
    transport: fetch,
    page: false,
  })

  log.warn('the card expires soon')
  await log.flush()

  check('the browser sdk sent exactly one batch', sent.length === 1)

  const batch = sent[0]
  if (batch === undefined) {
    return
  }

  const envelope = JSON.parse(batch.body) as Envelope

  check('the browser runtime is declared', envelope.resource.runtime === 'browser')
  check('the browser sdk names itself', envelope.sdk.name === '@nekolog-io/browser')
  check('the event carries a session', typeof envelope.events[0]?.session?.id === 'string')
  check('the level survived', envelope.events[0]?.level === 'warn')
}

function secretKeysAreRefusedInABrowser(): void {
  const { sent, fetch } = recorder()
  const refused: unknown[] = []

  const log = createBrowserLogger({
    apiKey: SECRET_KEY,
    transport: fetch,
    sendBeacon: false,
    offline: false,
    onError: (error) => refused.push(error),
  })
  log.error('this must not leave the page')

  check('a secret key in a browser is refused', refused.length === 1)
  check('and nothing was sent with it', sent.length === 0)
}

function tracingWorks(): void {
  const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
  const began = startRequest({ traceparent: incoming, requestId: 'req_1' })
  const parsed = parseTraceparent(began.headers.traceparent)

  check('the trace of the caller continues', parsed?.traceId === '4bf92f3577b34da6a3ce929d0e0e4736')
  check('with a span of our own', began.trace.spanId !== '00f067aa0ba902b7')
  check('and the request id answers back', began.headers['x-request-id'] === 'req_1')
  check('traceForRequest agrees', traceForRequest(incoming).trace.traceId === parsed?.traceId)
}

function cryptoWorks(): void {
  const made = new Set(Array.from({ length: 200 }, () => uuidv7()))

  check('uuidv7 is available in this runtime', made.size === 200)
  check(
    'the key goes in the url for a beacon',
    keyedUrl('https://x/v1/logs', 'k') === 'https://x/v1/logs?key=k',
  )
}

const runtime =
  (globalThis as { Deno?: unknown }).Deno !== undefined
    ? 'deno'
    : (globalThis as { Bun?: unknown }).Bun !== undefined
      ? 'bun'
      : `node ${(globalThis as { process?: { version?: string } }).process?.version ?? '?'}`

await nodeSdkSends()
await browserSdkSends()
secretKeysAreRefusedInABrowser()
tracingWorks()
cryptoWorks()

if (failures.length > 0) {
  console.error(`[compat] ${runtime}: ${failures.length} checks failed`)
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  throw new Error(`the sdks do not behave on ${runtime}`)
}

console.log(`[compat] ${runtime}: every check passed`)
