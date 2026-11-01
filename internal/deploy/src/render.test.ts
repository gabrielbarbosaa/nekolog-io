import { describe, expect, it } from 'vitest'
import type { JsonObject } from './config.ts'
import { placeholdersIn, renderForEnvironment } from './render.ts'

const OPEN = '${'

function slot(name: string): string {
  return `${OPEN}${name}}`
}

function configWith(): JsonObject {
  return {
    name: 'nekolog-ingest',
    main: 'src/worker.ts',
    env: {
      dev: {
        name: 'nekolog-ingest-dev',
        kv_namespaces: [{ binding: 'KEYS', id: slot('KV_NAMESPACE_ID') }],
        r2_buckets: [{ binding: 'SPOOL', bucket_name: slot('SPOOL_BUCKET') }],
        vars: { CLICKHOUSE_URL: slot('CLICKHOUSE_URL'), CLICKHOUSE_DB: 'nekolog_dev' },
      },
      prod: {
        name: 'nekolog-ingest-prod',
        kv_namespaces: [{ binding: 'KEYS', id: slot('KV_NAMESPACE_ID') }],
        vars: { ONLY_PROD: slot('PROD_ONLY_VALUE') },
      },
    },
  }
}

const DEV: Record<string, string> = {
  KV_NAMESPACE_ID: '8f2c',
  SPOOL_BUCKET: 'nekolog-spool-dev',
  CLICKHOUSE_URL: 'https://clickhouse-dev.nekolog.io',
}

function lookupFrom(values: Record<string, string>) {
  return (name: string): string | undefined => values[name]
}

describe('finding what the configuration still needs', () => {
  it('walks objects and arrays, without repeating a name', () => {
    expect(placeholdersIn(configWith())).toEqual([
      'CLICKHOUSE_URL',
      'KV_NAMESPACE_ID',
      'PROD_ONLY_VALUE',
      'SPOOL_BUCKET',
    ])
  })

  it('finds nothing in a configuration that is already complete', () => {
    expect(placeholdersIn({ vars: { CLICKHOUSE_DB: 'nekolog_dev' } })).toEqual([])
  })
})

describe('rendering one environment', () => {
  it('keeps the chosen environment and drops the others', () => {
    const rendered = renderForEnvironment(configWith(), {
      environment: 'dev',
      lookup: lookupFrom(DEV),
    })

    expect(Object.keys(rendered.env as JsonObject)).toEqual(['dev'])
  })

  it('does not ask for a value only another environment needs', () => {
    expect(() =>
      renderForEnvironment(configWith(), { environment: 'dev', lookup: lookupFrom(DEV) }),
    ).not.toThrow()
  })

  it('fills the bindings and the vars', () => {
    const rendered = renderForEnvironment(configWith(), {
      environment: 'dev',
      lookup: lookupFrom(DEV),
    })
    const dev = (rendered.env as JsonObject).dev as JsonObject

    expect(dev.kv_namespaces).toEqual([{ binding: 'KEYS', id: '8f2c' }])
    expect(dev.r2_buckets).toEqual([{ binding: 'SPOOL', bucket_name: 'nekolog-spool-dev' }])
    expect(dev.vars).toEqual({
      CLICKHOUSE_URL: 'https://clickhouse-dev.nekolog.io',
      CLICKHOUSE_DB: 'nekolog_dev',
    })
  })

  it('leaves the original configuration untouched', () => {
    const config = configWith()
    renderForEnvironment(config, { environment: 'dev', lookup: lookupFrom(DEV) })

    expect(placeholdersIn(config)).toContain('KV_NAMESPACE_ID')
    expect(Object.keys(config.env as JsonObject)).toEqual(['dev', 'prod'])
  })

  it('names every value that is missing, rather than deploying without it', () => {
    const { SPOOL_BUCKET: _dropped, ...rest } = DEV

    expect(() =>
      renderForEnvironment(configWith(), { environment: 'dev', lookup: lookupFrom(rest) }),
    ).toThrow(/SPOOL_BUCKET/)
  })

  it('counts a blank value as missing', () => {
    expect(() =>
      renderForEnvironment(configWith(), {
        environment: 'dev',
        lookup: lookupFrom({ ...DEV, KV_NAMESPACE_ID: '   ' }),
      }),
    ).toThrow(/KV_NAMESPACE_ID/)
  })

  it('refuses a value that carries a placeholder of its own', () => {
    expect(() =>
      renderForEnvironment(configWith(), {
        environment: 'dev',
        lookup: lookupFrom({ ...DEV, SPOOL_BUCKET: `nekolog-${slot('KV_NAMESPACE_ID')}` }),
      }),
    ).toThrow(/placeholder/)
  })

  it('says which environments exist when asked for one that does not', () => {
    expect(() =>
      renderForEnvironment(configWith(), { environment: 'qa', lookup: lookupFrom(DEV) }),
    ).toThrow(/dev, prod/)
  })

  it('refuses a configuration with no environments at all', () => {
    expect(() =>
      renderForEnvironment(
        { name: 'nekolog-ingest' },
        {
          environment: 'dev',
          lookup: lookupFrom(DEV),
        },
      ),
    ).toThrow(/no environments/)
  })
})
