import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const DEV = readFileSync(join(ROOT, 'deploy', 'clickhouse-users.dev.xml'), 'utf8')
const VM = readFileSync(join(ROOT, 'deploy', 'vm', 'clickhouse', 'users.xml.tftpl'), 'utf8')
const SELF_HOST = readFileSync(join(ROOT, 'deploy', 'self-host', 'clickhouse-users.xml'), 'utf8')

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

const WRITE_S3 = 'GRANT WRITE ON S3'
const TEMPORARY_TABLE = 'GRANT CREATE TEMPORARY TABLE ON *.*'
const READ_DISKS = 'GRANT SELECT ON system.disks'
const READ_BACKUPS = 'GRANT SELECT ON system.backups'
const GLOBAL_GRANTS = [WRITE_S3, TEMPORARY_TABLE, READ_DISKS, READ_BACKUPS]

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
    ['self-host', SELF_HOST, 'nekolog_ingest', 'nekolog'],
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
    ['self-host', SELF_HOST, 'nekolog_ingest'],
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
    ['self-host', SELF_HOST, 'nekolog_ingest'],
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
    ['self-host', SELF_HOST, 'nekolog_reader'],
  ])('only reads in %s', (_name, xml, user) => {
    for (const grant of grantsOf(xml, user)) {
      expect(grant).not.toMatch(/\b(INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/)
    }
  })
})

describe('the credential the public read API runs as', () => {
  it.each([
    ['dev', DEV, 'nekolog_reader', 'nekolog_dev'],
    ['vm', VM, vmUser('reader'), vmDatabase()],
    ['self-host', SELF_HOST, 'nekolog_reader', 'nekolog'],
  ])('can read every column of its own database in %s', (_name, xml, user, database) => {
    expect(grantsOf(xml, user)).toContain(`GRANT SELECT ON ${database}.*`)
  })

  it.each([
    ['dev', DEV, 'nekolog_reader'],
    ['vm', VM, vmUser('reader')],
    ['self-host', SELF_HOST, 'nekolog_reader'],
  ])('reaches no object store and no system table in %s', (_name, xml, user) => {
    for (const grant of grantsOf(xml, user)) {
      for (const global of GLOBAL_GRANTS) {
        expect(grant).not.toBe(global)
      }
      expect(grant).not.toContain(' ON S3')
      expect(grant).not.toContain('system.')
      expect(grant).not.toContain(' ON *.*')
    }
  })

  it.each([
    ['dev', DEV, 'nekolog_reader', 'nekolog_dev'],
    ['self-host', SELF_HOST, 'nekolog_reader', 'nekolog'],
  ])('is scoped to one database in %s, never to the server', (_name, xml, user, database) => {
    for (const grant of grantsOf(xml, user)) {
      expect(grant).toContain(`${database}.`)
    }
  })

  it.each(['dev', 'qa', 'prod'])(
    'cannot reach another environment on the shared machine, from %s',
    (environment) => {
      const rendered = VM.replaceAll(ENVIRONMENT, environment)
      const grants = grantsOf(rendered, `nekolog_reader_${environment}`)

      expect(grants).toContain(`GRANT SELECT ON nekolog_${environment}.*`)
      for (const other of ['dev', 'qa', 'prod'].filter((one) => one !== environment)) {
        expect(grants.join(' ')).not.toContain(`nekolog_${other}`)
      }
    },
  )
})

describe('the migrations credential', () => {
  it('is the only one in any file allowed to change a schema', () => {
    const files: Array<[string, string[]]> = [
      [DEV, ['nekolog_reader', 'nekolog_ingest', 'nekolog_jobs']],
      [VM, ROLES.map(vmUser)],
      [SELF_HOST, ['nekolog_reader', 'nekolog_ingest', 'nekolog_jobs']],
    ]

    for (const [xml, users] of files) {
      for (const user of users) {
        for (const grant of grantsOf(xml, user)) {
          if (grant === TEMPORARY_TABLE) {
            continue
          }
          expect(grant).not.toMatch(/\b(CREATE|DROP|ALTER|TRUNCATE)\b/)
        }
      }
    }
  })

  it('is the only exception, and it is the one a table function needs to exist at all', () => {
    const files: Array<[string, string[], boolean]> = [
      [DEV, ['nekolog_reader', 'nekolog_ingest', 'nekolog_jobs'], true],
      [VM, ROLES.map(vmUser), true],
      [SELF_HOST, ['nekolog_reader', 'nekolog_ingest', 'nekolog_jobs'], false],
    ]

    for (const [xml, users, exports] of files) {
      for (const user of users) {
        const creating = grantsOf(xml, user).filter((grant) => grant.includes('CREATE'))
        expect(creating).toEqual(exports && user.includes('jobs') ? [TEMPORARY_TABLE] : [])
      }
    }
  })
})

describe('the export credential, which is the jobs one', () => {
  it.each([
    ['dev', DEV, 'nekolog_jobs'],
    ['vm', VM, vmUser('jobs')],
  ])('may write an export to S3 and may never read one back, in %s', (_name, xml, user) => {
    const grants = grantsOf(xml, user)

    expect(grants).toContain(WRITE_S3)
    expect(grants).not.toContain('GRANT READ ON S3')
    for (const grant of grants) {
      expect(grant).not.toMatch(/\bREAD ON\b/)
    }
  })

  it.each([
    ['dev', DEV, ['nekolog_reader', 'nekolog_ingest']],
    ['vm', VM, [vmUser('reader'), vmUser('ingest')]],
  ])('is the only credential in %s that can reach an object store at all', (_name, xml, users) => {
    for (const user of users) {
      for (const grant of grantsOf(xml, user)) {
        expect(grant).not.toContain('ON S3')
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

describe('the capacity reading, which is the one thing outside the platform database', () => {
  it.each([
    ['dev', DEV, 'nekolog_jobs'],
    ['vm', VM, vmUser('jobs')],
    ['self-host', SELF_HOST, 'nekolog_jobs'],
  ])('lets the jobs credential read system.disks in %s', (_name, xml, user) => {
    expect(grantsOf(xml, user)).toContain(READ_DISKS)
  })

  it.each([
    ['dev', DEV, ['nekolog_reader', 'nekolog_ingest']],
    ['vm', VM, [vmUser('reader'), vmUser('ingest')]],
    ['self-host', SELF_HOST, ['nekolog_reader', 'nekolog_ingest']],
  ])('gives nobody else in %s anything on system', (_name, xml, users) => {
    for (const user of users) {
      for (const grant of grantsOf(xml, user)) {
        expect(grant).not.toContain('system.')
      }
    }
  })

  it.each([
    ['dev', DEV, 'nekolog_jobs'],
    ['vm', VM, vmUser('jobs')],
    ['self-host', SELF_HOST, 'nekolog_jobs'],
  ])('reads that one table and no other part of system in %s', (_name, xml, user) => {
    const onSystem = grantsOf(xml, user).filter((grant) => grant.includes('system'))
    expect(onSystem).toEqual([READ_DISKS])
  })
})

describe('the backup credential, which may write a copy and may not read one row', () => {
  it.each([
    ['dev', DEV, 'nekolog_dev'],
    ['self-host', SELF_HOST, 'nekolog'],
  ])('holds exactly the three grants a backup needs in %s', (_name, xml, database) => {
    expect([...grantsOf(xml, 'nekolog_backup')].sort()).toEqual(
      [`GRANT BACKUP ON ${database}.*`, WRITE_S3, READ_BACKUPS].sort(),
    )
  })

  it.each([
    ['dev', DEV],
    ['self-host', SELF_HOST],
  ])('cannot read, write or change a single row in %s', (_name, xml) => {
    for (const grant of grantsOf(xml, 'nekolog_backup')) {
      if (grant === READ_BACKUPS) {
        continue
      }
      expect(grant).not.toMatch(/\b(SELECT|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/)
    }
  })

  it.each([
    ['dev', DEV],
    ['self-host', SELF_HOST],
  ])('reads one system table and no other part of system in %s', (_name, xml) => {
    const onSystem = grantsOf(xml, 'nekolog_backup').filter((grant) => grant.includes('system'))
    expect(onSystem).toEqual([READ_BACKUPS])
  })

  it('is not on the vm, because that deployment is not the one being built', () => {
    expect(usersOf(VM)).not.toContain('nekolog_backup')
    expect(VM).not.toContain('BACKUP ON')
  })
})

describe('the self-host file, where one box runs the whole platform', () => {
  it('names one database, because self-host has no second environment to leak into', () => {
    for (const user of [
      'nekolog_reader',
      'nekolog_ingest',
      'nekolog_jobs',
      'nekolog_backup',
      'nekolog_migrator',
    ]) {
      const grants = grantsOf(SELF_HOST, user)

      expect(grants.length).toBeGreaterThan(0)
      for (const grant of grants) {
        if (GLOBAL_GRANTS.includes(grant)) {
          continue
        }
        expect(grant).toMatch(/ON nekolog\./)
        expect(grant).not.toMatch(/nekolog_(dev|qa|prod)/)
      }
    }
  })

  it('lets nobody but the backup credential reach an object store, since nothing here exports', () => {
    for (const user of ['nekolog_reader', 'nekolog_ingest', 'nekolog_jobs', 'nekolog_migrator']) {
      for (const grant of grantsOf(SELF_HOST, user)) {
        expect(grant).not.toContain('ON S3')
      }
    }
    expect(grantsOf(SELF_HOST, 'nekolog_backup')).toContain(WRITE_S3)
  })

  it('keeps the migrator inside the platform database, unlike a database-wide grant', () => {
    for (const grant of grantsOf(SELF_HOST, 'nekolog_migrator')) {
      expect(grant.endsWith('ON nekolog.*')).toBe(true)
    }
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
      if (GLOBAL_GRANTS.includes(grant)) {
        continue
      }
      expect(grant).toContain(`ON ${vmDatabase()}.`)
      expect(grant).not.toMatch(/nekolog_(dev|qa|prod)/)
    }
  })

  it('keeps the grants that cannot name a database down to the jobs role', () => {
    const jobsGlobals = [WRITE_S3, TEMPORARY_TABLE, READ_DISKS]

    for (const role of ROLES) {
      const global = grantsOf(VM, vmUser(role)).filter((grant) => GLOBAL_GRANTS.includes(grant))
      expect(global.sort()).toEqual(role === 'jobs' ? [...jobsGlobals].sort() : [])
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
