import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envVerdicts, type Verdict } from './checks.ts'
import { answers, DEV_SERVICES } from './services.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const APPS: ReadonlyArray<{ name: string; url: string; dev: boolean }> = [
  { name: 'dashboard', url: 'http://localhost:3001/health', dev: true },
  { name: 'ingestion', url: 'http://localhost:8787/health', dev: true },
  { name: 'jobs', url: 'http://localhost:8788/health', dev: true },
  { name: 'read API', url: 'http://localhost:8789/health', dev: true },
  { name: 'landing page', url: 'http://localhost:3000/health', dev: false },
]

function say(line = ''): void {
  process.stdout.write(`${line}\n`)
}

async function reaches(url: string): Promise<{ up: boolean; version: string; detail: string }> {
  try {
    const answer = await fetch(url, { signal: AbortSignal.timeout(2000) })
    const body = (await answer.json().catch(() => ({}))) as {
      version?: unknown
      detail?: unknown
    }
    const version = typeof body.version === 'string' ? body.version : ''
    const detail = typeof body.detail === 'string' ? body.detail : ''

    return { up: answer.ok, version, detail }
  } catch {
    return { up: false, version: '', detail: '' }
  }
}

async function serviceVerdicts(): Promise<Verdict[]> {
  const reached = await Promise.all(DEV_SERVICES.map((service) => answers(service, 2000)))
  return DEV_SERVICES.map((service, index) => ({
    name: `${service.name} is up`,
    ok: reached[index] === true,
    detail:
      reached[index] === true
        ? `${service.host}:${service.port} — ${service.hint}`
        : 'not answering — run `pnpm dev:infra`',
  }))
}

async function appVerdicts(): Promise<Verdict[]> {
  const reached = await Promise.all(APPS.map((app) => reaches(app.url)))

  return APPS.map((app, index) => {
    const found = reached[index] ?? { up: false, version: '', detail: '' }

    if (!found.up) {
      return {
        name: `the ${app.name} answers`,
        ok: false,
        detail: found.detail === '' ? `${app.url} is quiet` : `${app.url} — ${found.detail}`,
      }
    }
    if (app.dev && found.version !== 'dev') {
      return {
        name: `the ${app.name} answers`,
        ok: false,
        detail:
          `${app.url} answered version ${JSON.stringify(found.version)}, not "dev" — a self-host ` +
          'container is holding this port, so `turbo run dev` cannot bind it. Stop it with ' +
          '`docker compose -f deploy/self-host/docker-compose.yml down`',
      }
    }
    return { name: `the ${app.name} answers`, ok: true, detail: app.url }
  })
}

function seedVerdict(): Verdict {
  const seeded = existsSync(join(ROOT, '.nekolog-seed.json'))
  return {
    name: 'a seed project exists',
    ok: seeded,
    detail: seeded
      ? '.nekolog-seed.json'
      : 'the read API will not start without it — run `pnpm seed init`',
  }
}

function report(title: string, verdicts: ReadonlyArray<Verdict>): number {
  say(title)
  for (const verdict of verdicts) {
    say(`  ${verdict.ok ? 'ok  ' : 'FAIL'} ${verdict.name}: ${verdict.detail}`)
  }
  say()
  return verdicts.filter((verdict) => !verdict.ok).length
}

async function main(): Promise<number> {
  let broken = 0
  broken += report('Environment', envVerdicts(process.env))
  broken += report('Containers', await serviceVerdicts())
  broken += report('State', [seedVerdict()])
  broken += report('Applications', await appVerdicts())

  if (broken === 0) {
    say('Everything this stack needs is running.')
    return 0
  }

  say(`${broken} ${broken === 1 ? 'thing is' : 'things are'} not ready.`)
  return 1
}

process.exitCode = await main()
