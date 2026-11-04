import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type ParsedBatch, parseBatch } from '@internal/schema'
import { MIGRATIONS_DIR } from '@nekolog-io/clickhouse'
import { describe, expect, it } from 'vitest'
import type { IngestPrincipal } from './app.ts'
import {
  clickHouseTimestamp,
  countryOf,
  DEFAULT_RETENTION_DAYS,
  ERROR_MESSAGE_ATTRIBUTE,
  rowsFor,
  UNRESOLVED_FINGERPRINT,
} from './rows.ts'

const RECEIVED_AT = Date.UTC(2026, 9, 31, 15, 30, 45, 125)

const PRINCIPAL: IngestPrincipal = { projectId: 'p_1', environmentId: 'e_1' }

const MIGRATION = resolve(MIGRATIONS_DIR, '0001_create_logs.sql')

const ALTERS_LOGS = /^\s*alter\s+table\s+\{\{database\}\}\.logs\b/i
const ADDS_COLUMN = /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\s+\S/i

function createdColumns(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8')
  const body = sql.slice(sql.indexOf('(') + 1, sql.indexOf(') ENGINE'))
  const columns = body
    .split('\n')
    .map((line) => /^\s{2}([a-z_]+)\s+\S/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)

  if (columns.length === 0) {
    throw new Error(`Found no columns in ${MIGRATION}; the parser needs updating`)
  }
  return columns
}

function alteredColumns(): string[] {
  const added: string[] = []

  for (const fileName of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!fileName.endsWith('.sql')) {
      continue
    }
    const sql = readFileSync(resolve(MIGRATIONS_DIR, fileName), 'utf8')
    if (!ALTERS_LOGS.test(sql)) {
      continue
    }
    const name = ADDS_COLUMN.exec(sql)?.[1]
    if (name === undefined) {
      throw new Error(
        `${fileName} alters logs in a way this parser does not read; teach it before the column list can be trusted`,
      )
    }
    added.push(name)
  }

  return added
}

function logsTableColumns(): string[] {
  return [...createdColumns(), ...alteredColumns()]
}

function batchOf(events: Array<Record<string, unknown>>, resource?: Record<string, unknown>) {
  const result = parseBatch({
    schemaVersion: 1,
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    sdk: { name: '@nekolog-io/node', version: '0.0.0' },
    resource: resource ?? { service: 'checkout-api', release: '1.4.2', runtime: 'node' },
    events,
  })
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.batch
}

const CONTEXT = { receivedAt: RECEIVED_AT, country: 'BR' }

function rows(batch: ParsedBatch, principal = PRINCIPAL, country = 'BR') {
  return rowsFor(batch, principal, { receivedAt: RECEIVED_AT, country })
}

describe('clickHouseTimestamp', () => {
  it('writes the format ClickHouse parses without a setting', () => {
    expect(clickHouseTimestamp('2026-10-31T15:30:45.125Z')).toBe('2026-10-31 15:30:45.125')
  })

  it('takes epoch milliseconds too', () => {
    expect(clickHouseTimestamp(RECEIVED_AT)).toBe('2026-10-31 15:30:45.125')
  })

  it('converts an offset to UTC instead of keeping it', () => {
    expect(clickHouseTimestamp('2026-10-31T12:30:45.125-03:00')).toBe('2026-10-31 15:30:45.125')
  })

  it('never emits something unparseable', () => {
    expect(clickHouseTimestamp('not a date')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/,
    )
  })
})

describe('countryOf', () => {
  function requestWith(headers: Record<string, string> = {}, cf?: unknown): Request {
    const request = new Request('https://ingest.nekolog.io/v1/logs', { method: 'POST', headers })
    if (cf !== undefined) {
      Object.defineProperty(request, 'cf', { value: cf })
    }
    return request
  }

  it('reads the Cloudflare header', () => {
    expect(countryOf(requestWith({ 'cf-ipcountry': 'br' }))).toBe('BR')
  })

  it('falls back to the platform field', () => {
    expect(countryOf(requestWith({}, { country: 'PT' }))).toBe('PT')
  })

  it('keeps the codes Cloudflare uses for unknown and for Tor', () => {
    expect(countryOf(requestWith({ 'cf-ipcountry': 'XX' }))).toBe('XX')
    expect(countryOf(requestWith({ 'cf-ipcountry': 'T1' }))).toBe('T1')
  })

  it.each(['', 'BRA', 'B', 'br-sp', '../../etc'])('refuses %s', (value) => {
    expect(countryOf(requestWith({ 'cf-ipcountry': value }))).toBe('')
  })

  it('answers empty where there is no Cloudflare at all', () => {
    expect(countryOf(requestWith())).toBe('')
  })

  it('never reads an IP, whatever header carries it', () => {
    const request = requestWith({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.9',
    })

    expect(countryOf(request)).toBe('')
  })
})

describe('rowsFor', () => {
  it('maps a plain log onto the table', async () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'info',
        message: 'Pedido criado',
        attributes: { orderId: 123, amount: 99.9, retry: true, note: null },
      },
    ])

    expect((await rows(batch))[0]).toEqual({
      project_id: 'p_1',
      environment_id: 'e_1',
      timestamp: '2026-10-31 15:30:00.000',
      received_at: '2026-10-31 15:30:45.125',
      clock_skew_ms: 45_125,
      level: 'info',
      message: 'Pedido criado',
      service: 'checkout-api',
      release: '1.4.2',
      source: 'node',
      trace_id: '',
      span_id: '',
      session_id: '',
      user_id: '',
      fingerprint: UNRESOLVED_FINGERPRINT,
      error_type: '',
      stacktrace: '',
      attributes: { orderId: '123', amount: '99.9', retry: 'true', note: '' },
      country: 'BR',
      retention_days: DEFAULT_RETENTION_DAYS,
    })
  })

  it('takes trace, session and error apart into their columns', async () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'error',
        message: 'Cannot read properties of undefined',
        trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
        session: { id: 's_1', userId: 'u_42' },
        error: {
          type: 'TypeError',
          message: 'Cannot read properties of undefined',
          stack: 'at pay (app.js:1:1)',
        },
      },
    ])

    expect((await rows(batch))[0]).toMatchObject({
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      session_id: 's_1',
      user_id: 'u_42',
      error_type: 'TypeError',
      stacktrace: 'at pay (app.js:1:1)',
      attributes: {},
    })
  })

  it('keeps an error message that differs from the log message, instead of losing it', async () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'error',
        message: 'Payment failed',
        error: { type: 'GatewayError', message: 'upstream timeout' },
      },
    ])

    expect((await rows(batch))[0]?.attributes).toEqual({
      [ERROR_MESSAGE_ATTRIBUTE]: 'upstream timeout',
    })
  })

  it('does not duplicate the message when they are the same', async () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'error',
        message: 'boom',
        error: { type: 'Error', message: 'boom' },
      },
    ])

    expect((await rows(batch))[0]?.attributes).toEqual({})
  })

  it('stamps project and environment from the principal, never from the batch', async () => {
    const batch = batchOf([{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }])
    const mapped = await rows(batch, { projectId: 'p_real', environmentId: 'e_real' })

    expect(mapped[0]).toMatchObject({ project_id: 'p_real', environment_id: 'e_real' })
  })

  it('takes the retention the environment configured', async () => {
    const batch = batchOf([{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }])

    expect((await rows(batch, { ...PRINCIPAL, retentionDays: 7 }))[0]).toMatchObject({
      retention_days: 7,
    })
  })

  it('leaves optional resource fields empty rather than undefined', async () => {
    const batch = batchOf(
      [{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }],
      { runtime: 'browser' },
    )

    expect((await rows(batch))[0]).toMatchObject({
      service: 'default',
      release: '',
      source: 'browser',
    })
  })

  it('maps only the accepted events', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'kept' },
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'verbose', message: 'dropped' },
    ])

    expect((await rows(batch)).map((row) => row.message)).toEqual(['kept'])
  })

  it('gives every row in a batch the same received_at', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'a' },
      { timestamp: '2026-10-31T15:30:01.000Z', level: 'info', message: 'b' },
    ])

    const received = new Set((await rows(batch)).map((row) => row.received_at))
    expect(received.size).toBe(1)
  })

  it('writes exactly the columns the migrations create', async () => {
    const batch = batchOf([{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }])

    expect(Object.keys((await rows(batch))[0] ?? {}).sort()).toEqual([...logsTableColumns()].sort())
  })

  it('reads the columns a later migration added, not only the ones the first one created', () => {
    expect(alteredColumns()).toContain('clock_skew_ms')
    expect(createdColumns()).not.toContain('clock_skew_ms')
  })
})

describe('what the environment settings keep out', () => {
  it('writes every level when nothing was configured', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'trace', message: 'a' },
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'fatal', message: 'b' },
    ])

    expect((await rows(batch)).map((row) => row.message)).toEqual(['a', 'b'])
  })

  it('drops what is below the minimum level the environment set', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'debug', message: 'quiet' },
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'error', message: 'loud' },
    ])

    const built = await rowsFor(batch, { ...PRINCIPAL, minLevel: 'warn' }, CONTEXT)

    expect(built.map((row) => row.message)).toEqual(['loud'])
  })

  it('says what it dropped and why, so the run can report it', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'debug', message: 'quiet' },
    ])
    const dropped: string[] = []

    await rowsFor(
      batch,
      { ...PRINCIPAL, minLevel: 'warn' },
      { ...CONTEXT, onDropped: (reason) => dropped.push(reason) },
    )

    expect(dropped).toEqual(['below_min_level'])
  })

  it('samples ordinary logs but never an error', async () => {
    const events = Array.from({ length: 60 }, (_, at) => ({
      timestamp: '2026-10-31T15:30:00.000Z',
      level: at % 2 === 0 ? 'info' : 'error',
      message: `m${at}`,
    }))
    const batch = batchOf(events)

    const built = await rowsFor(batch, { ...PRINCIPAL, sampleRate: 0.01 }, CONTEXT)
    const levels = built.map((row) => row.level)

    expect(levels.filter((level) => level === 'error')).toHaveLength(30)
    expect(levels.filter((level) => level === 'info').length).toBeLessThan(30)
  })

  it('writes nothing at all when every event was kept out', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'debug', message: 'quiet' },
    ])

    expect(await rowsFor(batch, { ...PRINCIPAL, minLevel: 'fatal' }, CONTEXT)).toEqual([])
  })
})

describe('what the environment asked to be removed', () => {
  const REDACTED = { ...PRINCIPAL, redaction: { patterns: ['email'], attributes: ['secret.*'] } }

  it('takes it out of the message', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'write to a@b.test' },
    ])

    expect((await rowsFor(batch, REDACTED, CONTEXT))[0]?.message).toBe('write to [redacted]')
  })

  it('takes it out of the stack trace, where a token is just as readable', async () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'error',
        message: 'boom',
        error: {
          type: 'Error',
          message: 'boom',
          stack: 'Error: boom\n    at notify (mailer.ts:1) for ana@example.com',
        },
      },
    ])

    const stack = String((await rowsFor(batch, REDACTED, CONTEXT))[0]?.stacktrace)

    expect(stack).not.toContain('ana@example.com')
    expect(stack).toContain('[redacted]')
    expect(stack).toContain('at notify')
  })

  it('takes it out of the attributes, by name and by pattern', async () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'info',
        message: 'ok',
        attributes: { 'secret.token': 'abc', contact: 'a@b.test', orderId: 'ord_1' },
      },
    ])

    expect((await rowsFor(batch, REDACTED, CONTEXT))[0]?.attributes).toEqual({
      'secret.token': '[redacted]',
      contact: '[redacted]',
      orderId: 'ord_1',
    })
  })

  it('leaves everything alone when the environment asked for nothing', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'write to a@b.test' },
    ])

    expect((await rows(batch))[0]?.message).toBe('write to a@b.test')
  })
})

describe('the clock of whoever sent the batch', () => {
  it('records how far behind the sender is, in milliseconds', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:29:45.125Z', level: 'info', message: 'a minute late' },
    ])

    expect((await rows(batch))[0]?.clock_skew_ms).toBe(60_000)
  })

  it('records a sender running ahead as a negative number', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:31:45.125Z', level: 'info', message: 'a minute early' },
    ])

    expect((await rows(batch))[0]?.clock_skew_ms).toBe(-60_000)
  })

  it('leaves the timestamp untouched when the two clocks agree', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'in step' },
    ])

    const [row] = await rows(batch)
    expect(row?.timestamp).toBe('2026-10-31 15:30:00.000')
    expect(row?.clock_skew_ms).toBe(45_125)
  })

  it('pulls a timestamp older than the retention forward, because ClickHouse drops that row', async () => {
    const batch = batchOf([
      { timestamp: '2020-01-01T00:00:00.000Z', level: 'info', message: 'from a dead clock' },
    ])

    const [row] = await rows(batch)

    expect(row?.timestamp).not.toBe('2020-01-01 00:00:00.000')
    expect(row?.timestamp).toBe(clickHouseTimestamp(RECEIVED_AT - (30 * 86_400_000 - 3_600_000)))
  })

  it('caps a timestamp from the far future, which no period query would ever reach', async () => {
    const batch = batchOf([
      { timestamp: '2099-01-01T00:00:00.000Z', level: 'info', message: 'from the future' },
    ])

    const [row] = await rows(batch)

    expect(row?.timestamp).toBe(clickHouseTimestamp(RECEIVED_AT + 300_000))
  })

  it('still records the real distance after moving the timestamp, so the original is recoverable', async () => {
    const batch = batchOf([
      { timestamp: '2020-01-01T00:00:00.000Z', level: 'info', message: 'from a dead clock' },
    ])

    const skew = (await rows(batch))[0]?.clock_skew_ms
    expect(typeof skew).toBe('number')
    expect(clickHouseTimestamp(RECEIVED_AT - (skew as number))).toBe('2020-01-01 00:00:00.000')
  })

  it('measures the floor against the retention the key carries', async () => {
    const batch = batchOf([
      { timestamp: '2026-10-29T15:30:45.125Z', level: 'info', message: 'two days old' },
    ])

    const short = await rowsFor(batch, { ...PRINCIPAL, retentionDays: 1 }, CONTEXT)
    const long = await rowsFor(batch, { ...PRINCIPAL, retentionDays: 30 }, CONTEXT)

    expect(long[0]?.timestamp).toBe('2026-10-29 15:30:45.125')
    expect(short[0]?.timestamp).toBe(clickHouseTimestamp(RECEIVED_AT - (86_400_000 - 3_600_000)))
  })
})
