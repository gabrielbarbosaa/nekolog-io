import { describe, expect, it, vi } from 'vitest'
import type { ClickHouseConfig } from './client.ts'
import {
  assertIdentifier,
  clickHouseLogStore,
  insertSettings,
  insertStatement,
  LOGS_TABLE,
  serialiseRows,
} from './log-store.ts'

const CONFIG: ClickHouseConfig = {
  url: 'http://clickhouse.test:8123',
  database: 'nekolog_dev',
  user: 'nekolog_ingest',
  password: 'secret',
}

const ROW = { project_id: 'p_1', message: 'hello' }

function recorder(response = new Response('', { status: 200 })) {
  const calls: Array<{ url: URL; body: string; headers: Record<string, string> }> = []
  const fetchLike = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      body: String(init?.body ?? ''),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })
    return response
  })
  return { calls, fetch: fetchLike as unknown as typeof fetch }
}

describe('assertIdentifier', () => {
  it.each(['nekolog_dev', 'logs', '_private', 'a1'])('accepts %s', (value) => {
    expect(assertIdentifier(value, 'table')).toBe(value)
  })

  it.each([
    'logs; DROP TABLE users',
    'logs WHERE 1=1',
    'nekolog-dev',
    '1logs',
    '',
    'logs.other',
    'logs`',
  ])('refuses %s', (value) => {
    expect(() => assertIdentifier(value, 'table')).toThrow(/unsafe table/)
  })
})

describe('insertStatement', () => {
  it('targets the database and table with JSONEachRow', () => {
    expect(insertStatement('nekolog_dev', 'logs')).toBe(
      'INSERT INTO nekolog_dev.logs FORMAT JSONEachRow\n',
    )
  })

  it('refuses to build SQL around an unsafe name', () => {
    expect(() => insertStatement('nekolog_dev', 'logs; DROP TABLE logs')).toThrow()
    expect(() => insertStatement("x'; --", 'logs')).toThrow()
  })
})

describe('serialiseRows', () => {
  it('writes one JSON object per line', () => {
    expect(serialiseRows([{ a: 1 }, { b: 'two' }])).toBe('{"a":1}\n{"b":"two"}')
  })

  it('escapes a newline inside a value instead of breaking the format', () => {
    const written = serialiseRows([{ message: 'line one\nline two' }])

    expect(written.split('\n')).toHaveLength(1)
    expect(JSON.parse(written)).toEqual({ message: 'line one\nline two' })
  })
})

describe('insertSettings', () => {
  it('turns async_insert on and waits for the flush by default', () => {
    expect(insertSettings({})).toMatchObject({ async_insert: '1', wait_for_async_insert: '1' })
  })

  it('refuses unknown columns, because ClickHouse would otherwise drop them in silence', () => {
    expect(insertSettings({})).toMatchObject({ input_format_skip_unknown_fields: '0' })
    expect(insertSettings({ asyncInsert: false })).toMatchObject({
      input_format_skip_unknown_fields: '0',
    })
  })

  it('can stop waiting, which trades the guarantee for latency', () => {
    expect(insertSettings({ waitForAsyncInsert: false })).toMatchObject({
      wait_for_async_insert: '0',
    })
  })

  it('can be turned off entirely', () => {
    expect(insertSettings({ asyncInsert: false })).not.toHaveProperty('async_insert')
  })

  it('passes a deduplication token through', () => {
    expect(insertSettings({}, { deduplicationToken: 'batch-1' })).toMatchObject({
      insert_deduplication_token: 'batch-1',
    })
  })

  it('leaves the token out when there is none', () => {
    expect(insertSettings({}, {})).not.toHaveProperty('insert_deduplication_token')
    expect(insertSettings({}, { deduplicationToken: '' })).not.toHaveProperty(
      'insert_deduplication_token',
    )
  })
})

describe('clickHouseLogStore', () => {
  it('posts the rows to the right database and table', async () => {
    const { calls, fetch } = recorder()
    const store = clickHouseLogStore(CONFIG, { fetch })

    const result = await store.insert([ROW, { project_id: 'p_1', message: 'second' }])

    expect(result).toEqual({ accepted: 2 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.searchParams.get('database')).toBe('nekolog_dev')
    expect(calls[0]?.body).toBe(
      `INSERT INTO nekolog_dev.${LOGS_TABLE} FORMAT JSONEachRow\n{"project_id":"p_1","message":"hello"}\n{"project_id":"p_1","message":"second"}`,
    )
  })

  it('asks for async_insert and waits for it', async () => {
    const { calls, fetch } = recorder()

    await clickHouseLogStore(CONFIG, { fetch }).insert([ROW])

    expect(calls[0]?.url.searchParams.get('async_insert')).toBe('1')
    expect(calls[0]?.url.searchParams.get('wait_for_async_insert')).toBe('1')
  })

  it('sends the deduplication token, which is what makes a resend safe', async () => {
    const { calls, fetch } = recorder()

    await clickHouseLogStore(CONFIG, { fetch }).insert([ROW], {
      deduplicationToken: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    })

    expect(calls[0]?.url.searchParams.get('insert_deduplication_token')).toBe(
      '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    )
  })

  it('authenticates as the insert user, never in the URL', async () => {
    const { calls, fetch } = recorder()

    await clickHouseLogStore(CONFIG, { fetch }).insert([ROW])

    expect(calls[0]?.headers['x-clickhouse-user']).toBe('nekolog_ingest')
    expect(calls[0]?.headers['x-clickhouse-key']).toBe('secret')
    expect(calls[0]?.url.search).not.toContain('secret')
  })

  it('passes the Cloudflare Access credentials when there are any', async () => {
    const { calls, fetch } = recorder()
    const store = clickHouseLogStore(
      { ...CONFIG, accessClientId: 'id', accessClientSecret: 'shh' },
      { fetch },
    )

    await store.insert([ROW])

    expect(calls[0]?.headers['cf-access-client-id']).toBe('id')
    expect(calls[0]?.headers['cf-access-client-secret']).toBe('shh')
  })

  it('does not call ClickHouse at all for an empty batch', async () => {
    const { calls, fetch } = recorder()

    expect(await clickHouseLogStore(CONFIG, { fetch }).insert([])).toEqual({ accepted: 0 })
    expect(calls).toEqual([])
  })

  it('raises what ClickHouse refused, with its own message', async () => {
    const { fetch } = recorder(
      new Response('Code: 497. DB::Exception: not enough privileges', { status: 403 }),
    )

    await expect(clickHouseLogStore(CONFIG, { fetch }).insert([ROW])).rejects.toThrow(
      /not enough privileges/,
    )
  })

  it('refuses an unsafe table name before any request leaves', async () => {
    const { calls, fetch } = recorder()

    expect(() => clickHouseLogStore(CONFIG, { fetch, table: 'logs; DROP TABLE logs' })).toThrow()
    expect(calls).toEqual([])
  })
})
