import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_SOURCE_MAP_BYTES as SERVER_MAX_BYTES,
  SOURCE_MAP_NAME as SERVER_NAME,
} from '@nekolog-io/adapters'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReleaseRefused } from './releases.ts'
import {
  describeUpload,
  findSourceMaps,
  flatName,
  MAX_SOURCE_MAP_BYTES,
  SOURCE_MAP_NAME,
  uploadRequest,
  uploadSourceMaps,
} from './sourcemaps.ts'

const KEY = `nekolog_sk_${'a'.repeat(32)}`
const PUBLIC = `nekolog_pk_${'b'.repeat(32)}`
const MAP = JSON.stringify({ version: 3, sources: ['src/app.ts'], mappings: 'AAAA' })

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nekolog-maps-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function answering(answer: (name: string, at: number) => { status: number; body: unknown }): {
  fetch: typeof fetch
  sent: Request[]
} {
  const sent: Request[] = []
  return {
    sent,
    fetch: (async (input: unknown) => {
      const request = input as Request
      sent.push(request)
      const name = new URL(request.url).searchParams.get('name') ?? ''
      const { status, body } = answer(name, sent.length)
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch,
  }
}

const ok = (name: string, at: number) => ({
  status: 201,
  body: { sourceMap: { name, bytes: MAP.length }, release: { sourcemapCount: at } },
})

describe('finding the maps of a build', () => {
  it('walks the directory and takes only .map files', async () => {
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'app.js'), 'x')
    await writeFile(join(root, 'app.js.map'), MAP)
    await writeFile(join(root, 'assets', 'index.mjs.map'), MAP)

    expect((await findSourceMaps(root)).map((file) => flatName(root, file))).toEqual([
      'app.js.map',
      'assets-index.mjs.map',
    ])
  })

  it('skips node_modules and dotted folders, which are not your build', async () => {
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(root, '.cache'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'dep.js.map'), MAP)
    await writeFile(join(root, '.cache', 'old.js.map'), MAP)
    await writeFile(join(root, 'app.js.map'), MAP)

    expect(await findSourceMaps(root)).toHaveLength(1)
  })

  it('flattens a nested path into one name the server will accept', () => {
    expect(SOURCE_MAP_NAME.test(flatName(root, join(root, 'a', 'b', 'c.js.map')))).toBe(true)
    expect(SOURCE_MAP_NAME.test(flatName(root, join(root, 'a b', 'c+d.js.map')))).toBe(true)
    expect(flatName(root, join(root, 'a', 'b.js.map'))).toBe('a-b.js.map')
  })
})

describe('the request the cli builds for one map', () => {
  it('names the release and the file in the query, and the key in the header', async () => {
    const request = uploadRequest(
      { key: KEY, version: '1.4.2', apiUrl: 'https://api.test' },
      'app.js.map',
      new TextEncoder().encode(MAP),
    )

    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/sourcemaps')
    expect(new URL(request.url).searchParams.get('release')).toBe('1.4.2')
    expect(new URL(request.url).searchParams.get('name')).toBe('app.js.map')
    expect(request.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(request.url).not.toContain(KEY)
    expect(await request.text()).toBe(MAP)
  })

  it('encodes a version that would otherwise break the query', () => {
    const request = uploadRequest(
      { key: KEY, version: 'feature/one&two', apiUrl: 'https://api.test' },
      'app.js.map',
      new TextEncoder().encode(MAP),
    )

    expect(new URL(request.url).searchParams.get('release')).toBe('feature/one&two')
  })
})

describe('uploading a whole build', () => {
  it('sends every map it found and reports the running total', async () => {
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'app.js.map'), MAP)
    await writeFile(join(root, 'assets', 'index.mjs.map'), MAP)

    const api = answering(ok)
    const report = await uploadSourceMaps({
      key: KEY,
      version: '1.4.2',
      dir: root,
      apiUrl: 'https://api.test',
      fetch: api.fetch,
    })

    expect(api.sent).toHaveLength(2)
    expect(report.uploaded.map((one) => one.name)).toEqual(['app.js.map', 'assets-index.mjs.map'])
    expect(report.uploaded[1]?.total).toBe(2)
    expect(describeUpload(report, '1.4.2')[0]).toContain('2 source map(s)')
  })

  it('checks the key and the endpoint before it even looks at the disk', async () => {
    const missing = join(root, 'there-is-no-such-build')

    await expect(uploadSourceMaps({ key: PUBLIC, version: '1.4.2', dir: missing })).rejects.toThrow(
      /public key/,
    )

    await expect(uploadSourceMaps({ key: KEY, version: '', dir: missing })).rejects.toThrow(
      /I need a version/,
    )

    await expect(
      uploadSourceMaps({
        key: KEY,
        version: '1.4.2',
        dir: missing,
        apiUrl: 'http://api.example.test',
      }),
    ).rejects.toThrow(/travel in the clear/)
  })

  it('refuses a public key and a remote plain-HTTP endpoint before reading a file', async () => {
    await writeFile(join(root, 'app.js.map'), MAP)
    const api = answering(ok)

    await expect(
      uploadSourceMaps({ key: PUBLIC, version: '1.4.2', dir: root, fetch: api.fetch }),
    ).rejects.toThrow(/public key/)

    await expect(
      uploadSourceMaps({
        key: KEY,
        version: '1.4.2',
        dir: root,
        apiUrl: 'http://api.example.test',
        fetch: api.fetch,
      }),
    ).rejects.toThrow(/travel in the clear/)

    expect(api.sent).toHaveLength(0)
  })

  it('says so when there is nothing to upload, instead of reporting success', async () => {
    await writeFile(join(root, 'app.js'), 'x')

    await expect(
      uploadSourceMaps({ key: KEY, version: '1.4.2', dir: root, apiUrl: 'https://api.test' }),
    ).rejects.toThrow(/no \.map file/)

    await expect(
      uploadSourceMaps({
        key: KEY,
        version: '1.4.2',
        dir: join(root, 'nope'),
        apiUrl: 'https://api.test',
      }),
    ).rejects.toThrow(/not a directory/)
  })

  it('skips a map over the limit rather than sending it', async () => {
    await writeFile(join(root, 'huge.js.map'), 'x'.repeat(MAX_SOURCE_MAP_BYTES + 1))
    await writeFile(join(root, 'app.js.map'), MAP)

    const api = answering(ok)
    const report = await uploadSourceMaps({
      key: KEY,
      version: '1.4.2',
      dir: root,
      apiUrl: 'https://api.test',
      fetch: api.fetch,
    })

    expect(api.sent).toHaveLength(1)
    expect(report.uploaded.map((one) => one.name)).toEqual(['app.js.map'])
    expect(report.skipped[0]).toContain('huge.js.map')
  })

  it('stops at the first refusal and names the file, never the key', async () => {
    await writeFile(join(root, 'a.js.map'), MAP)
    await writeFile(join(root, 'b.js.map'), MAP)

    const api = answering((name) =>
      name === 'a.js.map'
        ? { status: 403, body: { error: { code: 'insufficient_scope', message: 'nope' } } }
        : ok(name, 1),
    )

    try {
      await uploadSourceMaps({
        key: KEY,
        version: '1.4.2',
        dir: root,
        apiUrl: 'https://api.test',
        fetch: api.fetch,
      })
      expect.unreachable('a refusal has to stop the upload')
    } catch (error) {
      expect(error).toBeInstanceOf(ReleaseRefused)
      expect((error as Error).message).toContain('a.js.map')
      expect((error as Error).message).toContain('insufficient_scope')
      expect((error as Error).message).not.toContain(KEY)
    }

    expect(api.sent).toHaveLength(1)
  })
})

describe('the limits the cli copies from the server', () => {
  it('matches what the store itself enforces, so the two cannot drift', () => {
    expect(MAX_SOURCE_MAP_BYTES).toBe(SERVER_MAX_BYTES)
    expect(SOURCE_MAP_NAME.source).toBe(SERVER_NAME.source)
  })
})
