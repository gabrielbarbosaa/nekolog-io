import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSeedDocument } from '@internal/seed'
import type { SqlRunner } from '@nekolog-io/adapters'
import { ping } from '@nekolog-io/clickhouse/client'
import postgres from 'postgres'
import { localApiConfigFrom, startLocalApi } from './local.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function write(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function reportToConsole(error: unknown): void {
  process.stderr.write(`[nekolog/api] ${error instanceof Error ? error.stack : String(error)}\n`)
}

async function main(): Promise<void> {
  const config = localApiConfigFrom(process.env)
  const seedFile = resolve(ROOT, config.seedFile)

  if (!existsSync(seedFile)) {
    throw new Error(`I could not find ${seedFile}. Run "pnpm seed init" first.`)
  }
  const document = parseSeedDocument(readFileSync(seedFile, 'utf8'))

  if (!(await ping(config.clickhouse))) {
    throw new Error(`Nothing answered on ClickHouse at ${config.clickhouse.url}.`)
  }

  const sql = postgres(config.databaseUrl, { max: 4, onnotice: () => {} })
  await sql`select 1`
  const run: SqlRunner = async (text, params) => sql.unsafe(text, params as never[])

  const server = await startLocalApi({ config, document, sql: run, onError: reportToConsole })

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      void server.close().then(() => sql.end({ timeout: 5 }).then(() => process.exit(0)))
    })
  }

  write(`public read API on ${server.url}`)
  write(`OpenAPI at ${server.url}/openapi.json`)
  write(`ClickHouse ${config.clickhouse.url} database ${config.clickhouse.database}`)
  write(`project ${document.project.name}  ${document.project.id}`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
