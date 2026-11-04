import { ReleaseRefused } from '@nekolog-io/cli'
import { describe, expect, it } from 'vitest'
import {
  API_VARIABLE,
  COMMIT_VARIABLES,
  commitFrom,
  DISABLED_REASON,
  type Environment,
  KEY_VARIABLE,
  type NekologPluginOptions,
  NO_KEY_REASON,
  RELEASE_VARIABLE,
  resolveOptions,
} from './options.ts'

const KEY = `nekolog_sk_${'a'.repeat(32)}`
const PUBLIC_KEY = `nekolog_pk_${'a'.repeat(32)}`
const SHA = '9f3a1c7d2b4e6f8a0c1e3d5b7a9c1e3d5b7a9c1e'

function env(over: Environment = {}): Environment {
  return { ...over }
}

function resolve(options: NekologPluginOptions = {}, over: Environment = {}) {
  return resolveOptions(options, env(over))
}

describe('when the plugin decides to do nothing', () => {
  it('stands down when it is turned off, even with everything else in place', () => {
    const resolution = resolve({ disable: true, key: KEY, release: '1.4.2' })

    expect(resolution.run).toBe(false)
    expect(resolution.run === false && resolution.reason).toMatch(/disable/)
  })

  it('stands down when there is no key, which is what a local build looks like', () => {
    expect(resolve().run).toBe(false)
    expect(resolve({ release: '1.4.2' }).run).toBe(false)
    expect(resolve({ key: '   ' }).run).toBe(false)

    const resolution = resolve()
    expect(resolution.run === false && resolution.reason).toContain(KEY_VARIABLE)
  })

  it('never puts the key in the line it prints', () => {
    const disabled = resolve({ disable: true, key: KEY })
    const keyless = resolve({}, { [KEY_VARIABLE]: '   ' })

    for (const resolution of [disabled, keyless]) {
      const reason = resolution.run === false ? resolution.reason : ''
      expect(reason).not.toContain(KEY)
      expect(reason).not.toContain('nekolog_sk_')
    }
    expect(disabled.run === false && disabled.reason).toBe(DISABLED_REASON)
    expect(keyless.run === false && keyless.reason).toBe(NO_KEY_REASON)
  })
})

describe('the variable names, which the guides print', () => {
  it('are the ones the documentation tells people to set', () => {
    expect(KEY_VARIABLE).toBe('NEKOLOG_KEY')
    expect(RELEASE_VARIABLE).toBe('NEKOLOG_RELEASE')
    expect(API_VARIABLE).toBe('NEKOLOG_API_URL')
    expect(COMMIT_VARIABLES).toEqual([
      'NEKOLOG_COMMIT',
      'GITHUB_SHA',
      'VERCEL_GIT_COMMIT_SHA',
      'CI_COMMIT_SHA',
    ])
  })
})

describe('once it has a key, a mistake is a refusal and not a shrug', () => {
  it('refuses a public key, which ships in every browser bundle', () => {
    expect(() => resolve({ key: PUBLIC_KEY, release: '1.4.2' })).toThrow(ReleaseRefused)
    expect(() => resolve({}, { [KEY_VARIABLE]: PUBLIC_KEY, [RELEASE_VARIABLE]: '1.4.2' })).toThrow(
      /public key/,
    )
  })

  it('refuses something that is not a NekoLog key at all', () => {
    expect(() => resolve({ key: 'sk_live_whatever', release: '1.4.2' })).toThrow(ReleaseRefused)
  })

  it('refuses a key with no release, instead of uploading maps nothing can find', () => {
    expect(() => resolve({ key: KEY })).toThrow(ReleaseRefused)
    expect(() => resolve({ key: KEY })).toThrow(new RegExp(RELEASE_VARIABLE))
  })

  it('refuses a release the API would refuse, before the build ends', () => {
    expect(() => resolve({ key: KEY, release: 'x'.repeat(201) })).toThrow(ReleaseRefused)
    expect(() => resolve({ key: KEY, release: '   ' })).toThrow(new RegExp(RELEASE_VARIABLE))
  })

  it('refuses to send a secret key in the clear', () => {
    expect(() =>
      resolve({ key: KEY, release: '1.4.2', apiUrl: 'http://logs.example.com' }),
    ).toThrow(ReleaseRefused)
    expect(() =>
      resolve({ key: KEY, release: '1.4.2', apiUrl: 'http://localhost:8789' }),
    ).not.toThrow()
    expect(() =>
      resolve({ key: KEY, release: '1.4.2', apiUrl: 'https://api.example.com' }),
    ).not.toThrow()
  })
})

describe('what it reads, and from where', () => {
  it('takes the key, the release and the API from the environment', () => {
    const resolution = resolve(
      {},
      {
        [KEY_VARIABLE]: KEY,
        [RELEASE_VARIABLE]: '1.4.2',
        [API_VARIABLE]: 'https://api.example.com',
      },
    )

    expect(resolution).toMatchObject({
      run: true,
      upload: { key: KEY, release: '1.4.2', apiUrl: 'https://api.example.com' },
    })
  })

  it('lets what was written in the config win over the environment, for all three', () => {
    const other = `nekolog_sk_${'b'.repeat(32)}`
    const resolution = resolve(
      { key: other, release: '2.0.0', apiUrl: 'https://mine.example.com' },
      {
        [KEY_VARIABLE]: KEY,
        [RELEASE_VARIABLE]: '1.4.2',
        [API_VARIABLE]: 'https://theirs.example.com',
      },
    )

    expect(resolution.run === true && resolution.upload).toMatchObject({
      key: other,
      release: '2.0.0',
      apiUrl: 'https://mine.example.com',
    })
  })

  it('trims what it was given, because a shell writes trailing newlines', () => {
    const resolution = resolve({ key: `${KEY}\n`, release: ' 1.4.2 ' })

    expect(resolution.run === true && resolution.upload).toMatchObject({
      key: KEY,
      release: '1.4.2',
    })
  })

  it('leaves the API unset when nobody set one, so the default stays one place', () => {
    const resolution = resolve({ key: KEY, release: '1.4.2' })

    expect(resolution.run === true && resolution.upload.apiUrl).toBeUndefined()
  })

  it('defaults to keeping the maps and to speaking up', () => {
    const resolution = resolve({ key: KEY, release: '1.4.2' })

    expect(resolution.run === true && resolution.upload).toMatchObject({
      deleteAfterUpload: false,
      silent: false,
    })
  })
})

describe('the commit, which the CI usually already knows', () => {
  it('refuses a commit somebody typed wrong', () => {
    expect(() => commitFrom({ commit: '9F3A1C7' }, env())).toThrow(ReleaseRefused)
    expect(() => commitFrom({ commit: 'nope' }, env())).toThrow(ReleaseRefused)
  })

  it('takes a commit somebody typed right', () => {
    expect(commitFrom({ commit: SHA }, env())).toBe(SHA)
    expect(commitFrom({ commit: '9f3a1c7' }, env())).toBe('9f3a1c7')
  })

  it('reads the usual CI variables when nobody passed one', () => {
    expect(commitFrom({}, env({ GITHUB_SHA: SHA }))).toBe(SHA)
    expect(commitFrom({}, env({ VERCEL_GIT_COMMIT_SHA: SHA }))).toBe(SHA)
    expect(commitFrom({}, env({ CI_COMMIT_SHA: SHA }))).toBe(SHA)
    expect(commitFrom({}, env({ NEKOLOG_COMMIT: SHA, GITHUB_SHA: 'a'.repeat(40) }))).toBe(SHA)
  })

  it('ignores a CI variable that is not a commit instead of failing the build', () => {
    expect(commitFrom({}, env({ GITHUB_SHA: 'refs/heads/main' }))).toBeNull()
    expect(commitFrom({}, env({ GITHUB_SHA: '' }))).toBeNull()
    expect(commitFrom({}, env({ GITHUB_SHA: 'HEAD', CI_COMMIT_SHA: SHA }))).toBe(SHA)
  })

  it('takes an empty commit option as no commit, not as a bad one', () => {
    expect(commitFrom({ commit: '' }, env({ GITHUB_SHA: SHA }))).toBeNull()
  })

  it('carries the commit through the resolution', () => {
    const resolution = resolve({ key: KEY, release: '1.4.2' }, { GITHUB_SHA: SHA })

    expect(resolution.run === true && resolution.upload.commit).toBe(SHA)
  })
})
