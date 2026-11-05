import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSeedDocument, type SeedDocument } from '@internal/seed'
import { ping } from '@nekolog-io/clickhouse/client'
import { startLocalIngest } from './local.ts'
import { selfHostIngestConfigFrom, selfHostIngestWiring } from './self-host.ts'
import type { SpooledBatch } from './sink.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function report(line: string): void {
  process.stdout.write(`${line}\n`)
}

function reportToConsole(error: unknown): void {
  process.stderr.write(`[nekolog/ingest] ${error instanceof Error ? error.stack : String(error)}\n`)
}

function reportReload(document: SeedDocument): void {
  report(
    `seed file re-read: ${document.environments
      .map(
        (environment) =>
          `${environment.name} min=${environment.minLevel} sample=${environment.sampleRate} ` +
          `redaction=${environment.redaction.patterns.length + environment.redaction.attributes.length}`,
      )
      .join('  ')}`,
  )
}

function reportSpooled(spooled: SpooledBatch): void {
  process.stderr.write(
    `[nekolog/ingest] spooled ${JSON.stringify({ key: spooled.key, rows: spooled.rows })} ${spooled.reason}\n`,
  )
}

async function main(): Promise<void> {
  const config = selfHostIngestConfigFrom(process.env)
  const seedFile = resolve(ROOT, config.seedFile)

  if (!existsSync(seedFile)) {
    throw new Error(`I did not find ${seedFile}. The bootstrap container writes it.`)
  }
  const document = parseSeedDocument(readFileSync(seedFile, 'utf8'))

  if (!(await ping(config.clickhouse))) {
    throw new Error(`Nothing answered on ClickHouse at ${config.clickhouse.url}.`)
  }

  const server = await startLocalIngest(
    selfHostIngestWiring({
      config,
      document,
      seedFile,
      onError: reportToConsole,
      onReload: reportReload,
      onSpooled: reportSpooled,
    }),
  )

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0))
    })
  }

  report(`ingest listening on ${config.host}:${config.port}`)
  report(`ClickHouse ${config.clickhouse.url} database ${config.clickhouse.database}`)
  report(`spool ${config.spoolDir}  kv ${config.kvDir}`)
  report(`project ${document.project.name}  ${document.project.id}`)
  reportReload(document)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
