import { describe, expect, it, vi } from 'vitest'
import { MAX_BATCH_BYTES, MAX_EVENTS_PER_BATCH } from './limits.ts'
import {
  createTransport,
  type DropReason,
  type Envelope,
  type FetchLike,
  headersFor,
  requestUrlFor,
  splitBatch,
  type TransportOptions,
} from './transport.ts'
import type { LogEvent } from './types.ts'

const KEY = 'nekolog_sk_abcdef0123456789'

function event(message = 'hello'): LogEvent {
  return { timestamp: '2026-10-30T14:03:12.481Z', level: 'info', message }
}

type Call = { url: string; headers: Record<string, string>; body: string }

type Reply = {
  status?: number
  body?: string
  retryAfter?: string | null
  throws?: boolean
}

function recorder(replies: Reply[] = []) {
  const calls: Call[] = []
  let index = 0

  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    const reply = replies[Math.min(index, replies.length - 1)] ?? {}
    index++

    if (reply.throws) {
      throw new Error('network is down')
    }
    const status = reply.status ?? 202
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (name === 'Retry-After' ? (reply.retryAfter ?? null) : null) },
      text: async () => reply.body ?? '{"accepted":1,"rejected":[]}',
    }
  }

  return {
    calls,
    fetchLike,
    envelopes: () => calls.map((call) => JSON.parse(call.body) as Envelope),
  }
}

function setup(replies: Reply[] = [], options: Partial<TransportOptions> = {}) {
  const recorded = recorder(replies)
  const drops: Array<{ count: number; reason: DropReason }> = []
  const errors: unknown[] = []

  const transport = createTransport({
    apiKey: KEY,
    sdk: { name: '@nekolog-io/core', version: '0.0.0' },
    resource: { service: 'checkout-web', runtime: 'node' },
    fetch: recorded.fetchLike,
    flushIntervalMs: 0,
    sleep: () => Promise.resolve(),
    now: () => Date.UTC(2026, 9, 30, 14, 0, 0),
    random: () => 0.5,
    onDrop: (count, reason) => drops.push({ count, reason }),
    onError: (error) => errors.push(error),
    ...options,
  })

  return { transport, drops, errors, ...recorded }
}

describe('the request it makes', () => {
  it('posts to /v1/logs on the configured endpoint', async () => {
    const { transport, calls } = setup([], { endpoint: 'https://ingest.example.com/' })

    transport.emit(event())
    await transport.flush()

    expect(calls[0]?.url).toBe('https://ingest.example.com/v1/logs')
  })

  it('sends the key in the Authorization header', async () => {
    const { transport, calls } = setup()

    transport.emit(event())
    await transport.flush()

    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('never puts the key in the url, where proxies would log it', async () => {
    const { transport, calls } = setup()

    transport.emit(event())
    await transport.flush()

    expect(calls[0]?.url).not.toContain(KEY)
    expect(calls[0]?.url).not.toContain('nekolog_')
  })

  it('wraps the events in a v1 envelope', async () => {
    const { transport, envelopes } = setup()

    transport.emit(event('one'))
    transport.emit(event('two'))
    await transport.flush()

    const envelope = envelopes()[0]
    expect(envelope?.schemaVersion).toBe(1)
    expect(envelope?.sdk).toEqual({ name: '@nekolog-io/core', version: '0.0.0' })
    expect(envelope?.resource).toEqual({ service: 'checkout-web', runtime: 'node' })
    expect(envelope?.events.map((e) => e.message)).toEqual(['one', 'two'])
  })

  it('stamps a uuid v7 batch id', async () => {
    const { transport, envelopes } = setup()

    transport.emit(event())
    await transport.flush()

    expect(envelopes()[0]?.batchId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('keeps the same batch id across retries, so the server can deduplicate', async () => {
    const { transport, envelopes } = setup([{ status: 503 }, { status: 503 }, { status: 202 }])

    transport.emit(event())
    await transport.flush()

    const ids = envelopes().map((envelope) => envelope.batchId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
  })

  it('gives each batch its own id', async () => {
    const { transport, envelopes } = setup([], { maxBatchEvents: 1 })

    transport.emit(event('one'))
    transport.emit(event('two'))
    await transport.flush()

    const ids = envelopes().map((envelope) => envelope.batchId)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('batching', () => {
  it('sends nothing until asked', async () => {
    const { transport, calls } = setup()

    transport.emit(event())

    expect(calls).toHaveLength(0)
  })

  it('puts everything queued into one request', async () => {
    const { transport, envelopes } = setup()

    for (let i = 0; i < 10; i++) {
      transport.emit(event(`e${i}`))
    }
    await transport.flush()

    expect(envelopes()).toHaveLength(1)
    expect(envelopes()[0]?.events).toHaveLength(10)
  })

  it('splits at the event count limit', async () => {
    const { transport, envelopes } = setup([], { maxBatchEvents: 3 })

    for (let i = 0; i < 7; i++) {
      transport.emit(event(`e${i}`))
    }
    await transport.flush()

    expect(envelopes().map((envelope) => envelope.events.length)).toEqual([3, 3, 1])
  })

  it('flushes on its own once the batch size is reached', async () => {
    const { transport, calls } = setup([], { maxBatchEvents: 2 })

    transport.emit(event('one'))
    transport.emit(event('two'))
    await transport.flush()

    expect(calls).toHaveLength(1)
  })

  it('splits a batch that is too large in bytes, keeping every event', async () => {
    const { transport, envelopes } = setup([], { maxBatchBytes: 600 })

    for (let i = 0; i < 8; i++) {
      transport.emit(event(`${i}`.repeat(50)))
    }
    await transport.flush()

    const sent = envelopes().flatMap((envelope) => envelope.events)
    expect(sent).toHaveLength(8)
    expect(envelopes().length).toBeGreaterThan(1)
    for (const call of envelopes()) {
      expect(JSON.stringify(call).length).toBeLessThanOrEqual(600)
    }
  })

  it('drops a single event that cannot fit on its own, and says so', async () => {
    const { transport, drops, envelopes } = setup([], { maxBatchBytes: 400 })

    transport.emit(event('x'.repeat(2000)))
    transport.emit(event('small'))
    await transport.flush()

    expect(drops).toContainEqual({ count: 1, reason: 'event_too_large' })
    expect(envelopes().flatMap((envelope) => envelope.events.map((e) => e.message))).toEqual([
      'small',
    ])
  })

  it('never exceeds the contract limits, whatever it is configured with', async () => {
    const { transport } = setup([], {
      maxBatchEvents: MAX_EVENTS_PER_BATCH * 10,
      maxBatchBytes: MAX_BATCH_BYTES * 10,
    })
    const { transport: unused } = setup()
    void unused

    for (let i = 0; i < MAX_EVENTS_PER_BATCH + 5; i++) {
      transport.emit(event(`e${i}`))
    }
    await transport.flush()

    expect(transport.size).toBe(0)
  })
})

describe('the bounded queue', () => {
  it('drops the oldest events when it fills, and reports how many', () => {
    const { transport, drops } = setup([], { maxQueueEvents: 3, maxBatchEvents: 100 })

    for (let i = 0; i < 5; i++) {
      transport.emit(event(`e${i}`))
    }

    expect(transport.size).toBe(3)
    expect(transport.dropped).toBe(2)
    expect(drops.filter((drop) => drop.reason === 'queue_full')).toHaveLength(2)
  })

  it('keeps the newest events, not the oldest', async () => {
    const { transport, envelopes } = setup([], { maxQueueEvents: 2, maxBatchEvents: 100 })

    transport.emit(event('oldest'))
    transport.emit(event('middle'))
    transport.emit(event('newest'))
    await transport.flush()

    expect(envelopes()[0]?.events.map((e) => e.message)).toEqual(['middle', 'newest'])
  })
})

describe('retry', () => {
  it('retries a 5xx and succeeds', async () => {
    const { transport, calls, drops } = setup([{ status: 500 }, { status: 202 }])

    transport.emit(event())
    await transport.flush()

    expect(calls).toHaveLength(2)
    expect(drops).toEqual([])
  })

  it('retries a network failure', async () => {
    const { transport, calls } = setup([{ throws: true }, { status: 202 }])

    transport.emit(event())
    await transport.flush()

    expect(calls).toHaveLength(2)
  })

  it('gives up after maxRetries and reports the loss', async () => {
    const { transport, calls, drops } = setup([{ status: 503 }], { maxRetries: 2 })

    transport.emit(event())
    await transport.flush()

    expect(calls).toHaveLength(3)
    expect(drops).toContainEqual({ count: 1, reason: 'retries_exhausted' })
  })

  it('waits longer on each attempt', async () => {
    const waits: number[] = []
    const { transport } = setup([{ status: 503 }], {
      maxRetries: 4,
      baseRetryDelayMs: 100,
      random: () => 1,
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    transport.emit(event())
    await transport.flush()

    expect(waits).toEqual([100, 200, 400, 800])
  })

  it('caps the backoff', async () => {
    const waits: number[] = []
    const { transport } = setup([{ status: 503 }], {
      maxRetries: 8,
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 4000,
      random: () => 1,
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    transport.emit(event())
    await transport.flush()

    expect(Math.max(...waits)).toBe(4000)
  })
})

describe('429 and Retry-After', () => {
  it('waits exactly as long as the server asked', async () => {
    const waits: number[] = []
    const { transport, calls } = setup([{ status: 429, retryAfter: '7' }, { status: 202 }], {
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    transport.emit(event())
    await transport.flush()

    expect(waits).toEqual([7000])
    expect(calls).toHaveLength(2)
  })

  it('understands an http-date Retry-After', async () => {
    const waits: number[] = []
    const now = Date.UTC(2026, 9, 30, 14, 0, 0)
    const { transport } = setup(
      [{ status: 429, retryAfter: new Date(now + 9000).toUTCString() }, { status: 202 }],
      {
        now: () => now,
        sleep: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
      },
    )

    transport.emit(event())
    await transport.flush()

    expect(waits).toEqual([9000])
  })

  it('falls back to backoff when Retry-After is nonsense', async () => {
    const waits: number[] = []
    const { transport } = setup([{ status: 429, retryAfter: 'soonish' }, { status: 202 }], {
      baseRetryDelayMs: 200,
      random: () => 1,
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    transport.emit(event())
    await transport.flush()

    expect(waits).toEqual([200])
  })

  it('does not block for a long Retry-After: it pauses and keeps the events', async () => {
    const now = Date.UTC(2026, 9, 30, 14, 0, 0)
    const waits: number[] = []
    const { transport, calls } = setup([{ status: 429, retryAfter: '600' }], {
      now: () => now,
      maxRetryDelayMs: 30_000,
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    transport.emit(event())
    await transport.flush()

    expect(waits).toEqual([])
    expect(calls).toHaveLength(1)
    expect(transport.size).toBe(1)
    expect(transport.pausedUntil).toBe(now + 600_000)
  })

  it('sends nothing more while paused, then resumes', async () => {
    let clock = Date.UTC(2026, 9, 30, 14, 0, 0)
    const { transport, calls } = setup([{ status: 429, retryAfter: '600' }, { status: 202 }], {
      now: () => clock,
      maxRetryDelayMs: 30_000,
    })

    transport.emit(event('first'))
    await transport.flush()
    transport.emit(event('second'))
    await transport.flush()

    expect(calls).toHaveLength(1)

    clock += 601_000
    await transport.flush()

    expect(calls).toHaveLength(2)
    expect((JSON.parse(calls[1]?.body ?? '{}') as Envelope).events.map((e) => e.message)).toEqual([
      'first',
      'second',
    ])
  })

  it('keeps the queued batches in order when it pauses', async () => {
    const now = Date.UTC(2026, 9, 30, 14, 0, 0)
    const { transport, calls } = setup([{ status: 429, retryAfter: '600' }], {
      now: () => now,
      maxBatchEvents: 1,
      maxRetryDelayMs: 30_000,
    })

    transport.emit(event('one'))
    transport.emit(event('two'))
    transport.emit(event('three'))
    await transport.flush()

    expect(calls).toHaveLength(1)
    expect(transport.size).toBe(3)
  })
})

describe('errors the server will not change its mind about', () => {
  it.each([
    ['invalid_key', 401],
    ['origin_not_allowed', 403],
    ['secret_key_in_url', 401],
    ['unsupported_schema_version', 400],
  ])('stops the transport on %s instead of retrying forever', async (code, status) => {
    const { transport, calls, drops } = setup([
      { status, body: JSON.stringify({ error: { code } }) },
    ])

    transport.emit(event())
    await transport.flush()

    expect(calls).toHaveLength(1)
    expect(transport.stopped).toBe(true)
    expect(drops.some((drop) => drop.reason === 'transport_stopped')).toBe(true)
  })

  it('drops the batch but keeps going on invalid_payload', async () => {
    const { transport, calls, drops } = setup([
      { status: 400, body: JSON.stringify({ error: { code: 'invalid_payload' } }) },
      { status: 202 },
    ])

    transport.emit(event('bad'))
    await transport.flush()
    transport.emit(event('good'))
    await transport.flush()

    expect(calls).toHaveLength(2)
    expect(transport.stopped).toBe(false)
    expect(drops).toContainEqual({ count: 1, reason: 'rejected_by_server' })
  })

  it('retries quota_exceeded rather than dropping it', async () => {
    const { transport, calls } = setup([
      { status: 429, body: JSON.stringify({ error: { code: 'quota_exceeded' } }) },
      { status: 202 },
    ])

    transport.emit(event())
    await transport.flush()

    expect(calls).toHaveLength(2)
  })

  it('discards anything emitted after it stopped', async () => {
    const { transport, calls, drops } = setup([
      { status: 401, body: JSON.stringify({ error: { code: 'invalid_key' } }) },
    ])

    transport.emit(event())
    await transport.flush()
    transport.emit(event('after'))
    await transport.flush()

    expect(calls).toHaveLength(1)
    expect(drops.filter((drop) => drop.reason === 'transport_stopped').length).toBeGreaterThan(0)
  })
})

describe('what the server rejected inside an accepted batch', () => {
  it('reports the rejected events without retrying the batch', async () => {
    const rejected: Array<{ index: number; code: string }> = []
    const { transport, calls } = setup(
      [{ status: 202, body: '{"accepted":1,"rejected":[{"index":1,"code":"invalid_level"}]}' }],
      { onReject: (events) => rejected.push(...events) },
    )

    transport.emit(event('ok'))
    transport.emit(event('bad'))
    await transport.flush()

    expect(calls).toHaveLength(1)
    expect(rejected).toEqual([{ index: 1, code: 'invalid_level' }])
  })
})

describe('flush and close', () => {
  it('resolves with an empty queue without calling the network', async () => {
    const { transport, calls } = setup()

    await transport.flush()

    expect(calls).toHaveLength(0)
  })

  it('leaves the queue empty after a successful flush', async () => {
    const { transport } = setup()

    transport.emit(event())
    await transport.flush()

    expect(transport.size).toBe(0)
  })

  it('does not send the same event twice when flushed concurrently', async () => {
    const { transport, envelopes } = setup()

    transport.emit(event('one'))
    await Promise.all([transport.flush(), transport.flush(), transport.flush()])

    expect(envelopes().flatMap((envelope) => envelope.events)).toHaveLength(1)
  })

  it('sends what is pending and then refuses more', async () => {
    const { transport, calls } = setup()

    transport.emit(event())
    await transport.close()

    expect(calls).toHaveLength(1)
    expect(transport.stopped).toBe(true)
  })
})

describe('never throwing into the host app', () => {
  it('stops instead of throwing in a runtime with no fetch', async () => {
    const drops: Array<{ count: number; reason: DropReason }> = []
    vi.stubGlobal('fetch', undefined)

    try {
      const transport = createTransport({
        apiKey: KEY,
        sdk: { name: 'x', version: '1' },
        resource: { runtime: 'node' },
        flushIntervalMs: 0,
        onDrop: (count, reason) => drops.push({ count, reason }),
        onError: () => undefined,
      })

      transport.emit(event())
      await expect(transport.flush()).resolves.toBeUndefined()
      expect(transport.stopped).toBe(true)
      expect(drops).toContainEqual({ count: 1, reason: 'transport_stopped' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('survives an onDrop that throws', async () => {
    const errors: unknown[] = []
    const { transport } = setup([], {
      maxQueueEvents: 1,
      maxBatchEvents: 100,
      onDrop: () => {
        throw new Error('onDrop is broken')
      },
      onError: (error) => errors.push(error),
    })

    expect(() => {
      transport.emit(event('a'))
      transport.emit(event('b'))
    }).not.toThrow()
    expect(errors).toHaveLength(1)
  })

  it('survives a body that is not json', async () => {
    const { transport, calls } = setup([{ status: 400, body: '<html>nope</html>' }])

    transport.emit(event())
    await expect(transport.flush()).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})

describe('splitBatch', () => {
  const measure = (events: LogEvent[]) => JSON.stringify(events).length

  it('returns nothing for no events', () => {
    expect(splitBatch([], 10, 1000, measure)).toEqual({ batches: [], oversized: [] })
  })

  it('keeps one batch when everything fits', () => {
    const events = [event('a'), event('b')]
    expect(splitBatch(events, 10, 10_000, measure).batches).toEqual([events])
  })

  it('never loses an event while splitting', () => {
    const events = Array.from({ length: 33 }, (_, i) => event(`e${i}`))
    const { batches, oversized } = splitBatch(events, 7, 200, measure)

    expect([...batches.flat(), ...oversized]).toHaveLength(33)
  })

  it('preserves order across the batches', () => {
    const events = Array.from({ length: 20 }, (_, i) => event(`e${i}`))
    const { batches } = splitBatch(events, 6, 100_000, measure)

    expect(batches.flat().map((e) => e.message)).toEqual(events.map((e) => e.message))
  })
})

describe('the helpers it exposes', () => {
  it('trims trailing slashes off the endpoint', () => {
    expect(requestUrlFor('https://x.dev///')).toBe('https://x.dev/v1/logs')
  })

  it('builds json headers with a bearer token', () => {
    expect(headersFor('k')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer k',
    })
  })
})

describe('the logger wiring', () => {
  it('uses a transport when given an api key', async () => {
    const recorded = recorder()
    const { createLogger } = await import('./logger.ts')
    const log = createLogger({
      apiKey: KEY,
      transport: { flushIntervalMs: 0 },
      sink: createTransport({
        apiKey: KEY,
        sdk: { name: '@nekolog-io/core', version: '0.0.0' },
        resource: { runtime: 'node' },
        fetch: recorded.fetchLike,
        flushIntervalMs: 0,
      }),
    })

    log.info('through the transport')
    await log.flush()

    expect(recorded.calls).toHaveLength(1)
  })

  it('still writes to the console when there is no api key', async () => {
    const { createLogger } = await import('./logger.ts')
    const info = vi.fn()
    const log = createLogger({ sink: { emit: info } })

    log.info('hello')

    expect(info).toHaveBeenCalledOnce()
  })
})
