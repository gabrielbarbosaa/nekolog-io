import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ID_PREFIXES } from './index.ts'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
const DATABASE = `nekolog_test_${process.pid}`

async function answers(): Promise<boolean> {
  const admin = postgres(URL, { max: 1, idle_timeout: 1, connect_timeout: 3, onnotice: () => {} })
  try {
    await admin`select 1`
    return true
  } catch {
    return false
  } finally {
    await admin.end({ timeout: 1 })
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `POSTGRES_TEST_REQUIRED is set but nothing answered at ${URL}. ` +
        'These tests must not be skipped here.',
    )
  }
  process.stderr.write(
    `\nSkipping Postgres integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

function migrationStatements(): string[] {
  const directory = join(PACKAGE, 'migrations')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(directory, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let counter = 0

function id(prefix: string): string {
  counter += 1
  let suffix = ''
  for (let position = 0; position < 26; position += 1) {
    suffix += CROCKFORD[(counter * 7 + position * 13) % 32]
  }
  return `${prefix}${suffix}`
}

class Rollback extends Error {}

let sql: postgres.Sql

beforeAll(async () => {
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${DATABASE}"`)
  } finally {
    await admin.end()
  }

  sql = postgres(URL.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 1, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }
})

afterAll(async () => {
  await sql?.end()
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end()
  }
})

async function inRollback(work: (tx: postgres.TransactionSql) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await work(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error
    }
  }
}

async function organization(tx: postgres.TransactionSql, name = 'Acme'): Promise<string> {
  const value = id(ID_PREFIXES.organization)
  await tx`insert into organizations ${tx({ id: value, name })}`
  return value
}

async function project(tx: postgres.TransactionSql, organizationId: string): Promise<string> {
  const value = id(ID_PREFIXES.project)
  await tx`insert into projects ${tx({ id: value, organization_id: organizationId, name: 'web' })}`
  return value
}

async function environment(
  tx: postgres.TransactionSql,
  projectId: string,
  name = 'production',
): Promise<string> {
  const value = id(ID_PREFIXES.environment)
  await tx`insert into environments ${tx({ id: value, project_id: projectId, name })}`
  return value
}

const HASH = 'a'.repeat(64)

describe.skipIf(!reachable)('the migration this package ships', () => {
  it('creates every table the plan names', async () => {
    const rows = await sql<Array<{ table_name: string }>>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `

    expect(rows.map((row) => row.table_name)).toEqual([
      'api_keys',
      'audit_log',
      'environments',
      'invites',
      'memberships',
      'organizations',
      'projects',
      'users',
    ])
  })
})

type Insert = (tx: postgres.TransactionSql, badId: string) => Promise<void>

const TABLES: Array<[string, string, Insert]> = [
  [
    'organizations',
    ID_PREFIXES.organization,
    async (tx, badId) => {
      await tx`insert into organizations ${tx({ id: badId, name: 'Acme' })}`
    },
  ],
  [
    'users',
    ID_PREFIXES.user,
    async (tx, badId) => {
      await tx`insert into users ${tx({
        id: badId,
        name: 'Ada',
        email: 'ada@example.com',
        password_hash: 'argon2id$x',
      })}`
    },
  ],
  [
    'projects',
    ID_PREFIXES.project,
    async (tx, badId) => {
      await tx`insert into projects ${tx({
        id: badId,
        organization_id: await organization(tx),
        name: 'web',
      })}`
    },
  ],
  [
    'environments',
    ID_PREFIXES.environment,
    async (tx, badId) => {
      await tx`insert into environments ${tx({
        id: badId,
        project_id: await project(tx, await organization(tx)),
        name: 'production',
      })}`
    },
  ],
  [
    'api_keys',
    ID_PREFIXES.apiKey,
    async (tx, badId) => {
      await tx`insert into api_keys ${tx({
        id: badId,
        environment_id: await environment(tx, await project(tx, await organization(tx))),
        kind: 'secret',
        hash: 'a'.repeat(64),
        hint: '…aBc1',
        scopes: ['logs:write'],
      })}`
    },
  ],
  [
    'memberships',
    ID_PREFIXES.membership,
    async (tx, badId) => {
      const userId = id(ID_PREFIXES.user)
      await tx`insert into users ${tx({
        id: userId,
        name: 'Ada',
        email: 'ada@example.com',
        password_hash: 'argon2id$x',
      })}`
      await tx`insert into memberships ${tx({
        id: badId,
        organization_id: await organization(tx),
        user_id: userId,
        role: 'member',
      })}`
    },
  ],
  [
    'invites',
    ID_PREFIXES.invite,
    async (tx, badId) => {
      await tx`insert into invites ${tx({
        id: badId,
        organization_id: await organization(tx),
        email: 'ada@example.com',
        role: 'member',
        token_hash: 'b'.repeat(64),
        expires_at: new Date(Date.now() + 86_400_000),
      })}`
    },
  ],
  [
    'audit_log',
    ID_PREFIXES.auditEntry,
    async (tx, badId) => {
      await tx`insert into audit_log ${tx({
        id: badId,
        organization_id: await organization(tx),
        action: 'member.invited',
        target_type: 'invite',
      })}`
    },
  ],
]

describe.skipIf(!reachable)('an id that is not shaped like one', () => {
  it.each(TABLES)('is refused by %s when it carries no ULID', async (table, _prefix, insert) => {
    await expect(
      inRollback(async (tx) => {
        await insert(tx, `${_prefix}NOTAULID`)
      }),
    ).rejects.toThrow(new RegExp(`${table}_id_shape`))
  })

  it.each(TABLES)(
    'is refused by %s when it carries another table prefix',
    async (table, prefix, insert) => {
      const other =
        prefix === ID_PREFIXES.organization ? ID_PREFIXES.project : ID_PREFIXES.organization

      await expect(
        inRollback(async (tx) => {
          await insert(tx, id(other))
        }),
      ).rejects.toThrow(new RegExp(`${table}_id_shape`))
    },
  )
})

describe.skipIf(!reachable)('the e-mail of a user', () => {
  it('cannot be stored with a capital letter', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into users ${tx({
          id: id(ID_PREFIXES.user),
          name: 'Ada',
          email: 'Ada@example.com',
          password_hash: 'argon2id$x',
        })}`
      }),
    ).rejects.toThrow(/users_email_is_lowercase/)
  })

  it('cannot repeat, so two accounts never share one', async () => {
    await expect(
      inRollback(async (tx) => {
        for (const _ of [1, 2]) {
          await tx`insert into users ${tx({
            id: id(ID_PREFIXES.user),
            name: 'Ada',
            email: 'ada@example.com',
            password_hash: 'argon2id$x',
          })}`
        }
      }),
    ).rejects.toThrow(/users_email_key/)
  })
})

describe.skipIf(!reachable)('an environment', () => {
  it('cannot repeat a name inside one project', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        await environment(tx, projectId)
        await environment(tx, projectId)
      }),
    ).rejects.toThrow(/environments_one_name_per_project/)
  })

  it('may reuse a name in another project', async () => {
    await inRollback(async (tx) => {
      const organizationId = await organization(tx)
      await environment(tx, await project(tx, organizationId))
      await environment(tx, await project(tx, organizationId))
    })
  })

  it('cannot keep logs for less than a day', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        await tx`insert into environments ${tx({
          id: id(ID_PREFIXES.environment),
          project_id: projectId,
          name: 'production',
          retention_days: 0,
        })}`
      }),
    ).rejects.toThrow(/environments_retention_is_at_least_a_day/)
  })
})

describe.skipIf(!reachable)('an API key', () => {
  it('stores a SHA-256 hash and refuses anything else', async () => {
    await expect(
      inRollback(async (tx) => {
        const environmentId = await environment(tx, await project(tx, await organization(tx)))
        await tx`insert into api_keys ${tx({
          id: id(ID_PREFIXES.apiKey),
          environment_id: environmentId,
          kind: 'secret',
          hash: 'nekolog_sk_this_is_the_key_itself',
          hint: '…aBc1',
          scopes: ['logs:write'],
        })}`
      }),
    ).rejects.toThrow(/api_keys_hash_is_sha256_hex/)
  })

  it('cannot carry a scope nobody defined', async () => {
    await expect(
      inRollback(async (tx) => {
        const environmentId = await environment(tx, await project(tx, await organization(tx)))
        await tx`insert into api_keys ${tx({
          id: id(ID_PREFIXES.apiKey),
          environment_id: environmentId,
          kind: 'secret',
          hash: HASH,
          hint: '…aBc1',
          scopes: ['logs:write', 'logs:delete'],
        })}`
      }),
    ).rejects.toThrow(/api_keys_scopes_are_known/)
  })

  it('cannot be public and read logs, which is the whole point of the two kinds', async () => {
    await expect(
      inRollback(async (tx) => {
        const environmentId = await environment(tx, await project(tx, await organization(tx)))
        await tx`insert into api_keys ${tx({
          id: id(ID_PREFIXES.apiKey),
          environment_id: environmentId,
          kind: 'public',
          hash: HASH,
          hint: '…aBc1',
          scopes: ['logs:write', 'logs:read'],
        })}`
      }),
    ).rejects.toThrow(/api_keys_public_only_writes/)
  })

  it('cannot share a hash with another key, in any environment', async () => {
    await expect(
      inRollback(async (tx) => {
        const organizationId = await organization(tx)
        for (const name of ['production', 'staging']) {
          const environmentId = await environment(tx, await project(tx, organizationId), name)
          await tx`insert into api_keys ${tx({
            id: id(ID_PREFIXES.apiKey),
            environment_id: environmentId,
            kind: 'secret',
            hash: HASH,
            hint: '…aBc1',
            scopes: ['logs:write'],
          })}`
        }
      }),
    ).rejects.toThrow(/api_keys_hash_key/)
  })
})

describe.skipIf(!reachable)('an invite', () => {
  function row(organizationId: string, email: string, extra: Record<string, unknown> = {}) {
    return {
      id: id(ID_PREFIXES.invite),
      organization_id: organizationId,
      email,
      role: 'member',
      token_hash: HASH.replace('a', 'b') + String(counter),
      expires_at: new Date(Date.now() + 86_400_000),
      ...extra,
    }
  }

  it('cannot hand out ownership, which only a transfer does', async () => {
    await expect(
      inRollback(async (tx) => {
        const organizationId = await organization(tx)
        await tx`insert into invites ${tx(row(organizationId, 'ada@example.com', { role: 'owner' }))}`
      }),
    ).rejects.toThrow(/invites_role_is_not_owner/)
  })

  it('cannot be open twice for the same address in one organization', async () => {
    await expect(
      inRollback(async (tx) => {
        const organizationId = await organization(tx)
        await tx`insert into invites ${tx(row(organizationId, 'ada@example.com'))}`
        await tx`insert into invites ${tx(row(organizationId, 'ada@example.com'))}`
      }),
    ).rejects.toThrow(/invites_one_open_per_email_and_organization/)
  })

  it('may be sent again once the first one is revoked', async () => {
    await inRollback(async (tx) => {
      const organizationId = await organization(tx)
      await tx`insert into invites ${tx(
        row(organizationId, 'ada@example.com', { revoked_at: new Date() }),
      )}`
      await tx`insert into invites ${tx(row(organizationId, 'ada@example.com'))}`
    })
  })

  it('cannot expire before it was created', async () => {
    await expect(
      inRollback(async (tx) => {
        const organizationId = await organization(tx)
        await tx`insert into invites ${tx(
          row(organizationId, 'ada@example.com', { expires_at: new Date(Date.now() - 1000) }),
        )}`
      }),
    ).rejects.toThrow(/invites_expire_after_they_are_created/)
  })
})

describe.skipIf(!reachable)('what deleting takes with it', () => {
  it('removes a project, its environments and their keys with the organization', async () => {
    await inRollback(async (tx) => {
      const organizationId = await organization(tx)
      const environmentId = await environment(tx, await project(tx, organizationId))
      await tx`insert into api_keys ${tx({
        id: id(ID_PREFIXES.apiKey),
        environment_id: environmentId,
        kind: 'secret',
        hash: HASH,
        hint: '…aBc1',
        scopes: ['logs:write'],
      })}`

      await tx`delete from organizations where id = ${organizationId}`

      const left = await tx<Array<{ count: string }>>`
        select
          (select count(*) from projects) +
          (select count(*) from environments) +
          (select count(*) from api_keys) as count
      `
      expect(left[0]?.count).toBe('0')
    })
  })

  it('keeps the audit entry when the user who caused it is deleted', async () => {
    await inRollback(async (tx) => {
      const organizationId = await organization(tx)
      const userId = id(ID_PREFIXES.user)
      await tx`insert into users ${tx({
        id: userId,
        name: 'Ada',
        email: 'ada@example.com',
        password_hash: 'argon2id$x',
      })}`
      const entryId = id(ID_PREFIXES.auditEntry)
      await tx`insert into audit_log ${tx({
        id: entryId,
        organization_id: organizationId,
        actor_user_id: userId,
        action: 'api_key.revoked',
        target_type: 'api_key',
      })}`

      await tx`delete from users where id = ${userId}`

      const rows = await tx<Array<{ actor_user_id: string | null }>>`
        select actor_user_id from audit_log where id = ${entryId}
      `
      expect(rows).toHaveLength(1)
      expect(rows[0]?.actor_user_id).toBeNull()
    })
  })
})

describe.skipIf(!reachable)('the audit log', () => {
  it('records a country, never an address', async () => {
    await expect(
      inRollback(async (tx) => {
        const organizationId = await organization(tx)
        await tx`insert into audit_log ${tx({
          id: id(ID_PREFIXES.auditEntry),
          organization_id: organizationId,
          action: 'member.invited',
          target_type: 'invite',
          country: '203.0.113.7',
        })}`
      }),
    ).rejects.toThrow(/audit_log_country_is_a_code/)
  })
})
