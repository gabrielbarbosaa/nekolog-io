import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ParsedBatch, parseBatch } from '@internal/schema'
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

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'internal',
  'clickhouse',
  'migrations',
  '0001_create_logs.sql',
)

function logsTableColumns(): string[] {
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
  it('maps a plain log onto the table', () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'info',
        message: 'Pedido criado',
        attributes: { orderId: 123, amount: 99.9, retry: true, note: null },
      },
    ])

    expect(rows(batch)[0]).toEqual({
      project_id: 'p_1',
      environment_id: 'e_1',
      timestamp: '2026-10-31 15:30:00.000',
      received_at: '2026-10-31 15:30:45.125',
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

  it('takes trace, session and error apart into their columns', () => {
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

    expect(rows(batch)[0]).toMatchObject({
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      session_id: 's_1',
      user_id: 'u_42',
      error_type: 'TypeError',
      stacktrace: 'at pay (app.js:1:1)',
      attributes: {},
    })
  })

  it('keeps an error message that differs from the log message, instead of losing it', () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'error',
        message: 'Payment failed',
        error: { type: 'GatewayError', message: 'upstream timeout' },
      },
    ])

    expect(rows(batch)[0]?.attributes).toEqual({
      [ERROR_MESSAGE_ATTRIBUTE]: 'upstream timeout',
    })
  })

  it('does not duplicate the message when they are the same', () => {
    const batch = batchOf([
      {
        timestamp: '2026-10-31T15:30:00.000Z',
        level: 'error',
        message: 'boom',
        error: { type: 'Error', message: 'boom' },
      },
    ])

    expect(rows(batch)[0]?.attributes).toEqual({})
  })

  it('stamps project and environment from the principal, never from the batch', () => {
    const batch = batchOf([{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }])
    const mapped = rows(batch, { projectId: 'p_real', environmentId: 'e_real' })

    expect(mapped[0]).toMatchObject({ project_id: 'p_real', environment_id: 'e_real' })
  })

  it('takes the retention the environment configured', () => {
    const batch = batchOf([{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }])

    expect(rows(batch, { ...PRINCIPAL, retentionDays: 7 })[0]).toMatchObject({
      retention_days: 7,
    })
  })

  it('leaves optional resource fields empty rather than undefined', () => {
    const batch = batchOf(
      [{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }],
      { runtime: 'browser' },
    )

    expect(rows(batch)[0]).toMatchObject({ service: 'default', release: '', source: 'browser' })
  })

  it('maps only the accepted events', () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'kept' },
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'verbose', message: 'dropped' },
    ])

    expect(rows(batch).map((row) => row.message)).toEqual(['kept'])
  })

  it('gives every row in a batch the same received_at', () => {
    const batch = batchOf([
      { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'a' },
      { timestamp: '2026-10-31T15:30:01.000Z', level: 'info', message: 'b' },
    ])

    const received = new Set(rows(batch).map((row) => row.received_at))
    expect(received.size).toBe(1)
  })

  it('writes exactly the columns the migration creates', () => {
    const batch = batchOf([{ timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'x' }])

    expect(Object.keys(rows(batch)[0] ?? {}).sort()).toEqual([...logsTableColumns()].sort())
  })
})
