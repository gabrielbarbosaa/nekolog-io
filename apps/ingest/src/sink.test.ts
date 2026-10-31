import {
  generateApiKey,
  hashApiKey,
  type KeyRecord,
  type LogStore,
  type LogStoreInsertOptions,
  memoryBlobStore,
  memoryKeyStore,
} from '@internal/adapters'
import { decodeSpoolEnvelope, SPOOL_PREFIX, spoolKey } from '@internal/spool'
import { describe, expect, it, vi } from 'vitest'
import { createIngestApp } from './app.ts'
import { createKeyAuthenticator } from './authenticate.ts'
import { createLogStoreSink, type LogStoreSinkOptions, type SpooledBatch } from './sink.ts'
import {
  assertEnv,
  buildIngestApp,
  DEFAULT_EVENTS_PER_MINUTE,
  eventsPerMinuteFrom,
} from './worker.ts'

const KEY = generateApiKey('secret')

const RECORD: KeyRecord = {
  projectId: 'p_1',
  environmentId: 'e_1',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
  retentionDays: 14,
}

type Insert = { rows: ReadonlyArray<Record<string, unknown>>; options?: LogStoreInsertOptions }

function recordingStore(behaviour: () => Promise<void> = async () => undefined) {
  const inserts: Insert[] = []
  const logStore: LogStore = {
    async insert(rows, options) {
      inserts.push({ rows, options })
      await behaviour()
      return { accepted: rows.length }
    },
  }
  return { logStore, inserts }
}

const RECEIVED_AT = Date.UTC(2026, 9, 31, 15, 30, 45, 125)

async function setup(
  logStore: LogStore,
  extra: Record<string, unknown> = {},
  sink: Partial<LogStoreSinkOptions> = {},
) {
  const keyStore = memoryKeyStore({ [await hashApiKey(KEY)]: RECORD })
  const onError = vi.fn()
  const app = createIngestApp({
    authenticate: createKeyAuthenticator({ keyStore }),
    sink: createLogStoreSink({ logStore, now: () => RECEIVED_AT, ...sink }),
    onError,
    now: () => RECEIVED_AT,
    ...extra,
  })
  return { app, onError }
}

function body(events?: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    schemaVersion: 1,
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    sdk: { name: '@nekolog-io/node', version: '0.0.0' },
    resource: { service: 'checkout-api', runtime: 'node' },
    events: events ?? [{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'hello' }],
  })
}

function post(headers: Record<string, string> = {}, payload = body()): Request {
  return new Request('https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: payload,
  })
}

describe('the log store sink', () => {
  it('writes the mapped rows', async () => {
    const { logStore, inserts } = recordingStore()
    const { app } = await setup(logStore)

    const response = await app.request(post({ 'cf-ipcountry': 'BR' }))

    expect(response.status).toBe(202)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.rows[0]).toMatchObject({
      project_id: 'p_1',
      environment_id: 'e_1',
      message: 'hello',
      country: 'BR',
      retention_days: 14,
      received_at: '2026-10-31 15:30:45.125',
    })
  })

  it('scopes the deduplication token to the environment, not just the batch id', async () => {
    const { logStore, inserts } = recordingStore()
    const { app } = await setup(logStore)

    await app.request(post())

    expect(inserts[0]?.options).toEqual({
      deduplicationToken: 'e_1:01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    })
  })

  it('does not touch the store when nothing in the batch was accepted', async () => {
    const { logStore, inserts } = recordingStore()
    const { app } = await setup(logStore)
    const allBad = body([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'verbose', message: 'no' },
    ])

    const response = await app.request(post({}, allBad))

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ accepted: 0 })
    expect(inserts).toEqual([])
  })

  it('reads the country from Cloudflare and never an IP', async () => {
    const { logStore, inserts } = recordingStore()
    const { app } = await setup(logStore)

    await app.request(post({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' }))

    const row = inserts[0]?.rows[0] ?? {}
    expect(row.country).toBe('')
    expect(JSON.stringify(row)).not.toContain('203.0.113')
  })

  it('still answers 202 when ClickHouse refuses, and reports it', async () => {
    const boom = new Error('Code: 497. DB::Exception: not enough privileges')
    const { logStore } = recordingStore(async () => {
      throw boom
    })
    const { app, onError } = await setup(logStore)

    const response = await app.request(post())

    expect(response.status).toBe(202)
    expect(onError).toHaveBeenCalledWith(boom)
  })
})

describe('the spool, when ClickHouse refuses', () => {
  const BATCH_ID = '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10'
  const refuses = () =>
    recordingStore(async () => {
      throw new Error('Code: 210. DB::NetException: Connection refused')
    })

  async function spooling(extra: Partial<LogStoreSinkOptions> = {}) {
    const spool = memoryBlobStore()
    const spooled: SpooledBatch[] = []
    const { logStore } = refuses()
    const { app, onError } = await setup(
      logStore,
      {},
      { spool, onSpooled: (event) => spooled.push(event), ...extra },
    )
    return { app, onError, spool, spooled }
  }

  it('keeps the batch instead of losing it, and still answers 202', async () => {
    const { app, onError, spool } = await spooling()

    const response = await app.request(post({ 'cf-ipcountry': 'BR' }))

    expect(response.status).toBe(202)
    expect(onError).not.toHaveBeenCalled()
    expect(await spool.list(SPOOL_PREFIX)).toEqual([spoolKey(RECEIVED_AT, BATCH_ID)])
  })

  it('writes the mapped rows and the token the live insert would have used', async () => {
    const { app, spool } = await spooling()

    await app.request(post({ 'cf-ipcountry': 'BR' }))

    const written = await spool.get(spoolKey(RECEIVED_AT, BATCH_ID))
    const envelope = decodeSpoolEnvelope(written ?? new Uint8Array())

    expect(envelope).toMatchObject({
      batchId: BATCH_ID,
      projectId: 'p_1',
      environmentId: 'e_1',
      deduplicationToken: `e_1:${BATCH_ID}`,
      spooledAt: RECEIVED_AT,
    })
    expect(envelope.rows[0]).toMatchObject({ project_id: 'p_1', message: 'hello', country: 'BR' })
  })

  it('carries no IP into the spool either', async () => {
    const { app, spool } = await spooling()

    await app.request(post({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' }))

    const written = await spool.get(spoolKey(RECEIVED_AT, BATCH_ID))
    expect(new TextDecoder().decode(written ?? new Uint8Array())).not.toContain('203.0.113')
  })

  it('says what it kept, and how much', async () => {
    const { app, spooled } = await spooling()

    await app.request(post())

    expect(spooled).toHaveLength(1)
    expect(spooled[0]).toMatchObject({ key: spoolKey(RECEIVED_AT, BATCH_ID), rows: 1 })
  })

  it('reports both failures when the spool is down too', async () => {
    const broken = {
      ...memoryBlobStore(),
      async put() {
        throw new Error('R2 is unreachable')
      },
    }
    const { logStore } = refuses()
    const { app, onError } = await setup(logStore, {}, { spool: broken })

    const response = await app.request(post())

    expect(response.status).toBe(202)
    expect(onError).toHaveBeenCalledTimes(1)
    const reported = String(onError.mock.calls[0]?.[0])
    expect(reported).toContain('Connection refused')
    expect(reported).toContain('R2 is unreachable')
  })

  it('reports the failure when there is no spool configured at all', async () => {
    const { logStore } = refuses()
    const { app, onError } = await setup(logStore)

    expect((await app.request(post())).status).toBe(202)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('writes nothing to the spool when the insert works', async () => {
    const spool = memoryBlobStore()
    const { logStore } = recordingStore()
    const { app } = await setup(logStore, {}, { spool })

    await app.request(post())

    expect(spool.size).toBe(0)
  })

  it('survives a reporter that throws, because the batch is already safe', async () => {
    const { app, spool, onError } = await spooling({
      onSpooled: () => {
        throw new Error('the log sink is down')
      },
    })

    await app.request(post())

    expect(await spool.list(SPOOL_PREFIX)).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('waitUntil', () => {
  it('hands the write to the platform instead of waiting for it', async () => {
    let release = (): void => undefined
    const { logStore, inserts } = recordingStore(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve()
        }),
    )
    const { app } = await setup(logStore)
    const pending: Array<Promise<unknown>> = []

    const response = await app.fetch(
      post(),
      {},
      {
        waitUntil: (work: Promise<unknown>) => pending.push(work),
        passThroughOnException: () => undefined,
        props: {},
      },
    )

    expect(response.status).toBe(202)
    expect(pending).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    release()
    await Promise.all(pending)
  })

  it('waits for the write when the runtime has no waitUntil', async () => {
    let finished = false
    const { logStore } = recordingStore(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      finished = true
    })
    const { app } = await setup(logStore)

    await app.request(post())

    expect(finished).toBe(true)
  })
})

describe('the worker entry', () => {
  const ENV = {
    KEYS: {
      async get() {
        return null
      },
      async put() {},
      async delete() {},
    },
    SPOOL: {
      async put() {
        return undefined
      },
      async get() {
        return null
      },
      async delete() {},
      async list() {
        return { objects: [], truncated: false }
      },
    },
    CLICKHOUSE_URL: 'http://clickhouse.test:8123',
    CLICKHOUSE_DB: 'nekolog_dev',
    CLICKHOUSE_INSERT_USER: 'nekolog_ingest',
    CLICKHOUSE_INSERT_PASSWORD: 'secret',
  }

  it('accepts a complete environment', () => {
    expect(assertEnv(ENV)).toBe(ENV)
  })

  it.each([
    'KEYS',
    'SPOOL',
    'CLICKHOUSE_URL',
    'CLICKHOUSE_DB',
    'CLICKHOUSE_INSERT_USER',
    'CLICKHOUSE_INSERT_PASSWORD',
  ] as const)('refuses an environment missing %s, and says which', (name) => {
    const broken = { ...ENV, [name]: undefined }

    expect(() => assertEnv(broken)).toThrow(new RegExp(name))
  })

  it('names every missing binding at once, not just the first', () => {
    expect(() => assertEnv({})).toThrow(/KEYS.*CLICKHOUSE_URL/)
  })

  it('treats an empty string as missing', () => {
    expect(() => assertEnv({ ...ENV, CLICKHOUSE_URL: '' })).toThrow(/CLICKHOUSE_URL/)
  })

  it.each(['nope', '0', '-1', '2.5'])(
    'refuses to boot on the rate limit %s rather than guess one',
    (limit) => {
      expect(() => assertEnv({ ...ENV, INGEST_EVENTS_PER_MINUTE: limit })).toThrow(
        /INGEST_EVENTS_PER_MINUTE/,
      )
    },
  )

  it('falls back to the shipped rate limit when none is configured', () => {
    expect(eventsPerMinuteFrom(undefined)).toBe(DEFAULT_EVENTS_PER_MINUTE)
    expect(eventsPerMinuteFrom('')).toBe(DEFAULT_EVENTS_PER_MINUTE)
    expect(eventsPerMinuteFrom('750')).toBe(750)
  })

  it('builds an app that refuses an unknown key', async () => {
    const app = buildIngestApp(assertEnv(ENV))

    const response = await app.request(post())

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_key' } })
  })

  it('answers the health check without any binding being reachable', async () => {
    const app = buildIngestApp(assertEnv(ENV))

    expect((await app.request('https://ingest.nekolog.io/health')).status).toBe(200)
  })
})
