import { describe, expect, it, vi } from 'vitest'
import { memoryBlobStore } from './memory-blob-store.ts'
import { R2_LIST_PAGE, type R2BucketLike, r2BlobStore } from './r2-blob-store.ts'

function text(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : new TextDecoder().decode(bytes)
}

describe('memoryBlobStore', () => {
  it('stores and reads back a string as UTF-8 bytes', async () => {
    const store = memoryBlobStore()

    await store.put('spool/a.json', '{"olá":"mundo"}')

    expect(text(await store.get('spool/a.json'))).toBe('{"olá":"mundo"}')
  })

  it('answers null for a key it does not have', async () => {
    expect(await memoryBlobStore().get('spool/missing.json')).toBeNull()
  })

  it('lists under a prefix, in text order', async () => {
    const store = memoryBlobStore({
      'spool/0000000000003-c.json': 'c',
      'spool/0000000000001-a.json': 'a',
      'quarantine/0000000000002-b.json': 'b',
    })

    expect(await store.list('spool/')).toEqual([
      'spool/0000000000001-a.json',
      'spool/0000000000003-c.json',
    ])
  })

  it('honours the limit, taking the first keys in order', async () => {
    const store = memoryBlobStore({ 'spool/c': 'c', 'spool/a': 'a', 'spool/b': 'b' })

    expect(await store.list('spool/', 2)).toEqual(['spool/a', 'spool/b'])
    expect(await store.list('spool/', 0)).toEqual([])
  })

  it('hands out a copy, so a caller cannot rewrite what is stored', async () => {
    const store = memoryBlobStore({ 'spool/a': 'hello' })

    const first = await store.get('spool/a')
    first?.fill(0)

    expect(text(await store.get('spool/a'))).toBe('hello')
  })

  it('forgets a deleted key', async () => {
    const store = memoryBlobStore({ 'spool/a': 'hello' })

    await store.delete('spool/a')

    expect(await store.get('spool/a')).toBeNull()
    expect(store.size).toBe(0)
  })
})

function fakeBucket(keys: string[] = []): R2BucketLike & { puts: unknown[]; deleted: string[] } {
  const blobs = new Map<string, string>(keys.map((key) => [key, key]))
  const puts: unknown[] = []
  const deleted: string[] = []

  return {
    puts,
    deleted,
    async put(key, body, options) {
      blobs.set(key, String(body))
      puts.push({ key, options })
      return undefined
    },
    async get(key) {
      const found = blobs.get(key)
      return found === undefined
        ? null
        : {
            arrayBuffer: async () => new TextEncoder().encode(found).buffer as ArrayBuffer,
          }
    },
    async delete(key) {
      blobs.delete(key)
      deleted.push(key)
    },
    async list({ prefix, limit, cursor }) {
      const all = [...blobs.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = cursor === undefined ? 0 : Number(cursor)
      const page = all.slice(start, start + (limit ?? R2_LIST_PAGE))
      const next = start + page.length
      return {
        objects: page.map((key) => ({ key })),
        truncated: next < all.length,
        cursor: String(next),
      }
    },
  }
}

describe('r2BlobStore', () => {
  it('passes the content type through as R2 http metadata', async () => {
    const bucket = fakeBucket()

    await r2BlobStore(bucket).put('spool/a.json', '{}', 'application/json')

    expect(bucket.puts[0]).toEqual({
      key: 'spool/a.json',
      options: { httpMetadata: { contentType: 'application/json' } },
    })
  })

  it('reads an object body as bytes, and null when there is none', async () => {
    const store = r2BlobStore(fakeBucket(['spool/a.json']))

    expect(text(await store.get('spool/a.json'))).toBe('spool/a.json')
    expect(await store.get('spool/missing.json')).toBeNull()
  })

  it('follows the cursor, because one list call stops at a page', async () => {
    const keys = Array.from(
      { length: 2_500 },
      (_, index) => `spool/${String(index).padStart(5, '0')}`,
    )
    const bucket = fakeBucket(keys)
    const list = vi.spyOn(bucket, 'list')

    const found = await r2BlobStore(bucket).list('spool/')

    expect(found).toHaveLength(2_500)
    expect(list.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops at the limit instead of walking the whole bucket', async () => {
    const keys = Array.from(
      { length: 2_500 },
      (_, index) => `spool/${String(index).padStart(5, '0')}`,
    )
    const bucket = fakeBucket(keys)
    const list = vi.spyOn(bucket, 'list')

    const found = await r2BlobStore(bucket).list('spool/', 10)

    expect(found).toEqual(keys.slice(0, 10))
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('asks for nothing when the limit is nothing', async () => {
    const bucket = fakeBucket(['spool/a'])
    const list = vi.spyOn(bucket, 'list')

    expect(await r2BlobStore(bucket).list('spool/', 0)).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('gives up on a bucket that claims more pages but returns none', async () => {
    const bucket: R2BucketLike = {
      ...fakeBucket(),
      async list() {
        return { objects: [], truncated: true, cursor: 'forever' }
      },
    }

    expect(await r2BlobStore(bucket).list('spool/')).toEqual([])
  })
})
