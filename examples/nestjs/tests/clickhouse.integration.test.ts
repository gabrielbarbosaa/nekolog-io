import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type LocalIngestServer, startLocalIngest } from '@apps/ingest'
import { buildSeed, type Seed, toDocument } from '@internal/seed'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@nekolog-io/clickhouse'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_example_nest_${process.pid}`
const config: ClickHouseConfig = { ...base, database }
const reachable = await ping(config)

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.mjs')
const built = existsSync(MAIN)

if (!reachable && process.env.CLICKHOUSE_TEST_REQUIRED === '1') {
  throw new Error(
    `CLICKHOUSE_TEST_REQUIRED is set but nothing answered at ${base.url}. ` +
      'These tests must not be skipped here.',
  )
}

if (reachable && !built) {
  throw new Error(
    `${MAIN} is missing. The nestjs example runs from its build, so run \`pnpm build\` first.`,
  )
}

if (!reachable) {
  process.stderr.write(
    `\nSkipping the example-nestjs tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

let ingest: LocalIngestServer
let ingestUrl = ''
let example: ChildProcess
let exampleUrl = ''
let seed: Seed

function environmentIdFor(name: string): string {
  const found = seed.environments.find((entry) => entry.name === name)
  if (found === undefined) {
    throw new Error(`the seed has no environment called ${name}`)
  }
  return found.id
}

function secretKeyFor(name: string): string {
  const found = seed.environments
    .find((entry) => entry.name === name)
    ?.keys.find((key) => key.kind === 'secret')
  if (found === undefined) {
    throw new Error(`the seed has no secret key for ${name}`)
  }
  return found.value
}

async function rowsWhere(where: string): Promise<Array<Record<string, unknown>>> {
  return queryRows<Record<string, unknown>>(
    config,
    `SELECT * FROM ${database}.logs WHERE ${where} ORDER BY timestamp`,
  )
}

async function waitForRows(
  where: string,
  expected: number,
): Promise<Array<Record<string, unknown>>> {
  let rows: Array<Record<string, unknown>> = []
  for (let attempt = 0; attempt < 100; attempt += 1) {
    rows = await rowsWhere(where)
    if (rows.length >= expected) {
      return rows
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`only ${rows.length} of ${expected} rows arrived for ${where}`)
}

function startExample(key: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [MAIN], {
    env: {
      ...process.env,
      PORT: '0',
      NEKOLOG_KEY: key,
      NEKOLOG_ENDPOINT: ingestUrl,
      NEKOLOG_SERVICE: 'example-nestjs',
      NEKOLOG_RELEASE: '1.0.0-test',
      NEKOLOG_LEVEL: 'info',
      NEKOLOG_FLUSH_INTERVAL_MS: '200',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return new Promise((resolve, reject) => {
    let out = ''
    const giveUp = setTimeout(() => {
      reject(new Error(`the example never printed its port: ${out}`))
    }, 30_000)
    giveUp.unref()

    const onExit = (code: number | null) => {
      clearTimeout(giveUp)
      reject(new Error(`the example exited with ${code}: ${out}`))
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const found = /http:\/\/127\.0\.0\.1:\d+/.exec(out)
      if (found !== null) {
        clearTimeout(giveUp)
        child.off('exit', onExit)
        resolve({ child, url: found[0] })
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    child.once('exit', onExit)
  })
}

describe.skipIf(!reachable)('the nestjs example reaching ClickHouse', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)

    seed = await buildSeed({ organization: 'NekoLog', project: 'example-nest', retentionDays: 3 })

    ingest = await startLocalIngest({
      config: { port: 0, seedFile: 'unused', clickhouse: config, eventsPerMinute: 10_000 },
      document: toDocument(seed),
      onError: (error) => {
        process.stderr.write(`[ingest] ${String(error)}\n`)
      },
    })
    ingestUrl = ingest.url

    const started = await startExample(secretKeyFor('production'))
    example = started.child
    exampleUrl = started.url
  }, 120_000)

  afterAll(async () => {
    example?.kill('SIGKILL')
    await ingest?.close()
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('turns a real GET into a row the dashboard could show', { timeout: 30_000 }, async () => {
    const response = await fetch(`${exampleUrl}/orders/ord_7f3a91`)
    expect(response.status).toBe(200)

    const rows = await waitForRows("message = 'Order looked up'", 1)

    expect(rows[0]).toMatchObject({
      project_id: seed.project.id,
      environment_id: environmentIdFor('production'),
      service: 'example-nestjs',
      release: '1.0.0-test',
      source: 'node',
      level: 'info',
      retention_days: 3,
    })
    expect(rows[0]?.attributes).toMatchObject({ 'order.id': 'ord_7f3a91' })
  })

  it('stores both lines of the request under the trace the caller started', {
    timeout: 30_000,
  }, async () => {
    const traceId = 'b1c2d3e4f5061728394a5b6c7d8e9f01'
    const parentSpanId = '00f067aa0ba902b7'

    await fetch(`${exampleUrl}/orders/ord_000001`, {
      headers: { traceparent: `00-${traceId}-${parentSpanId}-01` },
    })

    const rows = await waitForRows(`trace_id = '${traceId}'`, 2)

    expect(rows.map((row) => row.message)).toContain('GET /orders/:id 200')
    expect(new Set(rows.map((row) => row.span_id)).size).toBe(1)
    expect(rows[0]?.span_id).not.toBe(parentSpanId)
    expect(rows[0]?.attributes).toMatchObject({ 'trace.parentSpanId': parentSpanId })
  })

  it('never lets the customer email reach the database', { timeout: 30_000 }, async () => {
    await fetch(`${exampleUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: 'cus_7f3a91',
        email: 'ana@exemplo.com',
        totalCents: 4990,
      }),
    })

    const rows = await waitForRows("message = 'Order created'", 1)

    expect(rows[0]?.attributes).toMatchObject({ 'customer.email': '[redacted]' })
    expect(rows[0]?.user_id).toBe('cus_7f3a91')

    const leaked = await rowsWhere(
      "arrayExists(value -> position(value, 'ana@exemplo.com') > 0, mapValues(attributes))",
    )
    expect(leaked).toHaveLength(0)
  })

  it('logs a handler that threw as an error, with the right status', {
    timeout: 30_000,
  }, async () => {
    const response = await fetch(`${exampleUrl}/boom`)

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('10.0.3.14')

    const rows = await waitForRows("error_type = 'Error'", 1)

    expect(rows[0]?.level).toBe('error')
    expect(String(rows[0]?.stacktrace)).toContain('10.0.3.14')
    expect(rows[0]?.attributes).toMatchObject({ 'http.status': '500' })
  })
})
