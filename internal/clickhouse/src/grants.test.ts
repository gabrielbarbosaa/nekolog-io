import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const DEV = readFileSync(join(ROOT, 'deploy', 'clickhouse-users.dev.xml'), 'utf8')
const VM = readFileSync(join(ROOT, 'deploy', 'vm', 'clickhouse', 'users.xml.tftpl'), 'utf8')

// biome-ignore lint/suspicious/noTemplateCurlyInString: an OpenTofu placeholder, not a JS template
const ENVIRONMENT = '${environment}'
// biome-ignore lint/suspicious/noTemplateCurlyInString: an OpenTofu placeholder, not a JS template
const CONTAINER_NETWORK = '${container_network}'

const VIEW_COLUMNS = [
  'project_id',
  'environment_id',
  'timestamp',
  'received_at',
  'level',
  'service',
]

const HIDDEN_COLUMNS = ['message', 'stacktrace', 'attributes', 'user_id', 'trace_id', 'span_id']

const ROLES = ['reader', 'ingest', 'jobs'] as const

function vmUser(role: string): string {
  return `nekolog_${role}_${ENVIRONMENT}`
}

function vmDatabase(): string {
  return `nekolog_${ENVIRONMENT}`
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function grantsOf(xml: string, user: string): string[] {
  const tag = escaped(user)
  const block = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (block === null) {
    throw new Error(`there is no user called ${user}`)
  }
  return [...(block[1] ?? '').matchAll(/<query>([^<]+)<\/query>/g)].map((match) =>
    (match[1] ?? '').trim(),
  )
}

function usersOf(xml: string): string[] {
  const block = /<users>([\s\S]*)<\/users>/.exec(xml)
  return [...(block?.[1] ?? '').matchAll(/^\s{4}<([a-z_$%{][^\s>/]*)[^>]*>$/gm)].map(
    (match) => match[1] ?? '',
  )
}

describe('the ingestion credential, in both files', () => {
  it.each([
    ['dev', DEV, 'nekolog_ingest', 'nekolog_dev'],
    ['vm', VM, vmUser('ingest'), vmDatabase()],
  ])('writes logs and nothing else in %s', (_name, xml, user, database) => {
    const grants = grantsOf(xml, user)

    expect(grants).toContain(`GRANT INSERT ON ${database}.logs`)
    expect(
      grants.some((grant) => grant.startsWith('GRANT INSERT ON') && grant.endsWith('.*')),
    ).toBe(false)
  })

  it.each([
    ['dev', DEV, 'nekolog_ingest'],
    ['vm', VM, vmUser('ingest')],
  ])('reads only the columns the materialized views need in %s', (_name, xml, user) => {
    const select = grantsOf(xml, user).find((grant) => grant.startsWith('GRANT SELECT('))
    expect(select).toBeDefined()

    const columns = (/GRANT SELECT\(([^)]+)\)/.exec(select ?? '')?.[1] ?? '')
      .split(',')
      .map((column) => column.trim())

    expect([...columns].sort()).toEqual([...VIEW_COLUMNS].sort())
    for (const hidden of HIDDEN_COLUMNS) {
      expect(columns).not.toContain(hidden)
    }
  })

  it.each([
    ['dev', DEV, 'nekolog_ingest'],
    ['vm', VM, vmUser('ingest')],
  ])('never gets a table-wide SELECT in %s', (_name, xml, user) => {
    for (const grant of grantsOf(xml, user)) {
      expect(grant).not.toMatch(/GRANT[^(]*\bSELECT\b(?!\()/)
    }
  })
})

describe('the reading credential', () => {
  it.each([
    ['dev', DEV, 'nekolog_reader'],
    ['vm', VM, vmUser('reader')],
  ])('only reads in %s', (_name, xml, user) => {
    for (const grant of grantsOf(xml, user)) {
      expect(grant).not.toMatch(/\b(INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/)
    }
  })
})

describe('the migrations credential', () => {
  it('is the only one in either file allowed to change a schema', () => {
    const files: Array<[string, string[]]> = [
      [DEV, ['nekolog_reader', 'nekolog_ingest', 'nekolog_jobs']],
      [VM, ROLES.map(vmUser)],
    ]

    for (const [xml, users] of files) {
      for (const user of users) {
        for (const grant of grantsOf(xml, user)) {
          expect(grant).not.toMatch(/\b(CREATE|DROP|ALTER|TRUNCATE)\b/)
        }
      }
    }
  })

  it('cannot touch a database outside the three the platform owns, on the vm', () => {
    const grants = grantsOf(VM, 'nekolog_migrator')

    expect(grants.length).toBeGreaterThan(0)
    for (const grant of grants) {
      expect(grant.endsWith(`ON ${vmDatabase()}.*`)).toBe(true)
    }
  })

  it('may create the three databases, because nothing else is allowed to', () => {
    expect(grantsOf(VM, 'nekolog_migrator')).toContain(`GRANT CREATE DATABASE ON ${vmDatabase()}.*`)
  })
})

describe('the vm file, where the three environments share one server', () => {
  it('names every user after an environment, except the migrator and default', () => {
    const named = usersOf(VM).filter(
      (user) => user !== 'default' && user !== 'nekolog_migrator' && !user.startsWith('%'),
    )

    expect(named.length).toBeGreaterThan(0)
    for (const user of named) {
      expect(user.endsWith(ENVIRONMENT)).toBe(true)
    }
  })

  it.each(ROLES)('gives the %s of one environment no grant on another', (role) => {
    const grants = grantsOf(VM, vmUser(role))

    expect(grants.length).toBeGreaterThan(0)
    for (const grant of grants) {
      expect(grant).toContain(`ON ${vmDatabase()}.`)
      expect(grant).not.toMatch(/nekolog_(dev|qa|prod)/)
    }
  })

  it('stores password hashes, never a password', () => {
    expect(VM).not.toMatch(/<password>/)
    expect(VM).toMatch(/<password_sha256_hex>/)
  })

  it('keeps the default user on the loopback, so nothing on the network can use it', () => {
    const block = /<default[^>]*>([\s\S]*?)<\/default>/.exec(VM)?.[1] ?? ''

    expect(block).toContain('<ip>127.0.0.1</ip>')
    expect(block).not.toContain('::/0')
  })

  it('replaces the default user instead of adding a second authentication method', () => {
    expect(VM).toMatch(/<default\s+replace="replace">/)
  })

  it('lets nobody but the loopback and the container network in', () => {
    const networks = [...VM.matchAll(/<networks><ip>([^<]+)<\/ip><\/networks>/g)].map(
      (match) => match[1] ?? '',
    )

    expect(networks.length).toBeGreaterThan(1)
    for (const network of networks) {
      expect(network === '127.0.0.1' || network === CONTAINER_NETWORK).toBe(true)
    }
  })
})
