import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_DURATION,
  DEFAULT_VUS,
  MAX_FAILURE_RATE,
  MIN_CHECK_RATE,
  thresholdsFor,
} from './budget.ts'
import { batchBytes, DEFAULT_CORPUS_EVENTS, logBatch } from './corpus.ts'
import { assertTargetIsUp, k6Command, LoadRefused, type Runner } from './run.ts'

export const USAGE: string = `pnpm load <ingest|api> — drive one target with k6

  --url <url>        where it answers (default: ingest http://localhost:8787, api http://localhost:8789)
  --key <key>        the key to send (default: $NEKOLOG_KEY)
  --vus <n>          virtual users (default: ${DEFAULT_VUS})
  --duration <t>     how long (default: ${DEFAULT_DURATION})
  --events <n>       events per batch, ingest only (default: ${DEFAULT_CORPUS_EVENTS})
  --service <name>   what the batch calls itself, so one run can be counted apart
  --runner <r>       k6 or docker (default: k6 if it is installed, else docker)
`

export const K6_DIR: string = join(dirname(fileURLToPath(import.meta.url)), '..', 'k6')

const DEFAULT_URLS: Record<string, string> = {
  ingest: 'http://localhost:8787',
  api: 'http://localhost:8789',
}

type Parsed = {
  target: string
  url?: string
  key?: string
  vus?: string
  duration?: string
  events?: string
  runner?: string
  service?: string
}

const WITH_VALUE = [
  '--url',
  '--key',
  '--vus',
  '--duration',
  '--events',
  '--runner',
  '--service',
] as const

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { target: argv[0] ?? '' }
  for (let at = 1; at < argv.length; at += 1) {
    const flag = argv[at] as string
    const value = argv[at + 1]
    if (!(WITH_VALUE as readonly string[]).includes(flag) || value === undefined) {
      continue
    }
    at += 1
    const name = flag.slice(2) as keyof Parsed
    parsed[name] = value
  }
  return parsed
}

async function installed(command: string): Promise<boolean> {
  return new Promise((settle) => {
    const probe = spawn(command, ['version'], { stdio: 'ignore', shell: false })
    probe.once('error', () => settle(false))
    probe.once('exit', (code) => settle(code === 0))
  })
}

export async function chooseRunner(asked: string | undefined): Promise<Runner> {
  if (asked === 'k6' || asked === 'docker') {
    return asked
  }
  if (asked !== undefined) {
    throw new LoadRefused(`${asked} is not a runner. Use k6 or docker.`)
  }
  if (await installed('k6')) {
    return 'k6'
  }
  if (await installed('docker')) {
    return 'docker'
  }
  throw new LoadRefused('I found neither k6 nor docker. Install one of them.')
}

export const FIXTURE_FILE = 'ingest-batch.json'
export const FIXTURES_DIR: string = join(K6_DIR, 'fixtures')

export type Fixture = { bytes: number; batchId: string; service: string }

export async function writeFixture(
  events: number,
  service: string | undefined,
  folder: string = FIXTURES_DIR,
): Promise<Fixture> {
  const batch = logBatch({ events, ...(service === undefined ? {} : { service }) })
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, FIXTURE_FILE), JSON.stringify(batch), 'utf8')
  return { bytes: batchBytes(batch), batchId: batch.batchId, service: batch.resource.service }
}

export type RunSettings = {
  target: 'ingest' | 'api'
  url: string
  key: string
  vus: string
  duration: string
  events: number
  fixture: Fixture
}

export function k6EnvFor(settings: RunSettings): Record<string, string> {
  const thresholds = thresholdsFor(settings.target)
  return {
    TARGET_URL: settings.url,
    NEKOLOG_KEY: settings.key,
    VUS: settings.vus,
    DURATION: settings.duration,
    EVENTS: String(settings.events),
    FIXTURE_BATCH_ID: settings.fixture.batchId,
    P95_MS: String(thresholds.p95Ms),
    FAILURE_RATE: String(MAX_FAILURE_RATE),
    CHECK_RATE: String(MIN_CHECK_RATE),
  }
}

export type DriveDeps = {
  run?: (file: string, args: readonly string[]) => Promise<number>
  probe?: typeof fetch
  fixturesDir?: string
}

function spawned(file: string, args: readonly string[]): Promise<number> {
  return new Promise((settle) => {
    const child = spawn(file, [...args], { stdio: 'inherit', shell: false })
    child.once('error', () => settle(127))
    child.once('exit', (code) => settle(code ?? 1))
  })
}

export async function main(argv: readonly string[], deps: DriveDeps = {}): Promise<number> {
  const parsed = parseArgs(argv)
  if (parsed.target !== 'ingest' && parsed.target !== 'api') {
    process.stdout.write(USAGE)
    return parsed.target === '' || parsed.target === '--help' ? 0 : 1
  }

  try {
    const url = parsed.url ?? (DEFAULT_URLS[parsed.target] as string)
    const key = parsed.key ?? process.env.NEKOLOG_KEY ?? ''
    if (key === '') {
      throw new LoadRefused('I need a key. Pass --key or set NEKOLOG_KEY.')
    }

    await assertTargetIsUp(url, deps.probe)

    const events = Number(parsed.events ?? DEFAULT_CORPUS_EVENTS)
    if (!Number.isInteger(events) || events < 1) {
      throw new LoadRefused(`${parsed.events} is not a number of events.`)
    }

    const fixture =
      parsed.target === 'ingest'
        ? await writeFixture(events, parsed.service, deps.fixturesDir)
        : { bytes: 0, batchId: '', service: '' }
    const runner = await chooseRunner(parsed.runner)

    const command = k6Command({
      runner,
      script: `${parsed.target}.js`,
      scriptsDir: K6_DIR,
      env: k6EnvFor({
        target: parsed.target,
        url,
        key,
        vus: String(parsed.vus ?? DEFAULT_VUS),
        duration: parsed.duration ?? DEFAULT_DURATION,
        events,
        fixture,
      }),
    })

    process.stdout.write(
      `${parsed.target} at ${url}, ${runner}, ${parsed.vus ?? DEFAULT_VUS} vus for ${parsed.duration ?? DEFAULT_DURATION}` +
        `${fixture.bytes > 0 ? `, ${events} events per batch (${(fixture.bytes / 1024).toFixed(0)} KB) as service ${fixture.service}` : ''}\n`,
    )

    return await (deps.run ?? spawned)(command.file, command.args)
  } catch (error) {
    const message = error instanceof LoadRefused ? error.message : String(error)
    process.stderr.write(`pnpm load: ${message}\n`)
    return 1
  }
}
