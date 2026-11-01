import { type ChildProcess, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type LocalIngestServer, startLocalIngest } from '@apps/ingest'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@internal/clickhouse'
import { buildSeed, type Seed, toDocument } from '@internal/seed'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_example_${process.pid}`
const config: ClickHouseConfig = { ...base, database }
const reachable = await ping(config)

if (!reachable) {
  if (process.env.CLICKHOUSE_TEST_REQUIRED === '1') {
    throw new Error(
      `CLICKHOUSE_TEST_REQUIRED is set but nothing answered at ${base.url}. ` +
        'These tests must not be skipped here.',
    )
  }
  process.stderr.write(
    `\nSkipping the example-express tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts')
const FLUSH_INTERVAL_MS = '200'
const SIGNALS_ARE_DELIVERABLE = process.platform !== 'win32'

if (reachable && !SIGNALS_ARE_DELIVERABLE) {
  process.stderr.write(
    '[nekolog] skipping the SIGTERM flush test: Windows terminates the process instead of delivering the signal to a listener. CI runs on Linux, where it does run.\n',
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

function startExample(
  key: string,
  extra: Record<string, string> = {},
): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: '0',
      NEKOLOG_KEY: key,
      NEKOLOG_ENDPOINT: ingestUrl,
      NEKOLOG_SERVICE: 'example-express',
      NEKOLOG_RELEASE: '1.0.0-test',
      NEKOLOG_LEVEL: 'info',
      NEKOLOG_FLUSH_INTERVAL_MS: FLUSH_INTERVAL_MS,
      ...extra,
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

describe.skipIf(!reachable)('the express example reaching ClickHouse', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)

    seed = await buildSeed({ organization: 'NekoLog', project: 'example', retentionDays: 3 })

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
    await ingest.close()
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('turns a real GET into a row the dashboard could show', { timeout: 30_000 }, async () => {
    const response = await fetch(`${exampleUrl}/orders/ord_7f3a91`)
    expect(response.status).toBe(200)

    const rows = await waitForRows("message = 'Order looked up'", 1)

    expect(rows[0]).toMatchObject({
      project_id: seed.project.id,
      environment_id: environmentIdFor('production'),
      service: 'example-express',
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
    const traceId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
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

  it('writes the stack of a failure the client never sees', { timeout: 30_000 }, async () => {
    const response = await fetch(`${exampleUrl}/boom`)

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('10.0.3.14')

    const rows = await waitForRows("error_type = 'Error'", 1)

    expect(rows[0]?.level).toBe('error')
    expect(String(rows[0]?.stacktrace)).toContain('10.0.3.14')
    expect(String(rows[0]?.message)).toContain('10.0.3.14')
  })

  it.skipIf(!SIGNALS_ARE_DELIVERABLE)(
    'flushes on SIGTERM what it would otherwise still be holding',
    { timeout: 60_000 },
    async () => {
      const holding = await startExample(secretKeyFor('staging'), {
        NEKOLOG_FLUSH_INTERVAL_MS: '600000',
      })
      const where = "attributes['order.id'] = 'ord_last'"

      try {
        await fetch(`${holding.url}/orders/ord_last`)
        await new Promise((resolve) => setTimeout(resolve, 1_000))

        expect(await rowsWhere(where)).toHaveLength(0)

        const exited = new Promise<void>((resolve) => holding.child.once('exit', () => resolve()))
        holding.child.kill('SIGTERM')
        await exited

        const rows = await waitForRows(where, 1)
        expect(rows[0]?.environment_id).toBe(environmentIdFor('staging'))
      } finally {
        holding.child.kill('SIGKILL')
      }
    },
  )
})
