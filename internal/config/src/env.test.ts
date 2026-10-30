import { describe, expect, it } from 'vitest'
import {
  EnvValidationError,
  ingestEnvSchema,
  jobsEnvSchema,
  loadEnv,
  migrationsEnvSchema,
  webEnvSchema,
} from './env.ts'

const validWebEnv = {
  APP_ENV: 'dev',
  APP_URL: 'https://dev.nekolog.io',
  DATABASE_URL: 'postgres://user:pass@host/db',
  UPSTASH_REDIS_REST_URL: 'https://redis.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  CLICKHOUSE_URL: 'https://ch.nekolog.io',
  CLICKHOUSE_DB: 'nekolog_dev',
  CLICKHOUSE_READ_USER: 'reader',
  CLICKHOUSE_READ_PASSWORD: 'secret',
  CF_ACCESS_CLIENT_ID: 'id',
  CF_ACCESS_CLIENT_SECRET: 'secret',
  CF_ACCOUNT_ID: 'account',
  CF_KV_NAMESPACE_ID: 'ns',
  CF_KV_API_TOKEN: 'token',
  R2_ENDPOINT: 'https://r2.example.com',
  R2_BUCKET: 'bucket',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  AUTH_JWT_PRIVATE_KEY: 'key',
  AUTH_JWT_PUBLIC_KEY: 'key',
  AUTH_JWT_KID: 'kid',
  AUTH_OTP_SECRET: 'secret',
  ENCRYPTION_KEY: 'key',
  RESEND_API_KEY: 'key',
  EMAIL_FROM: 'no-reply@nekolog.io',
  TURNSTILE_SITE_KEY: 'key',
  TURNSTILE_SECRET_KEY: 'secret',
  NEKOLOG_SELF_KEY: 'key',
}

describe('webEnvSchema', () => {
  it('accepts a fully valid cloud configuration', () => {
    expect(() => loadEnv('web', webEnvSchema, validWebEnv)).not.toThrow()
  })

  it('accepts a self-host configuration (REDIS_URL + SMTP_URL)', () => {
    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, RESEND_API_KEY, ...rest } =
      validWebEnv
    expect(() =>
      loadEnv('web', webEnvSchema, {
        ...rest,
        REDIS_URL: 'redis://localhost:6379',
        SMTP_URL: 'smtp://localhost:1025',
      }),
    ).not.toThrow()
  })

  it('rejects a missing required variable', () => {
    const { DATABASE_URL, ...rest } = validWebEnv
    expect(() => loadEnv('web', webEnvSchema, rest)).toThrow(EnvValidationError)
  })

  it('rejects an invalid URL', () => {
    expect(() => loadEnv('web', webEnvSchema, { ...validWebEnv, APP_URL: 'not-a-url' })).toThrow(
      EnvValidationError,
    )
  })

  it('rejects setting both cloud and self-host Redis', () => {
    expect(() =>
      loadEnv('web', webEnvSchema, { ...validWebEnv, REDIS_URL: 'redis://localhost:6379' }),
    ).toThrow(EnvValidationError)
  })

  it('rejects setting neither cloud nor self-host mailer', () => {
    const { RESEND_API_KEY, ...rest } = validWebEnv
    expect(() => loadEnv('web', webEnvSchema, rest)).toThrow(EnvValidationError)
  })
})

describe('ingestEnvSchema', () => {
  it('accepts a valid configuration', () => {
    expect(() =>
      loadEnv('ingest', ingestEnvSchema, {
        CLICKHOUSE_URL: 'https://ch.nekolog.io',
        CLICKHOUSE_DB: 'nekolog_dev',
        CLICKHOUSE_INSERT_USER: 'writer',
        CLICKHOUSE_INSERT_PASSWORD: 'secret',
        CF_ACCESS_CLIENT_ID: 'id',
        CF_ACCESS_CLIENT_SECRET: 'secret',
      }),
    ).not.toThrow()
  })

  it('rejects a missing required variable', () => {
    expect(() => loadEnv('ingest', ingestEnvSchema, {})).toThrow(EnvValidationError)
  })
})

describe('jobsEnvSchema', () => {
  const validJobsEnv = {
    DATABASE_URL: 'postgres://user:pass@host/db',
    CLICKHOUSE_JOBS_USER: 'jobs',
    CLICKHOUSE_JOBS_PASSWORD: 'secret',
    CF_ACCESS_CLIENT_ID: 'id',
    CF_ACCESS_CLIENT_SECRET: 'secret',
    RESEND_API_KEY: 'key',
    EMAIL_FROM: 'no-reply@nekolog.io',
    BETTERSTACK_HEARTBEAT_URL: 'https://betterstack.example.com/heartbeat',
    OPS_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x',
  }

  it('accepts a valid configuration', () => {
    expect(() => loadEnv('jobs', jobsEnvSchema, validJobsEnv)).not.toThrow()
  })

  it('rejects setting both cloud and self-host mailer', () => {
    expect(() =>
      loadEnv('jobs', jobsEnvSchema, { ...validJobsEnv, SMTP_URL: 'smtp://localhost:1025' }),
    ).toThrow(EnvValidationError)
  })
})

describe('migrationsEnvSchema', () => {
  const validMigrationsEnv = {
    CLICKHOUSE_URL: 'https://ch.nekolog.io',
    CLICKHOUSE_DB: 'nekolog_dev',
    CLICKHOUSE_MIGRATOR_USER: 'migrator',
    CLICKHOUSE_MIGRATOR_PASSWORD: 'secret',
  }

  it('accepts a configuration without Cloudflare Access', () => {
    expect(() => loadEnv('migrations', migrationsEnvSchema, validMigrationsEnv)).not.toThrow()
  })

  it('rejects a missing migrator credential', () => {
    const { CLICKHOUSE_MIGRATOR_PASSWORD, ...rest } = validMigrationsEnv
    expect(() => loadEnv('migrations', migrationsEnvSchema, rest)).toThrow(EnvValidationError)
  })
})

describe('loadEnv', () => {
  it('treats a variable set to an empty string as unset', () => {
    const parsed = loadEnv('web', webEnvSchema, { ...validWebEnv, EMAIL_ALLOWLIST: '' })

    expect(parsed.EMAIL_ALLOWLIST).toBeUndefined()
  })

  it('treats a variable set to whitespace as unset', () => {
    expect(() =>
      loadEnv('web', webEnvSchema, { ...validWebEnv, UPSTASH_REDIS_REST_URL: '   ' }),
    ).toThrow(EnvValidationError)
  })

  it('still rejects a required variable left empty', () => {
    expect(() => loadEnv('web', webEnvSchema, { ...validWebEnv, DATABASE_URL: '' })).toThrow(
      EnvValidationError,
    )
  })
})
