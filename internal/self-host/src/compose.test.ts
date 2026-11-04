import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const HERE = join(ROOT, 'deploy', 'self-host')

const COMPOSE = readFileSync(join(HERE, 'docker-compose.yml'), 'utf8')
const EXAMPLE = readFileSync(join(HERE, '.env.example'), 'utf8')
const DOCKERFILE = readFileSync(join(HERE, 'Dockerfile'), 'utf8')
const BOOTSTRAP = readFileSync(join(HERE, 'bootstrap.sh'), 'utf8')
const UP = readFileSync(join(HERE, 'up.sh'), 'utf8')
const IGNORED = readFileSync(join(ROOT, '.dockerignore'), 'utf8')

function serviceBlock(name: string): string {
  const pattern = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]|\\nvolumes:)`)
  const found = pattern.exec(COMPOSE)
  if (found === null) {
    throw new Error(`there is no service called ${name}`)
  }
  return found[1] ?? ''
}

function required(): string[] {
  return [...COMPOSE.matchAll(/\$\{([A-Z_]+):\?/g)].map((match) => match[1] as string)
}

describe('the self-host compose', () => {
  it('carries no secret of its own, only the name of one', () => {
    for (const line of COMPOSE.split('\n')) {
      if (!/PASSWORD|ENCRYPTION_KEY|WEBHOOK|DATABASE_URL/.test(line)) {
        continue
      }
      expect(line, line.trim()).toMatch(/\$\{[A-Z_]+/)
    }
    expect(COMPOSE).not.toMatch(/[0-9a-f]{32}/)
  })

  it('refuses to start without a password instead of falling back to one', () => {
    const names = required()

    expect(names).toContain('POSTGRES_PASSWORD')
    expect(names).toContain('ENCRYPTION_KEY')
    for (const role of ['DEFAULT', 'READ', 'INSERT', 'JOBS', 'MIGRATOR']) {
      expect(names).toContain(`CLICKHOUSE_${role}_PASSWORD`)
    }
  })

  it('names every value it demands in .env.example, so nobody has to read the yaml', () => {
    for (const name of new Set(required())) {
      expect(EXAMPLE, `${name} is demanded but never mentioned in .env.example`).toContain(
        `${name}=`,
      )
    }
  })

  it('mounts every file it says it mounts', () => {
    const mounted = [...COMPOSE.matchAll(/- \.\/([\w.-]+):/g)].map((match) => match[1] as string)

    expect(mounted.length).toBeGreaterThan(0)
    for (const file of mounted) {
      expect(existsSync(join(HERE, file)), `the compose mounts ${file}, which does not exist`).toBe(
        true,
      )
    }
  })

  it('keeps both databases off the host, where a default password cannot be reached', () => {
    expect(serviceBlock('clickhouse')).not.toContain('ports:')
    expect(serviceBlock('postgres')).not.toContain('ports:')
  })

  it('publishes the ingestion and keeps the jobs health on the loopback', () => {
    expect(serviceBlock('ingest')).toMatch(/- "\$\{INGEST_PUBLISH:-8787\}:8787"/)
    expect(serviceBlock('jobs')).toMatch(/- "127\.0\.0\.1:\$\{JOBS_PUBLISH:-8788\}:8788"/)
  })

  it('lets only the jobs container write the block list, and only bootstrap the seed', () => {
    const ingest = serviceBlock('ingest')
    const jobs = serviceBlock('jobs')
    const bootstrap = serviceBlock('bootstrap')

    expect(ingest).toContain('nekolog_kv:/var/lib/nekolog/kv:ro')
    expect(ingest).toContain('nekolog_state:/var/lib/nekolog/state:ro')
    expect(jobs).toContain('nekolog_kv:/var/lib/nekolog/kv\n')
    expect(bootstrap).toContain('nekolog_state:/var/lib/nekolog/state\n')
    expect(jobs).not.toContain('nekolog_state')
  })

  it('shares one spool directory both ways, because that is the handoff', () => {
    expect(serviceBlock('ingest')).toContain('nekolog_spool:/var/lib/nekolog/spool\n')
    expect(serviceBlock('jobs')).toContain('nekolog_spool:/var/lib/nekolog/spool\n')
  })

  it('starts nothing before the migrations have finished', () => {
    for (const service of ['ingest', 'jobs']) {
      expect(serviceBlock(service)).toContain('condition: service_completed_successfully')
    }
  })

  it('runs the two long-lived services without a package manager', () => {
    expect(serviceBlock('ingest')).toContain(
      'command: ["node", "apps/ingest/src/serve-self-host.ts"]',
    )
    expect(serviceBlock('jobs')).toContain('command: ["node", "apps/jobs/src/serve.ts"]')
  })
})

describe('the image and the scripts around it', () => {
  it('never ships the repository history, which the hooks would otherwise ask for', () => {
    expect(IGNORED.split('\n')).toContain('.git')
    expect(DOCKERFILE).toContain('delete p.scripts.prepare')
  })

  it('resolves pnpm at build time, so a container start needs no network', () => {
    expect(DOCKERFILE).toContain('COREPACK_HOME')
    expect(DOCKERFILE).toContain('corepack install')
  })

  it('runs as somebody other than root', () => {
    expect(DOCKERFILE).toMatch(/\nUSER node\n/)
    expect(DOCKERFILE.indexOf('USER node')).toBeGreaterThan(DOCKERFILE.indexOf('chown -R node'))
  })

  it('writes the first keys to a file and not to the container log', () => {
    expect(BOOTSTRAP).toContain('umask 077')
    expect(BOOTSTRAP).toMatch(/pnpm seed init[\s\S]*>"\$KEYS_FILE"/)
  })

  it('puts the project into Postgres as well, or the issue rollup has no project', () => {
    expect(BOOTSTRAP).toContain('pnpm seed sync-db')
  })

  it('gives the encryption key the thirty-two bytes the secret box needs', () => {
    expect(UP).toContain('ENCRYPTION_KEY=$(openssl rand -hex 32)')
  })

  it('never overwrites an .env that is already there', () => {
    expect(UP).toMatch(/if \[ -f \.env \]/)
  })
})
