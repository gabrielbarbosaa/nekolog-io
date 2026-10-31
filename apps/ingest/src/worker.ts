import { cachedKeyStore, type KvNamespace, kvKeyStore } from '@internal/adapters'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import type { Hono } from 'hono'
import { createIngestApp } from './app.ts'
import { createKeyAuthenticator } from './authenticate.ts'
import { createLogStoreSink } from './sink.ts'

export type IngestEnv = {
  KEYS: KvNamespace
  CLICKHOUSE_URL: string
  CLICKHOUSE_DB: string
  CLICKHOUSE_INSERT_USER: string
  CLICKHOUSE_INSERT_PASSWORD: string
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
}

export type ExecutionContextLike = {
  waitUntil(work: Promise<unknown>): void
}

const REQUIRED: ReadonlyArray<keyof IngestEnv> = [
  'KEYS',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_INSERT_USER',
  'CLICKHOUSE_INSERT_PASSWORD',
]

export function assertEnv(env: Partial<IngestEnv>): IngestEnv {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === null || value === ''
  })
  if (missing.length > 0) {
    throw new Error(`The ingest worker is missing bindings: ${missing.join(', ')}`)
  }
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
    authenticate: createKeyAuthenticator({ keyStore: cachedKeyStore(kvKeyStore(env.KEYS)) }),
    sink: createLogStoreSink({ logStore }),
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
