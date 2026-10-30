import * as v from 'valibot'

const appEnv = v.picklist(['dev', 'qa', 'prod'])
const nonEmptyString = v.pipe(v.string(), v.minLength(1))
const urlString = v.pipe(v.string(), v.url())

const hasCloudRedis = (env: {
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
}) => env.UPSTASH_REDIS_REST_URL !== undefined && env.UPSTASH_REDIS_REST_TOKEN !== undefined

const hasSelfHostRedis = (env: { REDIS_URL?: string }) => env.REDIS_URL !== undefined

const hasCloudMailer = (env: { RESEND_API_KEY?: string }) => env.RESEND_API_KEY !== undefined
const hasSelfHostMailer = (env: { SMTP_URL?: string }) => env.SMTP_URL !== undefined

export const webEnvSchema = v.pipe(
  v.object({
    APP_ENV: appEnv,
    APP_URL: urlString,

    DATABASE_URL: nonEmptyString,

    UPSTASH_REDIS_REST_URL: v.optional(urlString),
    UPSTASH_REDIS_REST_TOKEN: v.optional(nonEmptyString),
    REDIS_URL: v.optional(nonEmptyString),

    CLICKHOUSE_URL: urlString,
    CLICKHOUSE_DB: nonEmptyString,
    CLICKHOUSE_READ_USER: nonEmptyString,
    CLICKHOUSE_READ_PASSWORD: nonEmptyString,

    CF_ACCESS_CLIENT_ID: nonEmptyString,
    CF_ACCESS_CLIENT_SECRET: nonEmptyString,
    CF_ACCOUNT_ID: nonEmptyString,
    CF_KV_NAMESPACE_ID: nonEmptyString,
    CF_KV_API_TOKEN: nonEmptyString,

    R2_ENDPOINT: urlString,
    R2_BUCKET: nonEmptyString,
    R2_ACCESS_KEY_ID: nonEmptyString,
    R2_SECRET_ACCESS_KEY: nonEmptyString,

    AUTH_JWT_PRIVATE_KEY: nonEmptyString,
    AUTH_JWT_PUBLIC_KEY: nonEmptyString,
    AUTH_JWT_KID: nonEmptyString,
    AUTH_JWT_PREVIOUS_PUBLIC_KEY: v.optional(nonEmptyString),
    AUTH_OTP_SECRET: nonEmptyString,
    ENCRYPTION_KEY: nonEmptyString,

    RESEND_API_KEY: v.optional(nonEmptyString),
    SMTP_URL: v.optional(nonEmptyString),
    EMAIL_FROM: nonEmptyString,
    EMAIL_ALLOWLIST: v.optional(nonEmptyString),

    TURNSTILE_SITE_KEY: nonEmptyString,
    TURNSTILE_SECRET_KEY: nonEmptyString,

    NEKOLOG_SELF_KEY: nonEmptyString,
  }),
  v.check(
    (env) => hasCloudRedis(env) !== hasSelfHostRedis(env),
    'Set either UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (cloud) or REDIS_URL (self-host), not both or neither.',
  ),
  v.check(
    (env) => hasCloudMailer(env) !== hasSelfHostMailer(env),
    'Set either RESEND_API_KEY (cloud) or SMTP_URL (self-host), not both or neither.',
  ),
)

export type WebEnv = v.InferOutput<typeof webEnvSchema>

export const ingestEnvSchema = v.object({
  CLICKHOUSE_URL: urlString,
  CLICKHOUSE_DB: nonEmptyString,
  CLICKHOUSE_INSERT_USER: nonEmptyString,
  CLICKHOUSE_INSERT_PASSWORD: nonEmptyString,
  CF_ACCESS_CLIENT_ID: nonEmptyString,
  CF_ACCESS_CLIENT_SECRET: nonEmptyString,
})

export type IngestEnv = v.InferOutput<typeof ingestEnvSchema>

export const jobsEnvSchema = v.pipe(
  v.object({
    DATABASE_URL: nonEmptyString,
    CLICKHOUSE_JOBS_USER: nonEmptyString,
    CLICKHOUSE_JOBS_PASSWORD: nonEmptyString,
    CF_ACCESS_CLIENT_ID: nonEmptyString,
    CF_ACCESS_CLIENT_SECRET: nonEmptyString,
    RESEND_API_KEY: v.optional(nonEmptyString),
    SMTP_URL: v.optional(nonEmptyString),
    EMAIL_FROM: nonEmptyString,
    BETTERSTACK_HEARTBEAT_URL: urlString,
    OPS_DISCORD_WEBHOOK_URL: urlString,
  }),
  v.check(
    (env) => hasCloudMailer(env) !== hasSelfHostMailer(env),
    'Set either RESEND_API_KEY (cloud) or SMTP_URL (self-host), not both or neither.',
  ),
)

export type JobsEnv = v.InferOutput<typeof jobsEnvSchema>

export class EnvValidationError extends Error {
  constructor(appName: string, issues: ReadonlyArray<v.BaseIssue<unknown>>) {
    const details = issues
      .map((issue) => {
        const path = issue.path?.map((segment) => String(segment.key)).join('.') ?? '(root)'
        return `  - ${path}: ${issue.message}`
      })
      .join('\n')
    super(`Invalid environment variables for ${appName}:\n${details}`)
    this.name = 'EnvValidationError'
  }
}

export function loadEnv<TSchema extends v.GenericSchema>(
  appName: string,
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, source)
  if (!result.success) {
    throw new EnvValidationError(appName, result.issues)
  }
  return result.output
}
