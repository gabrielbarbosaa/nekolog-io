import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSeedDocument } from '@internal/seed'
import { fileBlobStore } from '@internal/self-host'
import type { SqlRunner } from '@nekolog-io/adapters'
import { ping } from '@nekolog-io/clickhouse/client'
import postgres from 'postgres'
import { startLocalApi } from './local.ts'
import { selfHostApiConfigFrom } from './self-host.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function report(line: string): void {
  process.stdout.write(`${line}\n`)
}

function reportToConsole(error: unknown): void {
  process.stderr.write(`[nekolog/api] ${error instanceof Error ? error.stack : String(error)}\n`)
}

async function main(): Promise<void> {
  const config = selfHostApiConfigFrom(process.env)
  const seedFile = resolve(ROOT, config.seedFile)

  if (!existsSync(seedFile)) {
    throw new Error(`I did not find ${seedFile}. The bootstrap container writes it.`)
  }
  const document = parseSeedDocument(readFileSync(seedFile, 'utf8'))

  if (!(await ping(config.clickhouse))) {
    throw new Error(`Nothing answered on ClickHouse at ${config.clickhouse.url}.`)
  }

  const sql = postgres(config.databaseUrl, { max: 4, onnotice: () => {} })
  await sql`select 1`
  const run: SqlRunner = async (text, params) => sql.unsafe(text, params as never[])

  if (config.sourceMapsDir === undefined) {
    throw new Error(
      'The self-host api container is missing SOURCEMAPS_DIR. Without it nothing could upload a source map.',
    )
  }

  const server = await startLocalApi({
    config,
    document,
    sql: run,
    blobs: fileBlobStore(config.sourceMapsDir),
    onError: reportToConsole,
  })

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      void server.close().then(() => sql.end({ timeout: 5 }).then(() => process.exit(0)))
    })
  }

  report(`public read API listening on ${config.host}:${config.port}`)
  report(`ClickHouse ${config.clickhouse.url} database ${config.clickhouse.database}`)
  report(`project ${document.project.name}  ${document.project.id}`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
