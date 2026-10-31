import { describe, expect, it, vi } from 'vitest'
import type { ClickHouseConfig } from './client.ts'
import { clickHouseUsageStore, epochSeconds, USAGE_TABLE, usageStatement } from './usage-store.ts'

const CONFIG: ClickHouseConfig = {
  url: 'http://clickhouse.test:8123',
  database: 'nekolog_dev',
  user: 'nekolog_jobs',
  password: 'secret',
}

const NOON = Date.UTC(2026, 9, 31, 12, 0, 0)

function recorder(body = '') {
  const calls: Array<{ url: URL; body: string }> = []
  const fetchLike = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), body: String(init?.body ?? '') })
    return new Response(body, { status: 200 })
  })
  return { calls, fetch: fetchLike as unknown as typeof fetch }
}

describe('epochSeconds', () => {
  it('cuts milliseconds off an instant', () => {
    expect(epochSeconds(NOON + 999)).toBe(NOON / 1000)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('refuses the instant %s', (value) => {
    expect(() => epochSeconds(value)).toThrow(/non-numeric/)
  })
})

describe('usageStatement', () => {
  it('counts the rollup by environment', () => {
    expect(usageStatement('nekolog_dev', USAGE_TABLE)).toContain(
      'FROM nekolog_dev.usage_per_minute',
    )
    expect(usageStatement('nekolog_dev', USAGE_TABLE)).toContain('GROUP BY environment_id')
  })

  it('never builds the day boundary into the text of the query', () => {
    expect(usageStatement('nekolog_dev', USAGE_TABLE)).toContain('{start:Int64}')
  })

  it.each(['usage; DROP TABLE logs', 'usage_per_minute WHERE 1=1'])(
    'refuses the table name %s',
    (table) => {
      expect(() => usageStatement('nekolog_dev', table)).toThrow(/unsafe table/)
    },
  )
})

describe('clickHouseUsageStore', () => {
  it('sends the day boundary as a parameter, not as text in the query', async () => {
    const sent = recorder()
    const store = clickHouseUsageStore(CONFIG, { fetch: sent.fetch })

    await store.eventsSince(NOON)

    const call = sent.calls[0]
    expect(call?.url.searchParams.get('param_start')).toBe(String(NOON / 1000))
    expect(call?.body).not.toContain(String(NOON / 1000))
  })

  it('asks for whole numbers instead of quoted 64-bit strings', async () => {
    const sent = recorder()

    await clickHouseUsageStore(CONFIG, { fetch: sent.fetch }).eventsSince(NOON)

    expect(sent.calls[0]?.url.searchParams.get('output_format_json_quote_64bit_integers')).toBe('0')
  })

  it('reads a count per environment', async () => {
    const sent = recorder(
      '{"environmentId":"e_1","events":10500}\n{"environmentId":"e_2","events":7}\n',
    )

    expect(await clickHouseUsageStore(CONFIG, { fetch: sent.fetch }).eventsSince(NOON)).toEqual([
      { environmentId: 'e_1', events: 10_500 },
      { environmentId: 'e_2', events: 7 },
    ])
  })

  it('still reads the count when the server quotes it', async () => {
    const sent = recorder('{"environmentId":"e_1","events":"10500"}\n')

    expect(await clickHouseUsageStore(CONFIG, { fetch: sent.fetch }).eventsSince(NOON)).toEqual([
      { environmentId: 'e_1', events: 10_500 },
    ])
  })

  it('drops a row it cannot make sense of instead of counting it as zero', async () => {
    const sent = recorder(
      '{"environmentId":null,"events":5}\n{"environmentId":"e_1","events":"many"}\n{"environmentId":"e_2","events":3}\n',
    )

    expect(await clickHouseUsageStore(CONFIG, { fetch: sent.fetch }).eventsSince(NOON)).toEqual([
      { environmentId: 'e_2', events: 3 },
    ])
  })

  it('reports nothing when no environment sent anything', async () => {
    const sent = recorder('')

    expect(await clickHouseUsageStore(CONFIG, { fetch: sent.fetch }).eventsSince(NOON)).toEqual([])
  })
})
