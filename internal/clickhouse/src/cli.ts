import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configFromEnv } from './config.ts'
import { loadMigrations, MIGRATION_FILE_PATTERN, MIGRATIONS_DIR } from './migrations.ts'
import { migrate, status } from './runner.ts'

const USAGE = `Usage: ch <command>

  migrate        apply every pending migration, in order
  status         show which migrations are applied, pending or drifted
  new <name>     create the next migration file from a template
`

function loadDotEnv(): void {
  const dotEnv = resolve(MIGRATIONS_DIR, '..', '..', '..', '.env')
  if (!existsSync(dotEnv)) {
    return
  }
  try {
    process.loadEnvFile(dotEnv)
  } catch {
    return
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

async function runStatus(): Promise<void> {
  const config = configFromEnv()
  const report = await status(config)

  process.stdout.write(`${config.database} on ${config.url}\n\n`)
  for (const entry of report.entries) {
    const when = entry.appliedAt ? ` (${entry.appliedAt})` : ''
    process.stdout.write(`  ${entry.state.padEnd(8)} ${entry.fileName}${when}\n`)
  }
  for (const orphan of report.orphans) {
    process.stdout.write(`  orphan   ${orphan.version} ${orphan.name} (${orphan.applied_at})\n`)
  }

  const pending = report.entries.filter((entry) => entry.state === 'pending').length
  process.stdout.write(`\n${pending} pending\n`)
}

async function runMigrate(): Promise<void> {
  const config = configFromEnv()
  const result = await migrate(config, {
    onApply: (migration) => process.stdout.write(`  applied ${migration.fileName}\n`),
  })

  if (result.applied.length === 0) {
    process.stdout.write(`${config.database} is up to date\n`)
    return
  }
  process.stdout.write(`\n${result.applied.length} applied to ${config.database}\n`)
}

function runNew(rawName: string | undefined): void {
  if (!rawName) {
    fail('Usage: ch new <name>, for example: ch new add_issue_id')
  }

  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name)) {
    fail(`"${rawName}" is not a usable migration name; use lower_snake_case, like add_issue_id`)
  }

  const existing = loadMigrations()
  const version = String(existing.length + 1).padStart(4, '0')
  const fileName = `${version}_${name}.sql`

  if (!MIGRATION_FILE_PATTERN.test(fileName)) {
    fail(`"${fileName}" would not be a valid migration file name`)
  }

  const path = join(MIGRATIONS_DIR, fileName)
  if (existsSync(path)) {
    fail(`${fileName} already exists`)
  }

  writeFileSync(path, `ALTER TABLE {{database}}.logs\n`, 'utf8')
  process.stdout.write(`${path}\n`)
}

async function main(): Promise<void> {
  loadDotEnv()

  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case 'migrate':
      return runMigrate()
    case 'status':
      return runStatus()
    case 'new':
      return runNew(rest[0])
    default:
      fail(USAGE)
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
