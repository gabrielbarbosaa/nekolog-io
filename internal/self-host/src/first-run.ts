export type GeneratedSecret = {
  name: string
  bytes: number
}

export type FirstRunSetting = {
  name: string
  fallback: string
}

export const GENERATED_SECRETS: readonly GeneratedSecret[] = [
  { name: 'CLICKHOUSE_DEFAULT_PASSWORD', bytes: 24 },
  { name: 'CLICKHOUSE_READ_PASSWORD', bytes: 24 },
  { name: 'CLICKHOUSE_INSERT_PASSWORD', bytes: 24 },
  { name: 'CLICKHOUSE_JOBS_PASSWORD', bytes: 24 },
  { name: 'CLICKHOUSE_BACKUP_PASSWORD', bytes: 24 },
  { name: 'CLICKHOUSE_MIGRATOR_PASSWORD', bytes: 24 },
  { name: 'POSTGRES_PASSWORD', bytes: 24 },
  { name: 'ENCRYPTION_KEY', bytes: 32 },
]

export const FIRST_RUN_SETTINGS: readonly FirstRunSetting[] = [
  { name: 'NEKOLOG_CONSOLE_URL', fallback: 'https://localhost' },
  { name: 'NEKOLOG_DOMAIN', fallback: 'localhost' },
  { name: 'ACME_EMAIL', fallback: 'admin@localhost' },
  { name: 'INGEST_PUBLISH', fallback: '8787' },
  { name: 'JOBS_PUBLISH', fallback: '8788' },
  { name: 'API_PUBLISH', fallback: '8789' },
  { name: 'SEED_ENVIRONMENTS', fallback: 'production' },
  { name: 'SEED_RETENTION_DAYS', fallback: '30' },
  { name: 'BACKUP_S3_ENDPOINT', fallback: '' },
  { name: 'BACKUP_S3_ACCESS_KEY_ID', fallback: '' },
  { name: 'BACKUP_S3_SECRET_ACCESS_KEY', fallback: '' },
  { name: 'BACKUP_AGE_RECIPIENT', fallback: '' },
  { name: 'BACKUP_ENVIRONMENT', fallback: 'prod' },
  { name: 'BACKUP_KEEP_DAYS', fallback: '30' },
]

export const VERSIONED_APPS: readonly string[] = ['ingest', 'api', 'jobs']

export class UnusableValue extends Error {}

export function versionVariableFor(app: string): string {
  return `${app.toUpperCase()}_VERSION`
}

function assertUsable(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new UnusableValue(
      `${name} carries a line break, which would write a second variable nobody asked for`,
    )
  }
}

export function renderFirstRunEnv(
  secrets: (bytes: number) => string,
  environment: Record<string, string | undefined>,
): string {
  const lines: string[] = []

  for (const secret of GENERATED_SECRETS) {
    const value = secrets(secret.bytes)
    assertUsable(secret.name, value)
    lines.push(`${secret.name}=${value}`)
  }

  for (const setting of FIRST_RUN_SETTINGS) {
    const chosen = environment[setting.name]
    const value = chosen === undefined || chosen === '' ? setting.fallback : chosen
    assertUsable(setting.name, value)
    lines.push(`${setting.name}=${value}`)
  }

  return `${lines.join('\n')}\n`
}

export function versionFrom(manifest: string): string {
  const found = /"version"\s*:\s*"([^"]+)"/.exec(manifest)
  if (found === null) {
    throw new UnusableValue('this package.json declares no version')
  }
  return found[1] as string
}
