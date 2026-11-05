import { serve } from '@hono/node-server'
import { keyStoreFromDocument, type SeedDocument } from '@internal/seed'
import type { BlobStore, BlockedEnvironments, KeyStore } from '@nekolog-io/adapters'
import { memoryRateLimiter } from '@nekolog-io/adapters'
import type { ClickHouseConfig } from '@nekolog-io/clickhouse/client'
import { clickHouseLogStore } from '@nekolog-io/clickhouse/log-store'
import type { Hono } from 'hono'
import { createIngestApp } from './app.ts'
import { createAttributeBudget } from './attributes.ts'
import { createKeyAuthenticator } from './authenticate.ts'
import { eventsPerMinuteFrom } from './rate.ts'
import { createLogStoreSink, type SpooledBatch } from './sink.ts'

export const DEFAULT_LOCAL_PORT = 8787
export const DEFAULT_LOCAL_HOST = '127.0.0.1'

export type LocalIngestConfig = {
  port: number
  host: string
  seedFile: string
  clickhouse: ClickHouseConfig
  eventsPerMinute: number
  version?: string
}

export type LocalIngestEnv = {
  PORT?: string
  INGEST_HOST?: string
  INGEST_SEED_FILE?: string
  CLICKHOUSE_URL?: string
  CLICKHOUSE_DB?: string
  CLICKHOUSE_INSERT_USER?: string
  CLICKHOUSE_INSERT_PASSWORD?: string
  INGEST_EVENTS_PER_MINUTE?: string
  INGEST_VERSION?: string
}

function required(env: LocalIngestEnv, name: keyof LocalIngestEnv): string {
  const value = env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `A ingestão local precisa de ${name}. Copie .env.example para .env e carregue com "node --env-file=.env".`,
    )
  }
  return value
}

export function portFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_LOCAL_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT precisa ser uma porta válida, veio ${JSON.stringify(value)}`)
  }
  return port
}

export function localIngestConfigFrom(env: LocalIngestEnv): LocalIngestConfig {
  return {
    port: portFrom(env.PORT),
    host:
      env.INGEST_HOST === undefined || env.INGEST_HOST === ''
        ? DEFAULT_LOCAL_HOST
        : env.INGEST_HOST,
    seedFile: env.INGEST_SEED_FILE ?? '.nekolog-seed.json',
    clickhouse: {
      url: required(env, 'CLICKHOUSE_URL'),
      database: required(env, 'CLICKHOUSE_DB'),
      user: required(env, 'CLICKHOUSE_INSERT_USER'),
      password: required(env, 'CLICKHOUSE_INSERT_PASSWORD'),
    },
    eventsPerMinute: eventsPerMinuteFrom(env.INGEST_EVENTS_PER_MINUTE),
    ...(env.INGEST_VERSION ? { version: env.INGEST_VERSION } : {}),
  }
}

export type LocalIngestOptions = {
  config: LocalIngestConfig
  document: SeedDocument
  keyStore?: KeyStore
  onError?: (error: unknown) => void
  spool?: BlobStore
  blocks?: BlockedEnvironments
  onSpooled?: (spooled: SpooledBatch) => void
}

export async function localIngestApp(options: LocalIngestOptions): Promise<Hono> {
  return createIngestApp({
    authenticate: createKeyAuthenticator({
      keyStore: options.keyStore ?? (await keyStoreFromDocument(options.document)),
      ...(options.blocks === undefined ? {} : { blocks: options.blocks }),
    }),
    sink: createLogStoreSink({
      logStore: clickHouseLogStore(options.config.clickhouse),
      attributeBudget: createAttributeBudget(),
      ...(options.spool === undefined ? {} : { spool: options.spool }),
      ...(options.onSpooled === undefined ? {} : { onSpooled: options.onSpooled }),
    }),
    limits: {
      rateLimiter: memoryRateLimiter(),
      eventsPerWindow: options.config.eventsPerMinute,
    },
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.config.version === undefined ? {} : { version: options.config.version }),
  })
}

export type LocalIngestServer = {
  url: string
  close(): Promise<void>
}

export async function startLocalIngest(options: LocalIngestOptions): Promise<LocalIngestServer> {
  const app = await localIngestApp(options)
  const server = serve({
    fetch: app.fetch,
    port: options.config.port,
    hostname: options.config.host,
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : options.config.port)
    })
  })

  const host =
    options.config.host === '0.0.0.0' || options.config.host === '::'
      ? DEFAULT_LOCAL_HOST
      : options.config.host

  return {
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
