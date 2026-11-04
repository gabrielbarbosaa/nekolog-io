import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSeed, toDocument } from '@internal/seed'
import { fileBlobStore, fileKvNamespace } from '@internal/self-host'
import { kvQuotaStore } from '@nekolog-io/adapters'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localIngestApp } from './local.ts'
import {
  DEFAULT_SELF_HOST_HOST,
  type SelfHostIngestEnv,
  selfHostIngestConfigFrom,
  selfHostIngestWiring,
} from './self-host.ts'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'nekolog-ingest-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

function envFor(): SelfHostIngestEnv {
  return {
    CLICKHOUSE_URL: 'http://127.0.0.1:1',
    CLICKHOUSE_DB: 'nekolog',
    CLICKHOUSE_INSERT_USER: 'nekolog_ingest',
    CLICKHOUSE_INSERT_PASSWORD: 'nekolog',
    SPOOL_DIR: join(folder, 'spool'),
    KV_DIR: join(folder, 'kv'),
  }
}

async function batchFor(key: string): Promise<RequestInit> {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      batchId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      sdk: { name: 'node', version: '1.0.0' },
      resource: { service: 'checkout', runtime: 'node' },
      events: [{ timestamp: new Date().toISOString(), level: 'error', message: 'it broke' }],
    }),
  }
}

describe('the configuration the self-host ingest container reads', () => {
  it('listens on every interface, because nothing else in the compose could reach it', () => {
    expect(selfHostIngestConfigFrom(envFor()).host).toBe(DEFAULT_SELF_HOST_HOST)
    expect(DEFAULT_SELF_HOST_HOST).toBe('0.0.0.0')
  })

  it('still lets the operator pin the interface', () => {
    expect(selfHostIngestConfigFrom({ ...envFor(), INGEST_HOST: '10.0.0.4' }).host).toBe('10.0.0.4')
  })

  it.each(['SPOOL_DIR', 'KV_DIR'] as const)('refuses to start without %s', (name) => {
    expect(() => selfHostIngestConfigFrom({ ...envFor(), [name]: undefined })).toThrow(name)
    expect(() => selfHostIngestConfigFrom({ ...envFor(), [name]: '' })).toThrow(name)
  })

  it('names every missing value at once, instead of one per restart', () => {
    expect(() =>
      selfHostIngestConfigFrom({ ...envFor(), SPOOL_DIR: undefined, KV_DIR: undefined }),
    ).toThrow(/SPOOL_DIR, KV_DIR/)
  })
})

describe('what the self-host ingest container is wired to', () => {
  it('parks a batch ClickHouse refused in the directory the jobs container reads', async () => {
    const config = selfHostIngestConfigFrom(envFor())
    const seed = await buildSeed({ organization: 'n', project: 'p' })
    const key = seed.environments[0]?.keys.find((entry) => entry.kind === 'secret')?.value as string

    const app = await localIngestApp(selfHostIngestWiring({ config, document: toDocument(seed) }))
    const response = await app.request('http://127.0.0.1/v1/logs', await batchFor(key))

    expect(response.status).toBe(202)

    const spooled = await fileBlobStore(config.spoolDir).list('spool/')
    expect(spooled).toHaveLength(1)
  })

  it('reads the block list the jobs container writes, through the same directory', async () => {
    const config = selfHostIngestConfigFrom(envFor())
    const seed = await buildSeed({ organization: 'n', project: 'p' })
    const environment = seed.environments[0]
    const key = environment?.keys.find((entry) => entry.kind === 'secret')?.value as string

    await kvQuotaStore(fileKvNamespace(config.kvDir)).replace([
      {
        environmentId: environment?.id as string,
        blockedAt: Date.now(),
        events: 10,
        quota: 1,
      },
    ])

    const app = await localIngestApp(selfHostIngestWiring({ config, document: toDocument(seed) }))
    const response = await app.request('http://127.0.0.1/v1/logs', await batchFor(key))

    expect(response.status).toBe(429)
  })
})
