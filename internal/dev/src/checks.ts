import { FILLED, needsFilling } from './env.ts'

export type Verdict = {
  name: string
  ok: boolean
  detail: string
}

export const REQUIRED_FOR_DASHBOARD: readonly string[] = [
  'APP_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'AUTH_JWT_PRIVATE_KEY',
  'AUTH_JWT_PUBLIC_KEY',
  'AUTH_OTP_SECRET',
  'EMAIL_FROM',
]

export const REQUIRED_FOR_JOBS: readonly string[] = [
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_JOBS_USER',
  'CLICKHOUSE_JOBS_PASSWORD',
  'DATABASE_URL',
  'NEKOLOG_CONSOLE_URL',
  'ENCRYPTION_KEY',
  'SPOOL_DIR',
  'KV_DIR',
]

export const DASHBOARD_PORT = 3001

export function missingFrom(
  names: ReadonlyArray<string>,
  environment: Record<string, string | undefined>,
): string[] {
  return names.filter((name) => {
    const value = environment[name]
    return value === undefined || value.trim() === ''
  })
}

export function placeholdersIn(environment: Record<string, string | undefined>): string[] {
  return Object.keys(FILLED).filter((name) => needsFilling(name, environment[name]))
}

export function pemLooksReal(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  const pem = value.replace(/\\n/g, '\n')
  return /^-----BEGIN (?:PRIVATE|PUBLIC) KEY-----\n[\s\S]+\n-----END (?:PRIVATE|PUBLIC) KEY-----$/.test(
    pem.trim(),
  )
}

export function appUrlMatchesTheDashboard(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  try {
    return new URL(value).port === String(DASHBOARD_PORT)
  } catch {
    return false
  }
}

export function envVerdicts(environment: Record<string, string | undefined>): Verdict[] {
  const missingDashboard = missingFrom(REQUIRED_FOR_DASHBOARD, environment)
  const missingJobs = missingFrom(REQUIRED_FOR_JOBS, environment)
  const placeholders = placeholdersIn(environment)

  return [
    {
      name: 'the dashboard has every variable it needs',
      ok: missingDashboard.length === 0,
      detail:
        missingDashboard.length === 0
          ? 'all set'
          : `missing ${missingDashboard.join(', ')} — run \`pnpm dev:env\``,
    },
    {
      name: 'the jobs have every variable they need',
      ok: missingJobs.length === 0,
      detail:
        missingJobs.length === 0
          ? 'all set'
          : `missing ${missingJobs.join(', ')} — run \`pnpm dev:env\``,
    },
    {
      name: 'no placeholder is left where a real secret belongs',
      ok: placeholders.length === 0,
      detail:
        placeholders.length === 0
          ? 'all generated'
          : `${placeholders.join(', ')} still reads dev-only-fake — run \`pnpm dev:env\``,
    },
    {
      name: 'the signing key is a real Ed25519 pair',
      ok:
        pemLooksReal(environment.AUTH_JWT_PRIVATE_KEY) &&
        pemLooksReal(environment.AUTH_JWT_PUBLIC_KEY),
      detail: pemLooksReal(environment.AUTH_JWT_PRIVATE_KEY)
        ? 'both PEMs parse'
        : 'nobody can sign in without one — run `pnpm dev:env`',
    },
    {
      name: `APP_URL points at the dashboard on :${DASHBOARD_PORT}`,
      ok: appUrlMatchesTheDashboard(environment.APP_URL),
      detail: appUrlMatchesTheDashboard(environment.APP_URL)
        ? String(environment.APP_URL)
        : `${environment.APP_URL ?? 'unset'} is not the dashboard, so every write is refused as ` +
          `bad_origin — set APP_URL=http://localhost:${DASHBOARD_PORT} in .env`,
    },
  ]
}
