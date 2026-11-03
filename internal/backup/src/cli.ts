import { readFileSync } from 'node:fs'
import { describePipeline, dumpCommand, restoreCommand } from './commands.ts'
import { BackupRefused, expired, keyFor } from './plan.ts'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function required(name: string): string {
  const value = flag(name)
  if (value === undefined || value === '') {
    throw new BackupRefused(`--${name} is missing`)
  }
  return value
}

function write(line: string): void {
  process.stdout.write(`${line}\n`)
}

const command = process.argv[2]

try {
  if (command === 'key') {
    write(keyFor(required('environment'), new Date()))
  } else if (command === 'dump-pipeline') {
    write(
      describePipeline(
        dumpCommand({
          databaseUrl: process.env.DATABASE_URL ?? '',
          recipient: required('recipient'),
        }),
      ),
    )
  } else if (command === 'restore-pipeline') {
    write(
      describePipeline(
        restoreCommand({
          databaseUrl: process.env.DATABASE_URL ?? '',
          identityFile: required('identity'),
        }),
      ),
    )
  } else if (command === 'expired') {
    const keys = readFileSync(required('keys-file'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    const keepDays = flag('keep-days')
    for (const key of expired(keys, {
      now: new Date(),
      ...(keepDays === undefined ? {} : { keepDays: Number(keepDays) }),
    })) {
      write(key)
    }
  } else {
    throw new BackupRefused(
      `"${command ?? ''}" is not a command. Use key, dump-pipeline, restore-pipeline or expired.`,
    )
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
