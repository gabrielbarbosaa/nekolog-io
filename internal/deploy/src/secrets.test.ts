import { describe, expect, it } from 'vitest'
import type { JsonObject } from './config.ts'
import {
  assertNoSecretVars,
  parseSecretManifest,
  secretNamesFor,
  secretValues,
  varsIn,
} from './secrets.ts'

const MANIFEST = { ingest: ['CLICKHOUSE_INSERT_PASSWORD', 'CF_ACCESS_CLIENT_ID'] }

describe('the manifest of what has to be a secret', () => {
  it('reads a list per app', () => {
    expect(secretNamesFor(parseSecretManifest(MANIFEST, 'test'), 'ingest')).toEqual([
      'CLICKHOUSE_INSERT_PASSWORD',
      'CF_ACCESS_CLIENT_ID',
    ])
  })

  it('refuses an app with no secrets, because that is never what was meant', () => {
    expect(() => parseSecretManifest({ ingest: [] }, 'test')).toThrow(/at least one/)
  })

  it('refuses a name that is not a name', () => {
    expect(() => parseSecretManifest({ ingest: ['clickhouse password'] }, 'test')).toThrow(
      /not a name/,
    )
  })

  it('refuses the same secret listed twice', () => {
    expect(() => parseSecretManifest({ ingest: ['A_SECRET', 'A_SECRET'] }, 'test')).toThrow(/twice/)
  })

  it('says which apps it knows when asked for one it does not', () => {
    expect(() => secretNamesFor(parseSecretManifest(MANIFEST, 'test'), 'web')).toThrow(/ingest/)
  })
})

describe('collecting the values', () => {
  const names = ['CLICKHOUSE_INSERT_PASSWORD', 'CF_ACCESS_CLIENT_ID']

  it('takes only what the app declared', () => {
    const values = secretValues(names, (name) => ({ ...filled(), SOMETHING_ELSE: 'no' })[name])

    expect(Object.keys(values)).toEqual(names)
  })

  it('names what is missing', () => {
    expect(() => secretValues(names, (name) => (name === names[0] ? 'ok' : undefined))).toThrow(
      /CF_ACCESS_CLIENT_ID/,
    )
  })

  it('counts a blank secret as missing, because an empty one deploys a broken Worker', () => {
    expect(() => secretValues(names, (name) => (name === names[0] ? '' : 'ok'))).toThrow(
      /CLICKHOUSE_INSERT_PASSWORD/,
    )
  })

  it('never puts a value in the message', () => {
    const value = 'a-very-secret-password'
    try {
      secretValues(names, (name) => (name === names[0] ? value : undefined))
      expect.unreachable('it should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain(value)
    }
  })

  function filled(): Record<string, string> {
    return { CLICKHOUSE_INSERT_PASSWORD: 'one', CF_ACCESS_CLIENT_ID: 'two' }
  }
})

describe('keeping secrets out of the configuration', () => {
  function configWith(vars: JsonObject): JsonObject {
    return { env: { dev: { vars }, prod: { vars: { CLICKHOUSE_DB: 'nekolog_prod' } } } }
  }

  it('collects the vars of every environment', () => {
    expect(varsIn(configWith({ CLICKHOUSE_DB: 'nekolog_dev' })).map(([name]) => name)).toEqual([
      'CLICKHOUSE_DB',
      'CLICKHOUSE_DB',
    ])
  })

  it('accepts a configuration that only carries plain values', () => {
    expect(() =>
      assertNoSecretVars(configWith({ CLICKHOUSE_DB: 'nekolog_dev' }), [
        'CLICKHOUSE_INSERT_PASSWORD',
      ]),
    ).not.toThrow()
  })

  it('refuses a var the manifest says has to be a secret', () => {
    expect(() =>
      assertNoSecretVars(configWith({ CLICKHOUSE_INSERT_USER: 'nekolog_ingest_dev' }), [
        'CLICKHOUSE_INSERT_USER',
      ]),
    ).toThrow(/CLICKHOUSE_INSERT_USER/)
  })

  it('refuses a var that merely reads like a secret, even if nobody listed it', () => {
    expect(() => assertNoSecretVars(configWith({ SOME_NEW_PASSWORD: 'hunter2' }), [])).toThrow(
      /reads like a secret/,
    )
  })

  it('refuses a value that looks like a NekoLog key', () => {
    expect(() => assertNoSecretVars(configWith({ SELF_KEY: 'nekolog_sk_abcdef' }), [])).toThrow(
      /API key/,
    )
  })
})
