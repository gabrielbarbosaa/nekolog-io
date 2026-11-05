import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSeed,
  keyRecordsFor,
  type SeedDocument,
  serialiseSeedDocument,
  toDocument,
} from '@internal/seed'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_RELOAD_MS, fileSeedKeyStore, ReadOnlyKeyStore } from './seed-key-store.ts'

let folder: string
let path: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'nekolog-seed-store-'))
  path = join(folder, '.nekolog-seed.json')
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

async function write(document: SeedDocument): Promise<void> {
  await writeFile(path, serialiseSeedDocument(document), 'utf8')
}

async function documentFor(): Promise<SeedDocument> {
  return toDocument(await buildSeed({ organization: 'n', project: 'p', environments: ['prod'] }))
}

function withMinLevel(document: SeedDocument, minLevel: string): SeedDocument {
  return {
    ...document,
    environments: document.environments.map((environment) => ({ ...environment, minLevel })),
  }
}

describe('the key store the self-host ingestion reads', () => {
  it('hands back what the seed file says, settings and all', async () => {
    const document = await documentFor()
    await write(document)

    const store = fileSeedKeyStore(path)
    const first = keyRecordsFor(document)[0]

    expect(await store.get(first?.keyHash as string)).toEqual(first?.record)
    expect(await store.get('a hash nobody minted')).toBeNull()
  })

  it('refuses to start when the file is not there, instead of letting nobody in', () => {
    expect(() => fileSeedKeyStore(path)).toThrow()
  })

  it('refuses to start on a document it cannot read, for the same reason', async () => {
    await writeFile(path, '{ not json', 'utf8')
    expect(() => fileSeedKeyStore(path)).toThrow()
  })

  it('picks up a setting that changed, without anybody restarting it', async () => {
    const document = await documentFor()
    await write(document)

    const store = fileSeedKeyStore(path, { reloadMs: 0 })
    const hash = keyRecordsFor(document)[0]?.keyHash as string
    expect((await store.get(hash))?.minLevel).toBe('trace')

    await write(withMinLevel(document, 'warn'))
    expect((await store.get(hash))?.minLevel).toBe('warn')
  })

  it('does not stat the file on every request, because every request asks', async () => {
    const document = await documentFor()
    await write(document)

    let clock = 0
    const reloads: number[] = []
    const store = fileSeedKeyStore(path, {
      reloadMs: 1000,
      now: () => clock,
      onReload: () => reloads.push(clock),
    })
    const hash = keyRecordsFor(document)[0]?.keyHash as string

    await write(withMinLevel(document, 'warn'))
    clock = 999
    expect((await store.get(hash))?.minLevel).toBe('trace')

    clock = 1000
    expect((await store.get(hash))?.minLevel).toBe('warn')
    expect(reloads).toEqual([1000])
  })

  it('keeps the keys it has when the file goes bad, so a bad edit is not an outage', async () => {
    const document = await documentFor()
    await write(document)

    const seen: unknown[] = []
    const store = fileSeedKeyStore(path, { reloadMs: 0, onError: (error) => seen.push(error) })
    const hash = keyRecordsFor(document)[0]?.keyHash as string

    await writeFile(path, '{ half a document', 'utf8')

    expect((await store.get(hash))?.minLevel).toBe('trace')
    expect(seen).toHaveLength(1)
  })

  it('reloads often enough to be worth calling a reload', () => {
    expect(DEFAULT_RELOAD_MS).toBeLessThanOrEqual(60_000)
  })

  it('refuses a write, because the seed file is where these keys live', async () => {
    const document = await documentFor()
    await write(document)
    const store = fileSeedKeyStore(path)
    const first = keyRecordsFor(document)[0]

    await expect(
      store.set(first?.keyHash as string, first?.record as never),
    ).rejects.toBeInstanceOf(ReadOnlyKeyStore)
    await expect(store.delete(first?.keyHash as string)).rejects.toBeInstanceOf(ReadOnlyKeyStore)
  })
})
