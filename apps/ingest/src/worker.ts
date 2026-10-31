import {
  cachedBlockedEnvironments,
  cachedKeyStore,
  type KvNamespace,
  kvKeyStore,
  kvQuotaStore,
  memoryRateLimiter,
  type R2BucketLike,
  r2BlobStore,
} from '@internal/adapters'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import type { Hono } from 'hono'
import { createIngestApp } from './app.ts'
import { createAttributeBudget } from './attributes.ts'
import { createKeyAuthenticator } from './authenticate.ts'
import { createLogStoreSink, type SpooledBatch } from './sink.ts'

export const DEFAULT_EVENTS_PER_MINUTE = 2_000

export type IngestEnv = {
  KEYS: KvNamespace
  SPOOL: R2BucketLike
  CLICKHOUSE_URL: string
  CLICKHOUSE_DB: string
  CLICKHOUSE_INSERT_USER: string
  CLICKHOUSE_INSERT_PASSWORD: string
  INGEST_EVENTS_PER_MINUTE?: string
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
}

export type ExecutionContextLike = {
  waitUntil(work: Promise<unknown>): void
}

const REQUIRED: ReadonlyArray<keyof IngestEnv> = [
  'KEYS',
  'SPOOL',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_INSERT_USER',
  'CLICKHOUSE_INSERT_PASSWORD',
]

export function eventsPerMinuteFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_EVENTS_PER_MINUTE
  }
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `INGEST_EVENTS_PER_MINUTE must be a positive whole number, got ${JSON.stringify(value)}`,
    )
  }
  return limit
}

export function assertEnv(env: Partial<IngestEnv>): IngestEnv {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === null || value === ''
  })
  if (missing.length > 0) {
    throw new Error(`The ingest worker is missing bindings: ${missing.join(', ')}`)
  }
  eventsPerMinuteFrom(env.INGEST_EVENTS_PER_MINUTE)
  return env as IngestEnv
}

function reportToConsole(error: unknown): void {
  const target = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console
  try {
    target?.error?.('[nekolog/ingest]', error)
  } catch {
    return
  }
}

function reportSpooled(spooled: SpooledBatch): void {
  const target = (globalThis as { console?: { warn?: (...args: unknown[]) => void } }).console
  try {
    target?.warn?.(
      '[nekolog/ingest] spooled',
      JSON.stringify({ key: spooled.key, rows: spooled.rows }),
      spooled.reason,
    )
  } catch {
    return
  }
}

export function buildIngestApp(env: IngestEnv): Hono {
  const logStore = clickHouseLogStore({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DB,
    user: env.CLICKHOUSE_INSERT_USER,
    password: env.CLICKHOUSE_INSERT_PASSWORD,
    ...(env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
      ? {
          accessClientId: env.CF_ACCESS_CLIENT_ID,
          accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
        }
      : {}),
  })

  return createIngestApp({
    authenticate: createKeyAuthenticator({
      keyStore: cachedKeyStore(kvKeyStore(env.KEYS)),
      blocks: cachedBlockedEnvironments(kvQuotaStore(env.KEYS), { onError: reportToConsole }),
    }),
    sink: createLogStoreSink({
      logStore,
      spool: r2BlobStore(env.SPOOL),
      attributeBudget: createAttributeBudget(),
      onSpooled: reportSpooled,
    }),
    limits: {
      rateLimiter: memoryRateLimiter(),
      eventsPerWindow: eventsPerMinuteFrom(env.INGEST_EVENTS_PER_MINUTE),
    },
    onError: reportToConsole,
  })
}

let cached: Hono | undefined

export default {
  fetch(
    request: Request,
    env: Partial<IngestEnv>,
    ctx: ExecutionContextLike,
  ): Response | Promise<Response> {
    cached ??= buildIngestApp(assertEnv(env))
    return cached.fetch(request, env, ctx as Parameters<Hono['fetch']>[2])
  },
}
