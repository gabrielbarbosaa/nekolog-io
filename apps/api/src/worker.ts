import {
  blobSourceMapStore,
  cachedKeyStore,
  type KvNamespace,
  kvKeyStore,
  memoryRateLimiter,
  type R2BucketLike,
  r2BlobStore,
  sqlIssueReader,
  sqlReleaseStore,
} from '@nekolog-io/adapters'
import { type ClickHouseConfig, queryRows } from '@nekolog-io/clickhouse/client'
import { neon } from '@neondatabase/serverless'
import type { Hono } from 'hono'
import { type ApiDeps, createApiApp } from './app.ts'
import { createReadAuthenticator, createWriteAuthenticator } from './authenticate.ts'
import { openApiDocument } from './openapi.ts'
import { httpSqlRunner } from './sql.ts'

export const DEFAULT_REQUESTS_PER_MINUTE = 120

export type ApiEnv = {
  KEYS: KvNamespace
  SOURCEMAPS: R2BucketLike
  CLICKHOUSE_URL: string
  CLICKHOUSE_DB: string
  CLICKHOUSE_READ_USER: string
  CLICKHOUSE_READ_PASSWORD: string
  DATABASE_URL: string
  API_REQUESTS_PER_MINUTE?: string
  API_VERSION?: string
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
}

export type ExecutionContextLike = {
  waitUntil(work: Promise<unknown>): void
}

const REQUIRED: ReadonlyArray<keyof ApiEnv> = [
  'KEYS',
  'SOURCEMAPS',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_READ_USER',
  'CLICKHOUSE_READ_PASSWORD',
  'DATABASE_URL',
]

export function requestsPerMinuteFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_REQUESTS_PER_MINUTE
  }
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `API_REQUESTS_PER_MINUTE must be a positive whole number, got ${JSON.stringify(value)}`,
    )
  }
  return limit
}

export function assertEnv(env: Partial<ApiEnv>): ApiEnv {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === null || value === ''
  })
  if (missing.length > 0) {
    throw new Error(`The api worker is missing bindings: ${missing.join(', ')}`)
  }
  requestsPerMinuteFrom(env.API_REQUESTS_PER_MINUTE)
  return env as ApiEnv
}

export function clickHouseConfigFrom(env: ApiEnv): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DB,
    user: env.CLICKHOUSE_READ_USER,
    password: env.CLICKHOUSE_READ_PASSWORD,
    ...(env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
      ? {
          accessClientId: env.CF_ACCESS_CLIENT_ID,
          accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
        }
      : {}),
  }
}

function reportToConsole(error: unknown): void {
  const target = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console
  try {
    target?.error?.('[nekolog/api]', error)
  } catch {
    return
  }
}

export function coreApiDeps(
  config: ClickHouseConfig,
  extra: Omit<ApiDeps, 'query' | 'database' | 'openapi' | 'onError'>,
): ApiDeps {
  return {
    ...extra,
    database: config.database,
    query: (sql, params) =>
      queryRows<Record<string, unknown>>(config, sql, { params }) as Promise<
        Array<Record<string, unknown>>
      >,
    openapi: (origin) => openApiDocument([{ url: origin }]),
    onError: reportToConsole,
  }
}

export function buildApiApp(env: ApiEnv): Hono {
  const config = clickHouseConfigFrom(env)
  const keyStore = cachedKeyStore(kvKeyStore(env.KEYS))
  const sql = httpSqlRunner(neon(env.DATABASE_URL))

  return createApiApp(
    coreApiDeps(config, {
      authenticate: createReadAuthenticator({ keyStore }),
      authenticateWrite: createWriteAuthenticator({ keyStore }),
      issues: sqlIssueReader(sql),
      releases: sqlReleaseStore(sql),
      sourceMaps: blobSourceMapStore(r2BlobStore(env.SOURCEMAPS)),
      limits: {
        rateLimiter: memoryRateLimiter(),
        requestsPerWindow: requestsPerMinuteFrom(env.API_REQUESTS_PER_MINUTE),
      },
      ...(env.API_VERSION ? { version: env.API_VERSION } : {}),
    }),
  )
}

let cached: Hono | undefined

export default {
  fetch(
    request: Request,
    env: Partial<ApiEnv>,
    ctx: ExecutionContextLike,
  ): Response | Promise<Response> {
    cached ??= buildApiApp(assertEnv(env))
    return cached.fetch(request, env, ctx as Parameters<Hono['fetch']>[2])
  },
}
