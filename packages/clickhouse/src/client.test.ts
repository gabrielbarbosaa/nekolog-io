import { describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, QUOTE_64_BIT_INTEGERS, queryRows } from './client.ts'

const CONFIG: ClickHouseConfig = {
  url: 'http://clickhouse.invalid:8123',
  database: 'nekolog_dev',
  user: 'nekolog_reader',
  password: 'secret',
}

function recorder(body: string): {
  fetch: typeof fetch
  calls: URL[]
} {
  const calls: URL[] = []
  return {
    calls,
    fetch: (async (input: unknown) => {
      calls.push(new URL(String(input)))
      return new Response(body, { status: 200 })
    }) as typeof fetch,
  }
}

const BIGGEST = '18446744073709551615'

describe('reading rows out of ClickHouse', () => {
  it('asks for 64-bit integers as text, because a UInt64 does not fit in a number', async () => {
    const sent = recorder(`{"fingerprint":"${BIGGEST}"}\n`)
    const rows = await queryRows<{ fingerprint: string }>(CONFIG, 'SELECT fingerprint FROM logs', {
      fetch: sent.fetch,
    })

    expect(sent.calls[0]?.searchParams.get(QUOTE_64_BIT_INTEGERS)).toBe('1')
    expect(rows[0]?.fingerprint).toBe(BIGGEST)
  })

  it('lets a caller that really wants a number say so', async () => {
    const sent = recorder('{"events":42}\n')
    await queryRows(CONFIG, 'SELECT sum(events) AS events FROM usage_per_minute', {
      fetch: sent.fetch,
      settings: { [QUOTE_64_BIT_INTEGERS]: '0' },
    })

    expect(sent.calls[0]?.searchParams.get(QUOTE_64_BIT_INTEGERS)).toBe('0')
  })

  it('loses the last digits of a fingerprint when nobody asks for text, which is the bug', () => {
    expect(String(JSON.parse(`{"f":${BIGGEST}}`).f)).not.toBe(BIGGEST)
    expect(JSON.parse(`{"f":"${BIGGEST}"}`).f).toBe(BIGGEST)
  })

  it('leaves an insert alone: the setting belongs to reading, not to writing', async () => {
    const sent = recorder('')
    await execute(CONFIG, 'INSERT INTO logs FORMAT JSONEachRow\n{}', { fetch: sent.fetch })

    expect(sent.calls[0]?.searchParams.get(QUOTE_64_BIT_INTEGERS)).toBeNull()
  })

  it('keeps every other setting the caller passed', async () => {
    const sent = recorder('{"a":1}\n')
    await queryRows(CONFIG, 'SELECT 1 AS a', {
      fetch: sent.fetch,
      settings: { max_execution_time: '5' },
    })

    expect(sent.calls[0]?.searchParams.get('max_execution_time')).toBe('5')
    expect(sent.calls[0]?.searchParams.get(QUOTE_64_BIT_INTEGERS)).toBe('1')
  })
})
