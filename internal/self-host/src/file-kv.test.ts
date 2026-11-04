import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kvQuotaStore, QUOTA_BLOCKS_KEY } from '@nekolog-io/adapters'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileKvNamespace, TEMPORARY_PREFIX } from './file-kv.ts'
import { kvFileName, UnsafeKey } from './keys.ts'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'nekolog-kv-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('the file KV, which is how the jobs container tells the ingest container to block', () => {
  it('reads back what it wrote, and null for what it never wrote', async () => {
    const kv = fileKvNamespace(folder)

    expect(await kv.get(QUOTA_BLOCKS_KEY, 'text')).toBeNull()
    await kv.put(QUOTA_BLOCKS_KEY, '[]')
    expect(await kv.get(QUOTA_BLOCKS_KEY, 'text')).toBe('[]')

    await kv.delete(QUOTA_BLOCKS_KEY)
    expect(await kv.get(QUOTA_BLOCKS_KEY, 'text')).toBeNull()
  })

  it('carries a real block list from one quota store to another', async () => {
    const writer = kvQuotaStore(fileKvNamespace(folder))
    const reader = kvQuotaStore(fileKvNamespace(folder))

    await writer.replace([
      {
        environmentId: 'env_01JB0000000000000000000000',
        blockedAt: 1_762_257_600_000,
        events: 12,
        quota: 10,
      },
    ])

    expect(await reader.blocked()).toEqual([
      {
        environmentId: 'env_01JB0000000000000000000000',
        blockedAt: 1_762_257_600_000,
        events: 12,
        quota: 10,
      },
    ])
  })

  it('gives two different keys two different files, separator or not', () => {
    expect(kvFileName(QUOTA_BLOCKS_KEY)).toBe('quota%3Ablocks')
    expect(kvFileName('a/b')).not.toBe(kvFileName('a%2Fb'))
    expect(kvFileName('a/b')).not.toBe(kvFileName('ab'))
    expect(kvFileName('key:ação')).toBe('key%3Aa%C3%A7%C3%A3o')
  })

  it('leaves no half-written file behind', async () => {
    const kv = fileKvNamespace(folder)
    await kv.put(QUOTA_BLOCKS_KEY, 'x'.repeat(4096))

    const written = await readdir(folder)
    expect(written.filter((name) => name.startsWith(TEMPORARY_PREFIX))).toEqual([])
    expect(written).toEqual(['quota%3Ablocks'])
  })

  it('refuses a key it cannot name, and a format it cannot read', async () => {
    const kv = fileKvNamespace(folder)

    await expect(kv.put('', 'x')).rejects.toBeInstanceOf(UnsafeKey)
    await expect(kv.get('', 'text')).rejects.toBeInstanceOf(UnsafeKey)
    await expect(kv.get(QUOTA_BLOCKS_KEY, 'json' as 'text')).rejects.toThrow(/only reads text/)
  })
})
