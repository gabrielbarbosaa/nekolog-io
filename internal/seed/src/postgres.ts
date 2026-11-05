import type { SeedDocument } from './document.ts'

export type SeedStatement = {
  text: string
  params: readonly unknown[]
}

function at(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}

export function seedStatements(document: SeedDocument): SeedStatement[] {
  const statements: SeedStatement[] = [
    {
      text: `insert into organizations (id, name, created_at)
             values ($1, $2, $3)
             on conflict (id) do update set name = excluded.name`,
      params: [document.organization.id, document.organization.name, at(document.createdAt)],
    },
    {
      text: `insert into projects (id, organization_id, name, created_at)
             values ($1, $2, $3, $4)
             on conflict (id) do update set name = excluded.name`,
      params: [
        document.project.id,
        document.organization.id,
        document.project.name,
        at(document.createdAt),
      ],
    },
  ]

  for (const environment of document.environments) {
    statements.push({
      text: `insert into environments
               (id, project_id, name, retention_days, origin_allowlist,
                min_level, sample_rate, redaction_rules, created_at)
             values ($1, $2, $3, $4, $5::text[], $6, $7, $8::jsonb, $9)
             on conflict (id) do update set
               retention_days = excluded.retention_days,
               origin_allowlist = excluded.origin_allowlist,
               min_level = excluded.min_level,
               sample_rate = excluded.sample_rate,
               redaction_rules = excluded.redaction_rules`,
      params: [
        environment.id,
        document.project.id,
        environment.name,
        environment.retentionDays,
        environment.originAllowlist === null ? null : [...environment.originAllowlist],
        environment.minLevel,
        environment.sampleRate,
        environment.redaction,
        at(document.createdAt),
      ],
    })

    for (const key of environment.keys) {
      statements.push({
        text: `insert into api_keys (id, environment_id, kind, hash, hint, scopes, created_at)
               values ($1, $2, $3, $4, $5, $6::text[], $7)
               on conflict (id) do nothing`,
        params: [
          key.id,
          environment.id,
          key.kind,
          key.hash,
          key.hint,
          [...key.scopes],
          at(key.createdAt),
        ],
      })
    }
  }

  return statements
}
