import {
  COMMIT_PATTERN as SERVER_COMMIT_PATTERN,
  MAX_VERSION_CHARS as SERVER_MAX_VERSION_CHARS,
} from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  assertApiUrl,
  assertReleaseCommit,
  assertReleaseVersion,
  assertSecretKey,
  COMMIT_PATTERN,
  createRelease,
  DEFAULT_API_URL,
  describeRelease,
  MAX_VERSION_CHARS,
  type RecordedRelease,
  ReleaseRefused,
  releaseRequest,
} from './releases.ts'

const KEY = `nekolog_sk_${'a'.repeat(32)}`
const PUBLIC = `nekolog_pk_${'b'.repeat(32)}`

const RECORDED: RecordedRelease = {
  created: true,
  release: {
    id: 'rel_0123456789ABCDEFGHJKMNPQRS',
    version: '1.4.2',
    commit: '9f3a1c7',
    environmentId: 'env_1',
    releasedAt: '2026-11-04T12:00:00.000Z',
    sourcemapCount: 0,
  },
}

function answering(status: number, body: unknown): { fetch: typeof fetch; sent: Request[] } {
  const sent: Request[] = []
  return {
    sent,
    fetch: (async (input: unknown) => {
      sent.push(input as Request)
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }) as typeof fetch,
  }
}

describe('what the cli refuses before it opens a socket', () => {
  it('refuses a public key, because it is published to every browser', () => {
    expect(() => assertSecretKey(PUBLIC)).toThrow(/public key/)
    expect(() => assertSecretKey('')).toThrow(/I need a key/)
    expect(() => assertSecretKey('hunter2')).toThrow(/does not look like a NekoLog key/)
    expect(assertSecretKey(` ${KEY} `)).toBe(KEY)
  })

  it('never puts the key in the message when it refuses one', () => {
    try {
      assertSecretKey(`${PUBLIC}-secret-tail`)
      expect.unreachable('a public key has to be refused')
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-tail')
    }
  })

  it('refuses a version that is blank, padded or too long', () => {
    expect(() => assertReleaseVersion(undefined)).toThrow(/I need a version/)
    expect(() => assertReleaseVersion(' 1.4.2')).toThrow(/whitespace/)
    expect(() => assertReleaseVersion('x'.repeat(MAX_VERSION_CHARS + 1))).toThrow(/at most/)
    expect(assertReleaseVersion('1.4.2')).toBe('1.4.2')
  })

  it('refuses a commit that is not what git prints', () => {
    for (const commit of ['9F3A1C7', '9f3a1c', 'zzzzzzz', 'a'.repeat(41)]) {
      expect(() => assertReleaseCommit(commit), commit).toThrow(/hexadecimal/)
    }
    expect(assertReleaseCommit(undefined)).toBeNull()
    expect(assertReleaseCommit('')).toBeNull()
    expect(assertReleaseCommit('a'.repeat(40))).toBe('a'.repeat(40))
  })

  it('refuses to send a secret key in the clear to anywhere but this machine', () => {
    expect(assertApiUrl(undefined).toString()).toBe(`${DEFAULT_API_URL}/`)
    expect(assertApiUrl('https://api.example.test').protocol).toBe('https:')
    expect(assertApiUrl('http://localhost:8789').host).toBe('localhost:8789')
    expect(assertApiUrl('http://127.0.0.1:8789').host).toBe('127.0.0.1:8789')

    for (const url of ['http://api.example.test', 'http://10.0.0.5:8789', 'ftp://example.test']) {
      expect(() => assertApiUrl(url), url).toThrow(/travel in the clear|is not a URL/)
    }
    expect(() => assertApiUrl('https://user:pass@api.example.test')).toThrow(/not in the URL/)
    expect(() => assertApiUrl('nope')).toThrow(/is not a URL/)
  })
})

describe('the request the cli builds', () => {
  it('puts the key in the header and the version in a json body', async () => {
    const request = releaseRequest({ key: KEY, version: '1.4.2', commit: '9f3a1c7' })

    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.nekolog.io/v1/releases')
    expect(request.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.text()).toBe('{"version":"1.4.2","commit":"9f3a1c7"}')
  })

  it('never puts the key in the url, whatever the caller passes', () => {
    const request = releaseRequest({ key: KEY, version: '1.4.2', apiUrl: 'https://api.test/base' })

    expect(request.url).not.toContain(KEY)
    expect(request.url).toBe('https://api.test/v1/releases')
  })

  it('leaves out what nobody gave it', async () => {
    const request = releaseRequest({ key: KEY, version: '1.4.2' })

    expect(await request.text()).toBe('{"version":"1.4.2"}')
  })

  it('carries the moment when one was given', async () => {
    const request = releaseRequest({
      key: KEY,
      version: '1.4.2',
      releasedAt: '2026-11-04T10:00:00.000Z',
    })

    expect(JSON.parse(await request.text())).toMatchObject({
      releasedAt: '2026-11-04T10:00:00.000Z',
    })
  })
})

describe('what the cli does with the answer', () => {
  it('returns the recorded release', async () => {
    const api = answering(201, RECORDED)
    const recorded = await createRelease({ key: KEY, version: '1.4.2', fetch: api.fetch })

    expect(recorded.created).toBe(true)
    expect(recorded.release.id).toBe(RECORDED.release.id)
    expect(api.sent).toHaveLength(1)
  })

  it('repeats the reason the server gave, with its code', async () => {
    const api = answering(403, {
      error: {
        code: 'insufficient_scope',
        message: 'This key does not carry the logs:write scope',
      },
    })

    await expect(createRelease({ key: KEY, version: '1.4.2', fetch: api.fetch })).rejects.toThrow(
      /insufficient_scope: This key does not carry/,
    )
  })

  it('says something usable when the server answers nothing it understands', async () => {
    const api = answering(502, '<html>bad gateway</html>')

    await expect(createRelease({ key: KEY, version: '1.4.2', fetch: api.fetch })).rejects.toThrow(
      /HTTP 502/,
    )
  })

  it('names the host, not the key, when the network refuses', async () => {
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof fetch

    try {
      await createRelease({ key: KEY, version: '1.4.2', fetch: failing })
      expect.unreachable('an unreachable host has to be refused')
    } catch (error) {
      expect(error).toBeInstanceOf(ReleaseRefused)
      expect((error as Error).message).toContain('api.nekolog.io')
      expect((error as Error).message).not.toContain(KEY)
    }
  })

  it('reads a second recording as a no-op rather than as a failure', () => {
    const lines = describeRelease({ ...RECORDED, created: false })

    expect(lines[0]).toContain('already recorded')
    expect(lines.join('\n')).toContain('rel_0123456789ABCDEFGHJKMNPQRS')
  })
})

describe('the limits the cli copies from the server', () => {
  it('matches what the store itself enforces, so the two cannot drift', () => {
    expect(MAX_VERSION_CHARS).toBe(SERVER_MAX_VERSION_CHARS)
    expect(COMMIT_PATTERN.source).toBe(SERVER_COMMIT_PATTERN.source)
  })
})
