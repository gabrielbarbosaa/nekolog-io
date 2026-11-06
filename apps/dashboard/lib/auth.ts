import 'server-only'
import type { LoginDeps, SqlRunner } from '@internal/auth'
import {
  allowlistedMailer,
  type Mailer,
  nodeRedis,
  type RedisClient,
  resendMailer,
  smtpMailer,
} from '@nekolog-io/adapters'
import Redis from 'ioredis'
import nodemailer from 'nodemailer'
import postgres from 'postgres'

export type AuthSettings = {
  appUrl: string
  otpSecret: string
  turnstileSecret: string | undefined
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set, and the dashboard cannot sign anyone in without it.`)
  }
  return value
}

let sql: ReturnType<typeof postgres> | undefined
let redis: Redis | undefined
let mailer: Mailer | undefined

function sqlRunner(): SqlRunner {
  sql ??= postgres(required('DATABASE_URL'), { max: 4 })
  const open = sql
  return async (text, params) =>
    (await open.unsafe(text, params as never[])) as unknown as ReadonlyArray<
      Record<string, unknown>
    >
}

function redisClient(): RedisClient {
  redis ??= new Redis(required('REDIS_URL'))
  return nodeRedis(redis) as RedisClient
}

function builtMailer(): Mailer {
  const smtp = process.env.SMTP_URL
  const from = required('EMAIL_FROM')

  const plain =
    smtp === undefined || smtp === ''
      ? resendMailer({ apiKey: required('RESEND_API_KEY'), from })
      : smtpMailer({ transport: nodemailer.createTransport(smtp), from })

  if (process.env.APP_ENV === 'prod') {
    return plain
  }

  const allowlist = (process.env.EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

  return allowlistedMailer(plain, allowlist)
}

export function authSettings(): AuthSettings {
  return {
    appUrl: required('APP_URL'),
    otpSecret: required('AUTH_OTP_SECRET'),
    turnstileSecret: process.env.TURNSTILE_SECRET_KEY,
  }
}

export function loginDeps(): LoginDeps {
  return { run: sqlRunner(), redis: redisClient(), otpSecret: required('AUTH_OTP_SECRET') }
}

export function mail(): Mailer {
  mailer ??= builtMailer()
  return mailer
}
