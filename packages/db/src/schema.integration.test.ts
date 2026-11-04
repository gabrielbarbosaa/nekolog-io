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
      'alert_channels',
      'alert_rules',
      'api_keys',
      'audit_log',
      'dashboards',
      'email_suppressions',
      'environments',
      'export_schedules',
      'exports',
      'invites',
      'issue_environments',
      'issues',
      'memberships',
      'organizations',
      'projects',
      'releases',
      'saved_views',
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
    'email_suppressions',
    ID_PREFIXES.emailSuppression,
    async (tx, badId) => {
      await tx`insert into email_suppressions ${tx({
        id: badId,
        address: 'ada@example.test',
        reason: 'bounce',
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
  [
    'saved_views',
    ID_PREFIXES.savedView,
    async (tx, badId) => {
      await tx`insert into saved_views ${tx({
        id: badId,
        project_id: await project(tx, await organization(tx)),
        name: 'Errors today',
      })}`
    },
  ],
  [
    'dashboards',
    ID_PREFIXES.dashboard,
    async (tx, badId) => {
      await tx`insert into dashboards ${tx({
        id: badId,
        project_id: await project(tx, await organization(tx)),
        name: 'Overview',
      })}`
    },
  ],
  [
    'releases',
    ID_PREFIXES.release,
    async (tx, badId) => {
      const projectId = await project(tx, await organization(tx))
      await tx`insert into releases ${tx({
        id: badId,
        project_id: projectId,
        environment_id: await environment(tx, projectId),
        version: '1.4.2',
      })}`
    },
  ],
  [
    'export_schedules',
    ID_PREFIXES.exportSchedule,
    async (tx, badId) => {
      const projectId = await project(tx, await organization(tx))
      await tx`insert into export_schedules ${tx({
        id: badId,
        project_id: projectId,
        environment_id: await environment(tx, projectId),
        cadence: 'daily',
        format: 'csv',
      })}`
    },
  ],
  [
    'issues',
    ID_PREFIXES.issue,
    async (tx, badId) => {
      await tx`insert into issues ${tx({
        id: badId,
        project_id: await project(tx, await organization(tx)),
        fingerprint: '42',
        title: 'boom',
        first_seen_at: new Date(),
        last_seen_at: new Date(),
      })}`
    },
  ],
  [
    'exports',
    ID_PREFIXES.export,
    async (tx, badId) => {
      const projectId = await project(tx, await organization(tx))
      await tx`insert into exports ${tx({
        id: badId,
        project_id: projectId,
        environment_id: await environment(tx, projectId),
        format: 'csv',
        range_from: new Date(Date.now() - 3_600_000),
        range_to: new Date(),
        expires_at: new Date(Date.now() + 7 * 86_400_000),
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

describe.skipIf(!reachable)('a suppressed address', () => {
  it('is stored lowercased, so the same mailbox is not suppressed twice', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into email_suppressions ${tx({
          id: id(ID_PREFIXES.emailSuppression),
          address: 'Ada@Example.test',
          reason: 'bounce',
        })}`
      }),
    ).rejects.toThrow(/email_suppressions_address_is_lowercase/)
  })

  it('cannot be recorded twice, however many times it bounces', async () => {
    await expect(
      inRollback(async (tx) => {
        for (const reason of ['bounce', 'complaint']) {
          await tx`insert into email_suppressions ${tx({
            id: id(ID_PREFIXES.emailSuppression),
            address: 'ada@example.test',
            reason,
          })}`
        }
      }),
    ).rejects.toThrow(/email_suppressions_address/)
  })

  it('has to be an address, not a name', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into email_suppressions ${tx({
          id: id(ID_PREFIXES.emailSuppression),
          address: 'ada',
          reason: 'bounce',
        })}`
      }),
    ).rejects.toThrow(/email_suppressions_address_has_one_at/)
  })

  it('cannot carry a reason nobody defined', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into email_suppressions ${tx({
          id: id(ID_PREFIXES.emailSuppression),
          address: 'ada@example.test',
          reason: 'because',
        })}`
      }),
    ).rejects.toThrow()
  })
})

describe.skipIf(!reachable)('a row that names a project and an environment', () => {
  async function twoProjects(tx: postgres.TransactionSql): Promise<[string, string]> {
    const organizationId = await organization(tx)
    const mine = await project(tx, organizationId)
    const theirs = await project(tx, organizationId)
    return [mine, await environment(tx, theirs)]
  }

  it('cannot borrow an environment from another project, on saved_views', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, otherEnvironmentId] = await twoProjects(tx)
        await tx`insert into saved_views ${tx({
          id: id(ID_PREFIXES.savedView),
          project_id: projectId,
          environment_id: otherEnvironmentId,
          name: 'Errors today',
        })}`
      }),
    ).rejects.toThrow(/saved_views_environment_belongs_to_the_project/)
  })

  it('cannot borrow an environment from another project, on releases', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, otherEnvironmentId] = await twoProjects(tx)
        await tx`insert into releases ${tx({
          id: id(ID_PREFIXES.release),
          project_id: projectId,
          environment_id: otherEnvironmentId,
          version: '1.4.2',
        })}`
      }),
    ).rejects.toThrow(/releases_environment_belongs_to_the_project/)
  })

  it('cannot borrow an environment from another project, on exports', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, otherEnvironmentId] = await twoProjects(tx)
        await tx`insert into exports ${tx({
          id: id(ID_PREFIXES.export),
          project_id: projectId,
          environment_id: otherEnvironmentId,
          format: 'csv',
          range_from: new Date(Date.now() - 3_600_000),
          range_to: new Date(),
          expires_at: new Date(Date.now() + 7 * 86_400_000),
        })}`
      }),
    ).rejects.toThrow(/exports_environment_belongs_to_the_project/)
  })

  it('cannot borrow an environment from another project, on export_schedules', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, otherEnvironmentId] = await twoProjects(tx)
        await tx`insert into export_schedules ${tx({
          id: id(ID_PREFIXES.exportSchedule),
          project_id: projectId,
          environment_id: otherEnvironmentId,
          cadence: 'daily',
          format: 'csv',
        })}`
      }),
    ).rejects.toThrow(/export_schedules_environment_belongs_to_the_project/)
  })

  it('accepts the environment that really is the projects own', async () => {
    await inRollback(async (tx) => {
      const projectId = await project(tx, await organization(tx))
      await tx`insert into releases ${tx({
        id: id(ID_PREFIXES.release),
        project_id: projectId,
        environment_id: await environment(tx, projectId),
        version: '1.4.2',
      })}`
    })
  })

  it('goes away when the environment does', async () => {
    await inRollback(async (tx) => {
      const projectId = await project(tx, await organization(tx))
      const environmentId = await environment(tx, projectId)
      await tx`insert into releases ${tx({
        id: id(ID_PREFIXES.release),
        project_id: projectId,
        environment_id: environmentId,
        version: '1.4.2',
      })}`

      await tx`delete from environments where id = ${environmentId}`

      const left = await tx`select count(*)::int as n from releases`
      expect(left[0]?.n).toBe(0)
    })
  })
})

describe.skipIf(!reachable)('an export', () => {
  async function place(tx: postgres.TransactionSql): Promise<[string, string]> {
    const projectId = await project(tx, await organization(tx))
    return [projectId, await environment(tx, projectId)]
  }

  function row(projectId: string, environmentId: string, extra: Record<string, unknown> = {}) {
    return {
      id: id(ID_PREFIXES.export),
      project_id: projectId,
      environment_id: environmentId,
      format: 'csv',
      range_from: new Date(Date.now() - 3_600_000),
      range_to: new Date(),
      expires_at: new Date(Date.now() + 7 * 86_400_000),
      ...extra,
    }
  }

  it('cannot say it is ready without an object to download', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        await tx`insert into exports ${tx(row(projectId, environmentId, { status: 'ready' }))}`
      }),
    ).rejects.toThrow(/exports_ready_means_there_is_an_object/)
  })

  it('cannot say it failed without saying why', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        await tx`insert into exports ${tx(row(projectId, environmentId, { status: 'failed' }))}`
      }),
    ).rejects.toThrow(/exports_failed_means_there_is_a_reason/)
  })

  it('cannot cover a period that ends before it starts', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        await tx`insert into exports ${tx(
          row(projectId, environmentId, {
            range_from: new Date(),
            range_to: new Date(Date.now() - 3_600_000),
          }),
        )}`
      }),
    ).rejects.toThrow(/exports_range_moves_forward/)
  })

  it('cannot expire before it was asked for', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        await tx`insert into exports ${tx(
          row(projectId, environmentId, { expires_at: new Date(Date.now() - 1000) }),
        )}`
      }),
    ).rejects.toThrow(/exports_expire_after_they_are_asked_for/)
  })

  it('cannot point outside the exports prefix', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        await tx`insert into exports ${tx(
          row(projectId, environmentId, { status: 'ready', object_key: 'sourcemaps/secret.map' }),
        )}`
      }),
    ).rejects.toThrow(/exports_object_key_stays_inside_the_prefix/)
  })

  it('cannot climb out of the prefix with a dot dot', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        await tx`insert into exports ${tx(
          row(projectId, environmentId, {
            status: 'ready',
            object_key: 'exports/../sourcemaps/secret.map',
          }),
        )}`
      }),
    ).rejects.toThrow(/exports_object_key_has_no_dot_dot/)
  })

  it('is accepted when it is ready and the key is where it belongs', async () => {
    await inRollback(async (tx) => {
      const [projectId, environmentId] = await place(tx)
      await tx`insert into exports ${tx(
        row(projectId, environmentId, {
          status: 'ready',
          object_key: 'exports/prj_1/2026-11-03/abc.csv.gz',
          byte_size: 1024,
          row_count: 10,
        }),
      )}`
    })
  })

  it('keeps its row when the schedule that asked for it is deleted', async () => {
    await inRollback(async (tx) => {
      const [projectId, environmentId] = await place(tx)
      const scheduleId = id(ID_PREFIXES.exportSchedule)
      await tx`insert into export_schedules ${tx({
        id: scheduleId,
        project_id: projectId,
        environment_id: environmentId,
        cadence: 'daily',
        format: 'csv',
      })}`
      await tx`insert into exports ${tx(row(projectId, environmentId, { schedule_id: scheduleId }))}`

      await tx`delete from export_schedules where id = ${scheduleId}`

      const left = await tx`select schedule_id from exports`
      expect(left.length).toBe(1)
      expect(left[0]?.schedule_id).toBe(null)
    })
  })
})

describe.skipIf(!reachable)('a release', () => {
  it('cannot repeat a version inside one environment', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        const environmentId = await environment(tx, projectId)
        for (const _ of [1, 2]) {
          await tx`insert into releases ${tx({
            id: id(ID_PREFIXES.release),
            project_id: projectId,
            environment_id: environmentId,
            version: '1.4.2',
          })}`
        }
      }),
    ).rejects.toThrow(/releases_one_version_per_environment/)
  })

  it('may carry the same version in another environment', async () => {
    await inRollback(async (tx) => {
      const projectId = await project(tx, await organization(tx))
      for (const name of ['production', 'staging']) {
        await tx`insert into releases ${tx({
          id: id(ID_PREFIXES.release),
          project_id: projectId,
          environment_id: await environment(tx, projectId, name),
          version: '1.4.2',
        })}`
      }
    })
  })

  it('cannot carry a version with space around it', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        await tx`insert into releases ${tx({
          id: id(ID_PREFIXES.release),
          project_id: projectId,
          environment_id: await environment(tx, projectId),
          version: ' 1.4.2 ',
        })}`
      }),
    ).rejects.toThrow(/releases_version_shape/)
  })

  it('cannot carry something that is not a commit in the commit column', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        await tx`insert into releases ${tx({
          id: id(ID_PREFIXES.release),
          project_id: projectId,
          environment_id: await environment(tx, projectId),
          version: '1.4.2',
          commit: 'HEAD~1',
        })}`
      }),
    ).rejects.toThrow(/releases_commit_is_hex_when_set/)
  })
})

describe.skipIf(!reachable)('a saved view', () => {
  it('cannot repeat a shared name inside one project', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        for (const _ of [1, 2]) {
          await tx`insert into saved_views ${tx({
            id: id(ID_PREFIXES.savedView),
            project_id: projectId,
            name: 'Errors today',
            shared: true,
          })}`
        }
      }),
    ).rejects.toThrow(/saved_views_one_shared_name_per_project/)
  })

  it('lets two people keep a private view with the same name', async () => {
    await inRollback(async (tx) => {
      const projectId = await project(tx, await organization(tx))
      for (const _ of [1, 2]) {
        await tx`insert into saved_views ${tx({
          id: id(ID_PREFIXES.savedView),
          project_id: projectId,
          name: 'My errors',
        })}`
      }
    })
  })

  it('cannot carry a query longer than the parser will take', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into saved_views ${tx({
          id: id(ID_PREFIXES.savedView),
          project_id: await project(tx, await organization(tx)),
          name: 'Huge',
          query: 'a'.repeat(2001),
        })}`
      }),
    ).rejects.toThrow(/saved_views_query_is_bounded/)
  })

  it('cannot carry a period nobody can parse', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into saved_views ${tx({
          id: id(ID_PREFIXES.savedView),
          project_id: await project(tx, await organization(tx)),
          name: 'Since forever',
          time_range: 'forever',
        })}`
      }),
    ).rejects.toThrow(/saved_views_time_range_shape/)
  })
})

describe.skipIf(!reachable)('a dashboard', () => {
  it('cannot keep its widgets in anything but a list', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into dashboards ${tx({
          id: id(ID_PREFIXES.dashboard),
          project_id: await project(tx, await organization(tx)),
          name: 'Overview',
          widgets: tx.json({ first: 'chart' }),
        })}`
      }),
    ).rejects.toThrow(/dashboards_widgets_are_a_list/)
  })

  it('cannot hold more widgets than a page can draw', async () => {
    await expect(
      inRollback(async (tx) => {
        await tx`insert into dashboards ${tx({
          id: id(ID_PREFIXES.dashboard),
          project_id: await project(tx, await organization(tx)),
          name: 'Everything',
          widgets: tx.json(Array.from({ length: 51 }, (_, at) => ({ at }))),
        })}`
      }),
    ).rejects.toThrow(/dashboards_widget_count_is_bounded/)
  })
})

describe.skipIf(!reachable)('a scheduled export', () => {
  it('cannot have two live schedules of one cadence in one environment', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        const environmentId = await environment(tx, projectId)
        for (const _ of [1, 2]) {
          await tx`insert into export_schedules ${tx({
            id: id(ID_PREFIXES.exportSchedule),
            project_id: projectId,
            environment_id: environmentId,
            cadence: 'daily',
            format: 'csv',
          })}`
        }
      }),
    ).rejects.toThrow(/export_schedules_one_live_cadence_per_environment/)
  })

  it('lets a new one replace a disabled one', async () => {
    await inRollback(async (tx) => {
      const projectId = await project(tx, await organization(tx))
      const environmentId = await environment(tx, projectId)
      await tx`insert into export_schedules ${tx({
        id: id(ID_PREFIXES.exportSchedule),
        project_id: projectId,
        environment_id: environmentId,
        cadence: 'daily',
        format: 'csv',
        disabled_at: new Date(),
      })}`
      await tx`insert into export_schedules ${tx({
        id: id(ID_PREFIXES.exportSchedule),
        project_id: projectId,
        environment_id: environmentId,
        cadence: 'daily',
        format: 'json',
      })}`
    })
  })
})

describe.skipIf(!reachable)('two dashboards', () => {
  it('cannot repeat a shared name inside one project', async () => {
    await expect(
      inRollback(async (tx) => {
        const projectId = await project(tx, await organization(tx))
        for (const _ of [1, 2]) {
          await tx`insert into dashboards ${tx({
            id: id(ID_PREFIXES.dashboard),
            project_id: projectId,
            name: 'Overview',
            shared: true,
          })}`
        }
      }),
    ).rejects.toThrow(/dashboards_one_shared_name_per_project/)
  })

  it('may both be called the same thing while they are private', async () => {
    await inRollback(async (tx) => {
      const projectId = await project(tx, await organization(tx))
      for (const _ of [1, 2]) {
        await tx`insert into dashboards ${tx({
          id: id(ID_PREFIXES.dashboard),
          project_id: projectId,
          name: 'My overview',
        })}`
      }
    })
  })
})

describe.skipIf(!reachable)('an issue', () => {
  const NOW = new Date('2026-11-03T12:00:00.000Z')

  async function place(tx: postgres.TransactionSql): Promise<[string, string]> {
    const projectId = await project(tx, await organization(tx))
    return [projectId, await environment(tx, projectId)]
  }

  function issue(projectId: string, extra: Record<string, unknown> = {}) {
    return {
      id: id(ID_PREFIXES.issue),
      project_id: projectId,
      fingerprint: '12345678901234567890',
      title: 'Cannot read properties of undefined',
      first_seen_at: NOW,
      last_seen_at: NOW,
      ...extra,
    }
  }

  it('cannot carry the fingerprint that means there is none', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId] = await place(tx)
        await tx`insert into issues ${tx(issue(projectId, { fingerprint: '0' }))}`
      }),
    ).rejects.toThrow(/issues_fingerprint_is_not_the_unresolved_one/)
  })

  it('cannot carry a fingerprint that is not a whole number', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId] = await place(tx)
        await tx`insert into issues ${tx(issue(projectId, { fingerprint: '-1' }))}`
      }),
    ).rejects.toThrow(/issues_fingerprint_is_an_unsigned_number/)
  })

  it('takes a fingerprint that fills a UInt64, because it is text here', async () => {
    await inRollback(async (tx) => {
      const [projectId] = await place(tx)
      await tx`insert into issues ${tx(issue(projectId, { fingerprint: '18446744073709551615' }))}`
    })
  })

  it('happens once per project and fingerprint', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId] = await place(tx)
        for (const _ of [1, 2]) {
          await tx`insert into issues ${tx(issue(projectId))}`
        }
      }),
    ).rejects.toThrow(/issues_one_per_project_and_fingerprint/)
  })

  it('may share a fingerprint with another project', async () => {
    await inRollback(async (tx) => {
      const organizationId = await organization(tx)
      for (const _ of [1, 2]) {
        await tx`insert into issues ${tx(issue(await project(tx, organizationId)))}`
      }
    })
  })

  it('cannot have been last seen before it was first seen', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId] = await place(tx)
        await tx`insert into issues ${tx(
          issue(projectId, { last_seen_at: new Date(NOW.getTime() - 1000) }),
        )}`
      }),
    ).rejects.toThrow(/issues_last_seen_is_not_before_first_seen/)
  })

  it('cannot be resolved without saying when', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId] = await place(tx)
        await tx`insert into issues ${tx(issue(projectId, { status: 'resolved' }))}`
      }),
    ).rejects.toThrow(/issues_resolved_means_there_is_a_moment/)
  })

  it('cannot count a negative number of events', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId] = await place(tx)
        await tx`insert into issues ${tx(issue(projectId, { events: -1 }))}`
      }),
    ).rejects.toThrow(/issues_events_is_not_negative/)
  })

  it('loses its assignee rather than the record when the person is deleted', async () => {
    await inRollback(async (tx) => {
      const [projectId] = await place(tx)
      const userId = id(ID_PREFIXES.user)
      await tx`insert into users ${tx({
        id: userId,
        name: 'Ada',
        email: 'ada@example.com',
        password_hash: 'argon2id$x',
      })}`
      await tx`insert into issues ${tx(issue(projectId, { assignee_id: userId }))}`

      await tx`delete from users where id = ${userId}`

      const left = await tx`select assignee_id from issues`
      expect(left).toHaveLength(1)
      expect(left[0]?.assignee_id).toBe(null)
    })
  })

  it('counts each environment on its own, and goes away with the issue', async () => {
    await inRollback(async (tx) => {
      const [projectId, environmentId] = await place(tx)
      const row = issue(projectId)
      await tx`insert into issues ${tx(row)}`
      await tx`insert into issue_environments ${tx({
        issue_id: row.id,
        environment_id: environmentId,
        events: 3,
        first_seen_at: NOW,
        last_seen_at: NOW,
      })}`

      await tx`delete from issues where id = ${row.id}`

      const left = await tx`select count(*)::int as n from issue_environments`
      expect(left[0]?.n).toBe(0)
    })
  })

  it('counts an environment once per issue', async () => {
    await expect(
      inRollback(async (tx) => {
        const [projectId, environmentId] = await place(tx)
        const row = issue(projectId)
        await tx`insert into issues ${tx(row)}`
        for (const _ of [1, 2]) {
          await tx`insert into issue_environments ${tx({
            issue_id: row.id,
            environment_id: environmentId,
            events: 1,
            first_seen_at: NOW,
            last_seen_at: NOW,
          })}`
        }
      }),
    ).rejects.toThrow(/issue_environments_issue_id_environment_id_pk/)
  })
})
