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
import { type ApiEnv, assertEnv } from './worker.ts'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(APP, '..', '..')

const CONFIG = readJsonObject(join(APP, 'wrangler.json'))
const SECRETS = secretNamesFor(
  readSecretManifest(join(ROOT, 'deploy', 'workers', 'secrets.json')),
  'api',
)

const ENVIRONMENTS = ['dev', 'qa', 'prod']

const VALUES: Record<string, string> = {
  KV_NAMESPACE_ID: '1dc8e2b0f9a64c0e9f3a1b2c3d4e5f60',
  CLICKHOUSE_URL: 'https://clickhouse.example.invalid',
}

function blockOf(environment: string): JsonObject {
  const rendered = renderForEnvironment(CONFIG, {
    environment,
    lookup: (name) => VALUES[name],
  })
  return environmentConfig(rendered, environment)
}

function envFrom(environment: string): Partial<ApiEnv> {
  const block = blockOf(environment)
  const bindings = Object.fromEntries(bindingNames(block).map((name) => [name, {}]))
  return { ...bindings, ...(block.vars as JsonObject) } as Partial<ApiEnv>
}

function withSecrets(environment: string): Partial<ApiEnv> {
  const secrets = Object.fromEntries(SECRETS.map((name) => [name, 'supplied-at-deploy-time']))
  return { ...envFrom(environment), ...secrets } as Partial<ApiEnv>
}

describe('the environments the public API deploys to', () => {
  it('are the three the plan names, and only those', () => {
    expect(environmentNames(CONFIG)).toEqual(ENVIRONMENTS)
  })

  it.each(ENVIRONMENTS)('names the %s Worker after its environment', (environment) => {
    expect(blockOf(environment).name).toBe(`nekolog-api-${environment}`)
  })

  it.each(ENVIRONMENTS)('points %s at its own ClickHouse database', (environment) => {
    expect((blockOf(environment).vars as JsonObject).CLICKHOUSE_DB).toBe(`nekolog_${environment}`)
  })

  it.each(ENVIRONMENTS)('binds KEYS in %s, and nothing it does not read', (environment) => {
    expect(bindingNames(blockOf(environment))).toEqual(['KEYS'])
  })

  it.each(ENVIRONMENTS)('writes nowhere: %s has no R2 bucket at all', (environment) => {
    expect(blockOf(environment).r2_buckets).toBeUndefined()
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

  it.each(['CLICKHOUSE_READ_USER', 'CLICKHOUSE_READ_PASSWORD', 'DATABASE_URL'])(
    'still refuses to start without %s',
    (missing) => {
      const { [missing]: _dropped, ...rest } = withSecrets('prod') as Record<string, unknown>

      expect(() => assertEnv(rest as Partial<ApiEnv>)).toThrow(missing)
    },
  )

  it('needs node compatibility, because the Postgres driver reaches for it', () => {
    for (const environment of ENVIRONMENTS) {
      expect(blockOf(environment).compatibility_flags).toContain('nodejs_compat')
    }
  })
})

describe('what the configuration must never carry', () => {
  it('keeps every secret out of the plain vars, the connection string most of all', () => {
    expect(() => assertNoSecretVars(CONFIG, SECRETS)).not.toThrow()
    expect(JSON.stringify(CONFIG)).not.toContain('DATABASE_URL')
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

  it('schedules nothing: this Worker only answers requests', () => {
    expect(JSON.stringify(CONFIG)).not.toContain('crons')
  })
})
