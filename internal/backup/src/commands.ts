import { BACKUP_PREFIX, BackupRefused, type BucketAddress, splitBucketUrl } from './plan.ts'

export const REMOTE = 'backup'

export type Command = {
  file: string
  args: string[]
  env: Record<string, string>
}

export type DumpOptions = {
  databaseUrl: string
  recipient: string
}

export type RestoreOptions = {
  databaseUrl: string
  identityFile: string
}

const SECRET_LOOKING = /:\/\/[^/@\s]*:[^/@\s]*@/

function assertNoSecretInArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (SECRET_LOOKING.test(arg)) {
      throw new BackupRefused(
        'a connection string with a password would end up in the process list; pass it in the environment',
      )
    }
  }
}

export function pgEnvFrom(databaseUrl: string): Record<string, string> {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new BackupRefused(`${JSON.stringify(databaseUrl)} is not a connection string`)
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new BackupRefused(`${parsed.protocol} is not a postgres connection string`)
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (parsed.hostname === '' || database === '') {
    throw new BackupRefused('the connection string names no host or no database')
  }

  const mode = parsed.searchParams.get('sslmode')

  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port === '' ? '5432' : parsed.port,
    PGDATABASE: database,
    ...(parsed.username === '' ? {} : { PGUSER: decodeURIComponent(parsed.username) }),
    ...(parsed.password === '' ? {} : { PGPASSWORD: decodeURIComponent(parsed.password) }),
    ...(mode === null ? {} : { PGSSLMODE: mode }),
  }
}

export function dumpCommand(options: DumpOptions): Command[] {
  if (options.recipient.trim() === '') {
    throw new BackupRefused('there is no age recipient, and an unencrypted dump never leaves here')
  }
  if (options.databaseUrl.trim() === '') {
    throw new BackupRefused('there is no database to dump')
  }

  const pipeline: Command[] = [
    {
      file: 'pg_dump',
      args: ['--no-owner', '--no-privileges', '--format=plain'],
      env: pgEnvFrom(options.databaseUrl),
    },
    { file: 'gzip', args: ['--best', '--stdout'], env: {} },
    { file: 'age', args: ['--recipient', options.recipient], env: {} },
  ]

  for (const step of pipeline) {
    assertNoSecretInArgs(step.args)
  }
  return pipeline
}

export function restoreCommand(options: RestoreOptions): Command[] {
  if (options.identityFile.trim() === '') {
    throw new BackupRefused('there is no age identity, so nothing can be decrypted')
  }

  const pipeline: Command[] = [
    { file: 'age', args: ['--decrypt', '--identity', options.identityFile], env: {} },
    { file: 'gunzip', args: ['--stdout'], env: {} },
    {
      file: 'psql',
      args: ['--quiet', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1'],
      env: pgEnvFrom(options.databaseUrl),
    },
  ]

  for (const step of pipeline) {
    assertNoSecretInArgs(step.args)
  }
  return pipeline
}

export function describePipeline(pipeline: readonly Command[]): string {
  return pipeline.map((step) => [step.file, ...step.args].join(' ')).join(' | ')
}

export type Destination = {
  bucketUrl: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export function rcloneEnv(destination: Destination): Record<string, string> {
  const { endpoint } = splitBucketUrl(destination.bucketUrl)

  if (destination.accessKeyId.trim() === '' || destination.secretAccessKey.trim() === '') {
    throw new BackupRefused('there are no credentials for the bucket')
  }

  const prefix = `RCLONE_CONFIG_${REMOTE.toUpperCase()}`
  return {
    [`${prefix}_TYPE`]: 's3',
    [`${prefix}_PROVIDER`]: 'Other',
    [`${prefix}_ENDPOINT`]: endpoint,
    [`${prefix}_REGION`]: destination.region ?? 'us-east-1',
    [`${prefix}_ACCESS_KEY_ID`]: destination.accessKeyId,
    [`${prefix}_SECRET_ACCESS_KEY`]: destination.secretAccessKey,
    [`${prefix}_NO_CHECK_BUCKET`]: 'true',
  }
}

function remotePath(address: BucketAddress, key: string): string {
  return `${REMOTE}:${address.bucket}/${key}`
}

export function uploadCommand(destination: Destination, key: string): Command {
  const address = splitBucketUrl(destination.bucketUrl)
  const command: Command = {
    file: 'rclone',
    args: ['rcat', remotePath(address, key)],
    env: rcloneEnv(destination),
  }
  assertNoSecretInArgs(command.args)
  return command
}

export function listCommand(destination: Destination, environment: string): Command {
  const address = splitBucketUrl(destination.bucketUrl)
  const command: Command = {
    file: 'rclone',
    args: [
      'lsf',
      '--recursive',
      '--files-only',
      remotePath(address, `${BACKUP_PREFIX}${environment}/`),
    ],
    env: rcloneEnv(destination),
  }
  assertNoSecretInArgs(command.args)
  return command
}

export function deleteCommand(destination: Destination, key: string): Command {
  const address = splitBucketUrl(destination.bucketUrl)
  const command: Command = {
    file: 'rclone',
    args: ['deletefile', remotePath(address, key)],
    env: rcloneEnv(destination),
  }
  assertNoSecretInArgs(command.args)
  return command
}
