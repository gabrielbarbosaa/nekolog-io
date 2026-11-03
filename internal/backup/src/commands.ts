import { BackupRefused } from './plan.ts'

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
      env: { PGDATABASE: options.databaseUrl },
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
      env: { PGDATABASE: options.databaseUrl },
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
