import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSeed,
  type Seed,
  type SeedDocument,
  serialiseSeedDocument,
  toDocument,
} from '@internal/seed'
import { fileBlobStore, fileKvNamespace, fileSeedKeyStore } from '@internal/self-host'
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

async function seedFileFrom(seed: Seed): Promise<{ path: string; document: SeedDocument }> {
  const document = toDocument(seed)
  const path = join(folder, '.nekolog-seed.json')
  await writeFile(path, serialiseSeedDocument(document), 'utf8')
  return { path, document }
}

let batches = 0

async function batchFor(key: string, message = 'it broke'): Promise<RequestInit> {
  batches += 1
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      batchId: `0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${batches.toString(16).padStart(2, '0')}`,
      sdk: { name: 'node', version: '1.0.0' },
      resource: { service: 'checkout', runtime: 'node' },
      events: [{ timestamp: new Date().toISOString(), level: 'error', message }],
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
    const { path, document } = await seedFileFrom(seed)

    const app = await localIngestApp(selfHostIngestWiring({ config, document, seedFile: path }))
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

    const { path, document } = await seedFileFrom(seed)
    const app = await localIngestApp(selfHostIngestWiring({ config, document, seedFile: path }))
    const response = await app.request('http://127.0.0.1/v1/logs', await batchFor(key))

    expect(response.status).toBe(429)
  })
})

async function spooledMessages(spoolDir: string): Promise<string[]> {
  const spool = fileBlobStore(spoolDir)
  const messages: string[] = []
  for (const key of await spool.list('spool/')) {
    const bytes = await spool.get(key)
    const envelope = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as {
      rows: { message: string }[]
    }
    for (const row of envelope.rows) {
      messages.push(row.message)
    }
  }
  return messages
}

describe('the redaction the operator turns on', () => {
  it('blanks a CPF the sender put in the message, because the seed says to', async () => {
    const config = selfHostIngestConfigFrom(envFor())
    const seed = await buildSeed({ organization: 'n', project: 'p', redaction: null })
    const key = seed.environments[0]?.keys.find((entry) => entry.kind === 'secret')?.value as string
    const { path, document } = await seedFileFrom(seed)

    const store = fileSeedKeyStore(path, { reloadMs: 0 })
    const app = await localIngestApp({
      ...selfHostIngestWiring({ config, document, seedFile: path }),
      keyStore: store,
    })

    const before = await app.request(
      'http://127.0.0.1/v1/logs',
      await batchFor(key, 'cpf 390.533.447-05'),
    )
    expect(before.status).toBe(202)
    expect(await spooledMessages(config.spoolDir)).toEqual(['cpf 390.533.447-05'])

    const turnedOn = {
      ...document,
      environments: document.environments.map((environment) => ({
        ...environment,
        redaction: { attributes: [], patterns: ['cpf'] as const, replacement: '[redacted]' },
      })),
    }
    await writeFile(path, serialiseSeedDocument(turnedOn as SeedDocument), 'utf8')

    const after = await app.request(
      'http://127.0.0.1/v1/logs',
      await batchFor(key, 'cpf 390.533.447-05'),
    )
    expect(after.status).toBe(202)
    expect(await spooledMessages(config.spoolDir)).toEqual(['cpf 390.533.447-05', 'cpf [redacted]'])
  })
})
