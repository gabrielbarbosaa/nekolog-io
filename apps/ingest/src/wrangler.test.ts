import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertNoSecretVars,
  bindingNames,
  environmentConfig,
  environmentNames,
  type JsonObject,
  readJsonObject,
  readSecretManifest,
  renderForEnvironment,
  secretNamesFor,
} from '@internal/deploy'
import { describe, expect, it } from 'vitest'
import { assertEnv, type IngestEnv } from './worker.ts'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(APP, '..', '..')

const CONFIG = readJsonObject(join(APP, 'wrangler.json'))
const SECRETS = secretNamesFor(
  readSecretManifest(join(ROOT, 'deploy', 'workers', 'secrets.json')),
  'ingest',
)

const ENVIRONMENTS = ['dev', 'qa', 'prod']

const VALUES: Record<string, string> = {
  KV_NAMESPACE_ID: '1dc8e2b0f9a64c0e9f3a1b2c3d4e5f60',
  SPOOL_BUCKET: 'nekolog-spool',
  CLICKHOUSE_URL: 'https://clickhouse.example.invalid',
}

function blockOf(environment: string): JsonObject {
  const rendered = renderForEnvironment(CONFIG, {
    environment,
    lookup: (name) => VALUES[name],
  })
  return environmentConfig(rendered, environment)
}

function envFrom(environment: string): Partial<IngestEnv> {
  const block = blockOf(environment)
  const bindings = Object.fromEntries(bindingNames(block).map((name) => [name, {}]))
  return { ...bindings, ...(block.vars as JsonObject) } as Partial<IngestEnv>
}

function withSecrets(environment: string): Partial<IngestEnv> {
  const secrets = Object.fromEntries(SECRETS.map((name) => [name, 'supplied-at-deploy-time']))
  return { ...envFrom(environment), ...secrets } as Partial<IngestEnv>
}

describe('the environments the ingestion deploys to', () => {
  it('are the three the plan names, and only those', () => {
    expect(environmentNames(CONFIG)).toEqual(ENVIRONMENTS)
  })

  it.each(ENVIRONMENTS)('names the %s Worker after its environment', (environment) => {
    expect(blockOf(environment).name).toBe(`nekolog-ingest-${environment}`)
  })

  it.each(ENVIRONMENTS)('points %s at its own ClickHouse database', (environment) => {
    expect((blockOf(environment).vars as JsonObject).CLICKHOUSE_DB).toBe(`nekolog_${environment}`)
  })

  it.each(ENVIRONMENTS)('binds KEYS and SPOOL in %s', (environment) => {
    expect(bindingNames(blockOf(environment)).sort()).toEqual(['KEYS', 'SPOOL'])
  })
})

describe('what the Worker needs and what the configuration gives it', () => {
  it.each(ENVIRONMENTS)('satisfies the %s Worker once the secrets are in place', (environment) => {
    expect(() => assertEnv(withSecrets(environment))).not.toThrow()
  })

  it.each(ENVIRONMENTS)(
    'is not enough on its own in %s, which is why the secrets exist',
    (environment) => {
      expect(() => assertEnv(envFrom(environment))).toThrow()
    },
  )

  it.each(SECRETS.filter((name) => name.startsWith('CLICKHOUSE')))(
    'still refuses to start without %s',
    (missing) => {
      const { [missing]: _dropped, ...rest } = withSecrets('prod') as Record<string, unknown>

      expect(() => assertEnv(rest as Partial<IngestEnv>)).toThrow(missing)
    },
  )
})

describe('what the configuration must never carry', () => {
  it('keeps every secret out of the plain vars', () => {
    expect(() => assertNoSecretVars(CONFIG, SECRETS)).not.toThrow()
  })

  it('publishes no workers.dev address, in any environment', () => {
    for (const environment of ENVIRONMENTS) {
      const block = blockOf(environment)
      expect(block.workers_dev).toBe(false)
      expect(block.preview_urls).toBe(false)
    }
  })

  it('declares no route, because the zone belongs to OpenTofu', () => {
    const serialised = JSON.stringify(CONFIG)

    expect(serialised).not.toMatch(/"routes?"/)
    expect(serialised).not.toContain('custom_domain')
  })

  it('schedules nothing: the ingestion answers requests and the jobs Worker runs the crons', () => {
    expect(JSON.stringify(CONFIG)).not.toContain('crons')
  })
})
