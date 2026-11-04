import { describe, expect, it } from 'vitest'
import { toDocument } from './document.ts'
import { buildSeed } from './model.ts'
import { seedStatements } from './postgres.ts'

async function document() {
  return toDocument(
    await buildSeed({
      organization: 'NekoLog',
      project: 'nekolog',
      environments: ['production', 'staging'],
    }),
  )
}

describe('the statements that put a seed into Postgres', () => {
  it('writes the organization, the project, every environment and every key', async () => {
    const statements = seedStatements(await document())
    const tables = statements.map((statement) => /insert into (\w+)/.exec(statement.text)?.[1])

    expect(tables).toEqual([
      'organizations',
      'projects',
      'environments',
      'api_keys',
      'api_keys',
      'environments',
      'api_keys',
      'api_keys',
    ])
  })

  it('never carries a key, only its hash and its hint', async () => {
    const seed = await buildSeed({ organization: 'n', project: 'p' })
    const secrets = seed.environments.flatMap((environment) =>
      environment.keys.map((key) => key.value),
    )
    const everything = JSON.stringify(seedStatements(toDocument(seed)))

    expect(secrets.length).toBeGreaterThan(0)
    for (const secret of secrets) {
      expect(everything).not.toContain(secret)
    }
  })

  it('binds every value instead of writing it into the statement', async () => {
    const seed = await buildSeed({ organization: "Bobby'); drop table projects;--", project: 'p' })

    for (const statement of seedStatements(toDocument(seed))) {
      expect(statement.text).not.toContain('Bobby')
      expect(statement.text).toMatch(/\$\d/)
    }
  })

  it('can be applied again without undoing anything, which is what a restart does', async () => {
    for (const statement of seedStatements(await document())) {
      expect(statement.text).toMatch(/on conflict \(id\) do (update set|nothing)/)
    }
  })

  it('leaves a key alone once it exists, because only its hash is here', async () => {
    const keys = seedStatements(await document()).filter((statement) =>
      statement.text.includes('insert into api_keys'),
    )

    expect(keys.length).toBeGreaterThan(0)
    for (const statement of keys) {
      expect(statement.text).toContain('on conflict (id) do nothing')
    }
  })
})
