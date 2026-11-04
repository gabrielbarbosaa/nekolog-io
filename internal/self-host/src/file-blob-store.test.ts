import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileBlobStore, TEMPORARY_PREFIX } from './file-blob-store.ts'
import { MAX_BLOB_KEY_CHARS, UnsafeKey } from './keys.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nekolog-blobs-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const SPOOL = 'spool/1762257600999-0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.json'

describe('the file blob store, which is the self-host spool', () => {
  it('reads back exactly what it was given, bytes or text', async () => {
    const store = fileBlobStore(root)
    await store.put(SPOOL, '{"spoolVersion":1}')
    await store.put('spool/raw.json', new Uint8Array([0, 1, 254, 255]))

    expect(new TextDecoder().decode((await store.get(SPOOL)) ?? new Uint8Array())).toBe(
      '{"spoolVersion":1}',
    )
    expect([...((await store.get('spool/raw.json')) ?? [])]).toEqual([0, 1, 254, 255])
  })

  it('answers null for a key nobody wrote, instead of throwing', async () => {
    const store = fileBlobStore(root)

    expect(await store.get(SPOOL)).toBeNull()
    expect(await store.list('spool/')).toEqual([])
    await expect(store.delete(SPOOL)).resolves.toBeUndefined()
  })

  it('lists one prefix sorted, and honours the limit', async () => {
    const store = fileBlobStore(root)
    for (const key of ['spool/c.json', 'spool/a.json', 'spool/b.json', 'quarantine/a.json']) {
      await store.put(key, key)
    }

    expect(await store.list('spool/')).toEqual(['spool/a.json', 'spool/b.json', 'spool/c.json'])
    expect(await store.list('spool/', 2)).toEqual(['spool/a.json', 'spool/b.json'])
    expect(await store.list('spool/', 0)).toEqual([])
    expect(await store.list('')).toHaveLength(4)
  })

  it('leaves no half-written file behind, and never lists one', async () => {
    const store = fileBlobStore(root)
    await store.put(SPOOL, 'x'.repeat(4096))

    const written = await readdir(join(root, 'spool'))
    expect(written.filter((name) => name.startsWith(TEMPORARY_PREFIX))).toEqual([])
    expect(written).toHaveLength(1)

    await writeFile(join(root, 'spool', `${TEMPORARY_PREFIX}abc`), 'half')
    expect(await store.list('')).toEqual([SPOOL])
  })

  it('cleans the temporary file up when it cannot be moved into place', async () => {
    const store = fileBlobStore(root)
    await store.put('spool/taken/inside.json', 'x')

    await expect(store.put('spool/taken', 'x')).rejects.toBeTruthy()

    const written = await readdir(join(root, 'spool'))
    expect(written.filter((name) => name.startsWith(TEMPORARY_PREFIX))).toEqual([])
    expect(written).toEqual(['taken'])
  })

  it('forgets a key once it is deleted, and replaces one that is written again', async () => {
    const store = fileBlobStore(root)
    await store.put(SPOOL, 'first')
    await store.put(SPOOL, 'second')

    expect(new TextDecoder().decode((await store.get(SPOOL)) ?? new Uint8Array())).toBe('second')

    await store.delete(SPOOL)
    expect(await store.get(SPOOL)).toBeNull()
    expect(await store.list('spool/')).toEqual([])
  })

  it('refuses every key that could reach outside its own directory', async () => {
    const store = fileBlobStore(root)
    const refused = [
      '../escaped.json',
      'spool/../../escaped.json',
      '/etc/passwd',
      'spool//double.json',
      'spool/./here.json',
      'spool\\windows.json',
      'spool/a\u0000.json',
      '.hidden',
      `${TEMPORARY_PREFIX}abc`,
      '',
      'a'.repeat(MAX_BLOB_KEY_CHARS + 1),
    ]

    for (const key of refused) {
      await expect(store.put(key, 'x'), key).rejects.toBeInstanceOf(UnsafeKey)
      await expect(store.get(key), key).rejects.toBeInstanceOf(UnsafeKey)
      await expect(store.delete(key), key).rejects.toBeInstanceOf(UnsafeKey)
    }

    expect(await store.list('')).toEqual([])
  })
})
