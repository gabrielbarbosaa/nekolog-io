import { buildSeed, toDocument } from '@internal/seed'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_PORT,
  type LocalIngestEnv,
  localIngestApp,
  localIngestConfigFrom,
  portFrom,
} from './local.ts'
import { DEFAULT_EVENTS_PER_MINUTE } from './worker.ts'

const ENV: LocalIngestEnv = {
  CLICKHOUSE_URL: 'http://localhost:8123',
  CLICKHOUSE_DB: 'nekolog_dev',
  CLICKHOUSE_INSERT_USER: 'nekolog_ingest',
  CLICKHOUSE_INSERT_PASSWORD: 'nekolog',
}

describe('the port the local ingestion listens on', () => {
  it('has a default, so nothing has to be configured to try it', () => {
    expect(portFrom(undefined)).toBe(DEFAULT_LOCAL_PORT)
    expect(portFrom('')).toBe(DEFAULT_LOCAL_PORT)
  })

  it('takes zero, which is how a test asks the system to pick one', () => {
    expect(portFrom('0')).toBe(0)
  })

  it.each(['-1', '65536', '8787.5', 'eight thousand'])('refuses %s', (value) => {
    expect(() => portFrom(value)).toThrow('PORT')
  })
})

describe('the configuration read from the environment', () => {
  it('carries the ClickHouse credentials and the defaults', () => {
    expect(localIngestConfigFrom(ENV)).toEqual({
      port: DEFAULT_LOCAL_PORT,
      seedFile: '.nekolog-seed.json',
      clickhouse: {
        url: 'http://localhost:8123',
        database: 'nekolog_dev',
        user: 'nekolog_ingest',
        password: 'nekolog',
      },
      eventsPerMinute: DEFAULT_EVENTS_PER_MINUTE,
    })
  })

  it.each([
    'CLICKHOUSE_URL',
    'CLICKHOUSE_DB',
    'CLICKHOUSE_INSERT_USER',
    'CLICKHOUSE_INSERT_PASSWORD',
  ] as const)('says which variable is missing when %s is not set', (name) => {
    expect(() => localIngestConfigFrom({ ...ENV, [name]: undefined })).toThrow(name)
  })

  it('treats a blank value as missing, not as a password of nothing', () => {
    expect(() => localIngestConfigFrom({ ...ENV, CLICKHOUSE_INSERT_PASSWORD: '' })).toThrow(
      'CLICKHOUSE_INSERT_PASSWORD',
    )
  })

  it('refuses a rate limit that is not a positive whole number', () => {
    expect(() => localIngestConfigFrom({ ...ENV, INGEST_EVENTS_PER_MINUTE: '0' })).toThrow(
      'INGEST_EVENTS_PER_MINUTE',
    )
  })
})

describe('the app the local ingestion serves', () => {
  const config = {
    port: 0,
    seedFile: 'unused',
    clickhouse: { url: 'http://127.0.0.1:1', database: 'x', user: 'u', password: 'p' },
    eventsPerMinute: 10,
  }

  it('is up before ClickHouse is reachable, so /health can say so', async () => {
    const seed = await buildSeed({ organization: 'n', project: 'p' })
    const app = await localIngestApp({ config, document: toDocument(seed) })

    const response = await app.request('http://127.0.0.1/health')

    expect(response.status).toBe(200)
  })

  it('knows the keys the seed minted and refuses everything else', async () => {
    const seed = await buildSeed({ organization: 'n', project: 'p' })
    const app = await localIngestApp({ config, document: toDocument(seed) })

    const refused = await app.request('http://127.0.0.1/v1/logs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer nekolog_sk_notaseededkey',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(refused.status).toBe(401)
  })
})
