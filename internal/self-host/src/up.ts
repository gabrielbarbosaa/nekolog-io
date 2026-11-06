import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderFirstRunEnv,
  UnusableValue,
  VERSIONED_APPS,
  versionFrom,
  versionVariableFor,
} from './first-run.ts'

export const BOOTSTRAP_LOG_LINES = 12

export const USAGE = `pnpm self-host:up

Writes deploy/self-host/.env with fresh secrets the first time, then builds and
starts the stack. It needs Docker and nothing else: the secrets come from Node's
own crypto, so there is no openssl and no shell, which is what makes it run on
Windows as well as on the machine.

An .env that is already there is never overwritten.`

export type Spawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => { status: number | null; error?: Error }

const runProcess: Spawner = (command, args, options) =>
  spawnSync(command, args, { ...options, stdio: 'inherit' })

export function repositoryRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

export function versionsOf(root: string): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const app of VERSIONED_APPS) {
    const manifest = readFileSync(join(root, 'apps', app, 'package.json'), 'utf8')
    versions[versionVariableFor(app)] = versionFrom(manifest)
  }
  return versions
}

export async function up(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  spawner: Spawner = runProcess,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const root = repositoryRoot()
  const here = join(root, 'deploy', 'self-host')
  const envFile = join(here, '.env')

  if (existsSync(envFile)) {
    process.stdout.write('using the .env that is already here\n')
  } else {
    process.stdout.write('writing .env with freshly generated secrets\n')
    try {
      writeFileSync(
        envFile,
        renderFirstRunEnv((bytes) => randomBytes(bytes).toString('hex'), environment),
        { mode: 0o600 },
      )
    } catch (error) {
      if (error instanceof UnusableValue) {
        process.stderr.write(`${error.message}\n`)
        return 1
      }
      throw error
    }
    process.stdout.write(
      'back .env up somewhere safe: ENCRYPTION_KEY cannot be recovered from the database\n',
    )
  }

  const withVersions: NodeJS.ProcessEnv = { ...environment, ...versionsOf(root) }

  const built = spawner('docker', ['compose', 'up', '-d', '--build'], {
    cwd: here,
    env: withVersions,
  })

  if (built.error !== undefined) {
    process.stderr.write(
      `I could not start docker: ${built.error.message}\nInstall Docker, or write .env by hand and run docker compose up -d --build yourself.\n`,
    )
    return 1
  }

  if (built.status !== 0) {
    return built.status ?? 1
  }

  process.stdout.write('\n')
  spawner('docker', ['compose', 'logs', '--tail', String(BOOTSTRAP_LOG_LINES), 'bootstrap'], {
    cwd: here,
    env: withVersions,
  })

  return 0
}
