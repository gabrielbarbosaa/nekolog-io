import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDevEnv } from './env.ts'
import { DEV_SERVICES, waitFor } from './services.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const EXAMPLE = join(ROOT, '.env.example')
const TARGET = join(ROOT, '.env')
const STATE = join(ROOT, '.nekolog-dev')

export const COMMANDS = ['env', 'wait'] as const

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

function writeEnv(): number {
  const example = read(EXAMPLE)
  if (example === '') {
    process.stderr.write('.env.example is missing, so there is nothing to copy from.\n')
    return 1
  }

  const pair = generateKeyPairSync('ed25519')
  const written = renderDevEnv(example, read(TARGET), {
    secret: (bytes) => randomBytes(bytes).toString('base64url'),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  })

  writeFileSync(TARGET, written.text, 'utf8')
  mkdirSync(join(STATE, 'kv'), { recursive: true })
  mkdirSync(join(STATE, 'spool'), { recursive: true })

  say(`.env ready: ${written.kept.length} kept, ${written.added.length} added.`)
  if (written.generated.length > 0) {
    say(`Generated a real value for ${written.generated.join(', ')}.`)
  }
  return 0
}

async function waitForServices(): Promise<number> {
  const missing = await waitFor(DEV_SERVICES)
  if (missing.length > 0) {
    for (const service of missing) {
      process.stderr.write(
        `${service.name} did not answer on ${service.host}:${service.port} — ${service.hint}.\n`,
      )
    }
    process.stderr.write('Start them with `pnpm dev:infra` and run this again.\n')
    return 1
  }

  say('Postgres, ClickHouse, Valkey and Mailpit all answered.')
  return 0
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const command = argv[0] ?? 'all'

  if (command === 'env') {
    return writeEnv()
  }
  if (command === 'wait') {
    return waitForServices()
  }
  if (command !== 'all') {
    process.stderr.write(`I do not know the command ${JSON.stringify(command)}.\n`)
    return 1
  }

  const wrote = writeEnv()
  return wrote === 0 ? waitForServices() : wrote
}

process.exitCode = await main(process.argv.slice(2))
