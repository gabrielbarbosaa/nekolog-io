import { serve } from '@hono/node-server'
import { memoryRateLimiter } from '@internal/adapters'
import type { ClickHouseConfig } from '@internal/clickhouse/client'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import { keyStoreFromDocument, type SeedDocument } from '@internal/seed'
import type { Hono } from 'hono'
import { createIngestApp } from './app.ts'
import { createAttributeBudget } from './attributes.ts'
import { createKeyAuthenticator } from './authenticate.ts'
import { createLogStoreSink } from './sink.ts'
import { eventsPerMinuteFrom } from './worker.ts'

export const DEFAULT_LOCAL_PORT = 8787

export type LocalIngestConfig = {
  port: number
  seedFile: string
  clickhouse: ClickHouseConfig
  eventsPerMinute: number
}

export type LocalIngestEnv = {
  PORT?: string
  INGEST_SEED_FILE?: string
  CLICKHOUSE_URL?: string
  CLICKHOUSE_DB?: string
  CLICKHOUSE_INSERT_USER?: string
  CLICKHOUSE_INSERT_PASSWORD?: string
  INGEST_EVENTS_PER_MINUTE?: string
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
    seedFile: env.INGEST_SEED_FILE ?? '.nekolog-seed.json',
    clickhouse: {
      url: required(env, 'CLICKHOUSE_URL'),
      database: required(env, 'CLICKHOUSE_DB'),
      user: required(env, 'CLICKHOUSE_INSERT_USER'),
      password: required(env, 'CLICKHOUSE_INSERT_PASSWORD'),
    },
    eventsPerMinute: eventsPerMinuteFrom(env.INGEST_EVENTS_PER_MINUTE),
  }
}

export type LocalIngestOptions = {
  config: LocalIngestConfig
  document: SeedDocument
  onError?: (error: unknown) => void
}

export async function localIngestApp(options: LocalIngestOptions): Promise<Hono> {
  return createIngestApp({
    authenticate: createKeyAuthenticator({
      keyStore: await keyStoreFromDocument(options.document),
    }),
    sink: createLogStoreSink({
      logStore: clickHouseLogStore(options.config.clickhouse),
      attributeBudget: createAttributeBudget(),
    }),
    limits: {
      rateLimiter: memoryRateLimiter(),
      eventsPerWindow: options.config.eventsPerMinute,
    },
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })
}

export type LocalIngestServer = {
  url: string
  close(): Promise<void>
}

export async function startLocalIngest(options: LocalIngestOptions): Promise<LocalIngestServer> {
  const app = await localIngestApp(options)
  const server = serve({ fetch: app.fetch, port: options.config.port, hostname: '127.0.0.1' })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : options.config.port)
    })
  })

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
