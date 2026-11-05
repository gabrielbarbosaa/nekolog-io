import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKUP_PREFIX } from '@internal/backup'
import { BACKUP_KEY_PREFIX } from '@nekolog-io/clickhouse/backup'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8')
}

const CADDYFILE = read('deploy', 'self-host', 'Caddyfile')
const VPS_VARIABLES = read('infra', 'vps', 'variables.tf')
const BUCKET_VARIABLES = read('infra', 'modules', 'backup-bucket', 'variables.tf')
const BUCKET_MAIN = read('infra', 'modules', 'backup-bucket', 'main.tf')
const WORKFLOW = read('.github', 'workflows', 'infra.yml')

const SITE = /^(?:([a-z0-9][a-z0-9-]*)\.)?\{\$NEKOLOG_DOMAIN\}\s*\{$/gm
const DECLARED_HOST = /^\s*"?(@|[a-z0-9][a-z0-9-]*)"?\s*=\s*\{\s*proxied\s*=/gm

function hostsCaddyAnswersOn(): string[] {
  return [...CADDYFILE.matchAll(SITE)].map((match) => match[1] ?? '@').sort()
}

function hostsDnsPublishes(): string[] {
  const block = /default = \{([\s\S]*?)\n {2}\}/.exec(VPS_VARIABLES)?.[1] ?? ''
  return [...block.matchAll(DECLARED_HOST)].map((match) => match[1] as string).sort()
}

function defaultOf(variables: string, name: string): string {
  const block = new RegExp(`variable "${name}" \\{([\\s\\S]*?)\\n\\}`).exec(variables)?.[1] ?? ''
  return /default\s*=\s*"?([^"\n]+)"?/.exec(block)?.[1]?.trim() ?? ''
}

function rootDirectories(): string[] {
  return readdirSync(join(ROOT, 'infra'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'modules')
    .map((entry) => entry.name)
    .sort()
}

describe('the names the machine answers on', () => {
  it('publishes a record for every site the proxy serves, and no name it does not', () => {
    const caddy = hostsCaddyAnswersOn()

    expect(caddy.length).toBeGreaterThan(0)
    expect(hostsDnsPublishes()).toEqual(caddy)
  })

  it('stands Cloudflare in front of all of them, which is what replaces the old edge', () => {
    const block = /default = \{([\s\S]*?)\n {2}\}/.exec(VPS_VARIABLES)?.[1] ?? ''

    expect(block).not.toContain('proxied = false')
  })
})

describe('the bucket the backups go to', () => {
  it('expires exactly the prefix ClickHouse writes under', () => {
    expect(defaultOf(BUCKET_VARIABLES, 'clickhouse_prefix')).toBe(BACKUP_KEY_PREFIX)
  })

  it('leaves the Postgres prefix alone, because the backup container deletes its own', () => {
    expect(BACKUP_PREFIX).not.toBe(BACKUP_KEY_PREFIX)
    expect(BUCKET_MAIN).not.toContain(BACKUP_PREFIX)
  })

  it('carries one rule, so there is one retention and not two', () => {
    expect([...BUCKET_MAIN.matchAll(/^\s{6}id\s*=/gm)]).toHaveLength(1)
  })

  it('refuses to be destroyed by a plan nobody read', () => {
    expect(BUCKET_MAIN).toContain('prevent_destroy = true')
  })
})

describe('the workflow and the roots on disk', () => {
  const roots = rootDirectories()

  it('validates every root there is', () => {
    for (const root of roots) {
      expect(WORKFLOW, `infra/${root} is never validated`).toContain(`infra/${root}`)
    }
  })

  it('plans and applies every root there is', () => {
    const planned = /root: \[([^\]]+)\]/.exec(WORKFLOW)?.[1] ?? ''
    const applied = /for root in ([a-z ]+); do/.exec(WORKFLOW)?.[1] ?? ''

    expect(
      planned
        .split(',')
        .map((name) => name.trim())
        .sort(),
    ).toEqual(roots)
    expect(applied.split(' ').filter(Boolean).sort()).toEqual(roots)
  })

  it('names no root that is not there', () => {
    expect(roots.length).toBeGreaterThan(0)
    for (const root of roots) {
      expect(readdirSync(join(ROOT, 'infra', root))).toContain('backend.tf')
    }
  })
})
