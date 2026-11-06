import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const RUNBOOKS = join(ROOT, 'docs', 'runbooks')
const HERE = join(ROOT, 'deploy', 'self-host')

const COMPOSE = readFileSync(join(HERE, 'docker-compose.yml'), 'utf8')
const EXAMPLE = readFileSync(join(HERE, '.env.example'), 'utf8')
const USERS = readFileSync(join(HERE, 'clickhouse-users.xml'), 'utf8')
const INFRA = readFileSync(join(ROOT, 'infra', 'README.md'), 'utf8')
const ENV_SCHEMA = readFileSync(join(ROOT, 'packages', 'config', 'src', 'env.ts'), 'utf8')

const WORKFLOWS = readdirSync(join(ROOT, '.github', 'workflows'))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8'))
  .join('\n')

const FILES = readdirSync(RUNBOOKS).filter((name) => name.endsWith('.md'))
const PROCEDURES = FILES.filter((name) => name !== 'README.md')

function read(name: string): string {
  return readFileSync(join(RUNBOOKS, name), 'utf8')
}

const GONE = [
  'Vercel',
  'Neon',
  'Upstash',
  'Oracle',
  'Workers KV',
  'Zero Trust',
  'Cloudflare Access',
  'Cloudflare Tunnel',
  'cloudflared',
]

const BELONGS_TO_THE_DASHBOARD = ['AUTH_JWT_', 'AUTH_OTP_SECRET']

const NOT_OURS = ['PGDATABASE', 'POSTGRES_PASSWORD', 'INTERVAL', 'SELECT', 'BACKUP', 'RESTORE']

const THE_NAME_A_RESTORE_GIVES_THE_DATABASE = 'nekolog_restaurado'

describe('the runbooks', () => {
  it('were found at all, so none of these checks is passing on an empty list', () => {
    expect(FILES).toContain('README.md')
    expect(PROCEDURES.length).toBeGreaterThanOrEqual(4)
  })

  it('name no provider this platform stopped having, outside the note that says so', () => {
    for (const name of PROCEDURES) {
      const text = read(name)
      for (const provider of GONE) {
        expect(text, `${name} still tells the reader to go to ${provider}`).not.toContain(provider)
      }
    }
  })

  it('records in the README which providers went away, or nobody reading them knows', () => {
    const readme = read('README.md')

    for (const provider of ['Vercel', 'Neon', 'Upstash', 'Oracle', 'Workers KV']) {
      expect(readme, provider).toContain(provider)
    }
  })

  it('links only to files that exist', () => {
    let checked = 0

    for (const name of FILES) {
      const links = [...read(name).matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] as string)

      for (const link of links) {
        if (link.startsWith('http') || link.startsWith('#') || link.startsWith('mailto:')) {
          continue
        }
        const target = resolve(RUNBOOKS, link.split('#')[0] as string)
        expect(existsSync(target), `${name} links to ${link}, which does not exist`).toBe(true)
        checked += 1
      }
    }

    expect(checked).toBeGreaterThan(10)
  })

  it('names no volume and no ClickHouse role that does not exist', () => {
    const volumes = new Set(
      [...COMPOSE.matchAll(/\n {2}(nekolog_[a-z]+):/g)].map((match) => match[1] as string),
    )
    const roles = new Set(
      [...USERS.matchAll(/<(nekolog_[a-z]+)>/g)].map((match) => match[1] as string),
    )
    const named = new Set(
      FILES.flatMap((name) =>
        [...read(name).matchAll(/\bnekolog_[a-z]+\b/g)].map((match) => match[0]),
      ),
    )

    expect(volumes.size).toBeGreaterThan(3)
    expect(roles.size).toBeGreaterThanOrEqual(5)
    expect(named.size).toBeGreaterThan(5)
    for (const token of named) {
      if (token === THE_NAME_A_RESTORE_GIVES_THE_DATABASE) {
        continue
      }
      expect(
        volumes.has(token) || roles.has(token),
        `the runbooks name ${token}, which is neither a volume nor a ClickHouse user`,
      ).toBe(true)
    }
  })

  it('tells the reader how to rotate every ClickHouse role there is', () => {
    const roles = [...USERS.matchAll(/<(nekolog_[a-z]+)>/g)].map((match) => match[1] as string)
    const rotation = read('rotacao-de-segredos.md')

    expect(roles.length).toBeGreaterThanOrEqual(5)
    for (const role of roles) {
      expect(rotation, `${role} exists and the rotation runbook never mentions it`).toContain(role)
    }
  })

  it('invents no environment variable: each one is declared somewhere that runs', () => {
    const mentioned = new Set(
      FILES.flatMap((name) =>
        [...read(name).matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map(
          (match) => match[1] as string,
        ),
      ),
    )

    expect(mentioned.size).toBeGreaterThan(10)
    for (const variable of mentioned) {
      if (
        NOT_OURS.includes(variable) ||
        BELONGS_TO_THE_DASHBOARD.some((prefix) => variable.startsWith(prefix))
      ) {
        continue
      }
      const declared =
        EXAMPLE.includes(`${variable}=`) ||
        INFRA.includes(variable) ||
        COMPOSE.includes(variable) ||
        WORKFLOWS.includes(variable) ||
        ENV_SCHEMA.includes(variable)

      expect(declared, `${variable} is named in a runbook and declared nowhere that runs`).toBe(
        true,
      )
    }
  })

  it('keeps every procedure pointing at the note about their state', () => {
    for (const name of PROCEDURES) {
      expect(read(name), name).toContain('README.md#estado-destes-runbooks')
    }
    expect(read('README.md')).toContain('## Estado destes runbooks')
  })
})
