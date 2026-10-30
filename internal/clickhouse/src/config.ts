import { loadEnv, migrationsEnvSchema } from '@internal/config'
import type { ClickHouseConfig } from './client.ts'

export function configFromEnv(
  source: Record<string, string | undefined> = process.env,
): ClickHouseConfig {
  const env = loadEnv('clickhouse migrations', migrationsEnvSchema, source)
  return {
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DB,
    user: env.CLICKHOUSE_MIGRATOR_USER,
    password: env.CLICKHOUSE_MIGRATOR_PASSWORD,
    accessClientId: env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
  }
}
