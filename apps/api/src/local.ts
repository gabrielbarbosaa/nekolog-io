import { serve } from '@hono/node-server'
import { keyStoreFromDocument, type SeedDocument } from '@internal/seed'
import {
  memoryRateLimiter,
  type SqlRunner,
  sqlIssueReader,
  sqlReleaseStore,
} from '@nekolog-io/adapters'
import type { ClickHouseConfig } from '@nekolog-io/clickhouse/client'
import type { Hono } from 'hono'
import { createApiApp } from './app.ts'
import { createReadAuthenticator, createWriteAuthenticator } from './authenticate.ts'
import { openApiDocument } from './openapi.ts'
import { coreApiDeps, requestsPerMinuteFrom } from './worker.ts'

export const DEFAULT_LOCAL_PORT = 8789
export const DEFAULT_LOCAL_HOST = '127.0.0.1'

export type LocalApiConfig = {
  port: number
  host: string
  seedFile: string
  clickhouse: ClickHouseConfig
  databaseUrl: string
  requestsPerMinute: number
}

export type LocalApiEnv = {
  API_PORT?: string
  API_HOST?: string
  API_SEED_FILE?: string
  CLICKHOUSE_URL?: string
  CLICKHOUSE_DB?: string
  CLICKHOUSE_READ_USER?: string
  CLICKHOUSE_READ_PASSWORD?: string
  DATABASE_URL?: string
  API_REQUESTS_PER_MINUTE?: string
}

const REQUIRED: ReadonlyArray<keyof LocalApiEnv> = [
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_READ_USER',
  'CLICKHOUSE_READ_PASSWORD',
  'DATABASE_URL',
]

export function portFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_LOCAL_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`API_PORT must be a valid port, got ${JSON.stringify(value)}`)
  }
  return port
}

export function localApiConfigFrom(env: LocalApiEnv): LocalApiConfig {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `The public API is missing ${missing.join(', ')}. ` +
        'Copy .env.example to .env and load it with "node --env-file=.env".',
    )
  }

  return {
    port: portFrom(env.API_PORT),
    host: env.API_HOST === undefined || env.API_HOST === '' ? DEFAULT_LOCAL_HOST : env.API_HOST,
    seedFile: env.API_SEED_FILE ?? '.nekolog-seed.json',
    clickhouse: {
      url: env.CLICKHOUSE_URL as string,
      database: env.CLICKHOUSE_DB as string,
      user: env.CLICKHOUSE_READ_USER as string,
      password: env.CLICKHOUSE_READ_PASSWORD as string,
    },
    databaseUrl: env.DATABASE_URL as string,
    requestsPerMinute: requestsPerMinuteFrom(env.API_REQUESTS_PER_MINUTE),
  }
}

export type LocalApiOptions = {
  config: LocalApiConfig
  document: SeedDocument
  sql: SqlRunner
  onError?: (error: unknown) => void
}

export async function localApiApp(options: LocalApiOptions): Promise<Hono> {
  const keyStore = await keyStoreFromDocument(options.document)
  const deps = coreApiDeps(options.config.clickhouse, {
    authenticate: createReadAuthenticator({ keyStore }),
    authenticateWrite: createWriteAuthenticator({ keyStore }),
    issues: sqlIssueReader(options.sql),
    releases: sqlReleaseStore(options.sql),
    limits: {
      rateLimiter: memoryRateLimiter(),
      requestsPerWindow: options.config.requestsPerMinute,
    },
  })

  return createApiApp({
    ...deps,
    openapi: (origin) => openApiDocument([{ url: origin }]),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })
}

export type LocalApiServer = {
  url: string
  close(): Promise<void>
}

export async function startLocalApi(options: LocalApiOptions): Promise<LocalApiServer> {
  const app = await localApiApp(options)
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
