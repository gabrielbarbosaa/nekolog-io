import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ping } from '@internal/clickhouse/client'
import { parseSeedDocument } from '@internal/seed'
import { localIngestConfigFrom, startLocalIngest } from './local.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function write(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function reportToConsole(error: unknown): void {
  process.stderr.write(`[nekolog/ingest] ${error instanceof Error ? error.stack : String(error)}\n`)
}

async function main(): Promise<void> {
  const config = localIngestConfigFrom(process.env)
  const seedFile = resolve(ROOT, config.seedFile)

  if (!existsSync(seedFile)) {
    throw new Error(`Não achei ${seedFile}. Rode "pnpm seed init" antes.`)
  }
  const document = parseSeedDocument(readFileSync(seedFile, 'utf8'))

  if (!(await ping(config.clickhouse))) {
    throw new Error(
      `Nada respondeu no ClickHouse em ${config.clickhouse.url}. Suba o stack com "pnpm dev:infra".`,
    )
  }

  const server = await startLocalIngest({ config, document, onError: reportToConsole })

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0))
    })
  }

  write(`ingestão local em ${server.url}`)
  write(`ClickHouse ${config.clickhouse.url} banco ${config.clickhouse.database}`)
  write(`projeto ${document.project.name}  ${document.project.id}`)
  write('')
  for (const environment of document.environments) {
    for (const key of environment.keys) {
      write(`  ${environment.name.padEnd(14)} ${key.kind.padEnd(7)} ${key.hint}`)
    }
  }
  write('')
  write(`Aponte NEKOLOG_ENDPOINT do SDK para ${server.url}`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
