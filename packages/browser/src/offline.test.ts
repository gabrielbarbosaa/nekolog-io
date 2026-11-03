import type { FetchLike, FetchResponseLike } from '@nekolog-io/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configureOffline,
  installOnlineReplay,
  keepsWaiting,
  parkingSender,
  replayOnce,
} from './offline.ts'
import { type BatchStore, memoryBatchStore, type StoredBatch } from './store.ts'

const KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'
const URL_ = 'https://ingest.nekolog.io/v1/logs'
const BODY = '{"events":[{"message":"boom"}]}'
const NOW = Date.UTC(2026, 10, 3, 21, 0)
const INIT = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: BODY }

const installed: Array<() => void> = []

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
  configureOffline(false)
})

function answer(status: number): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  }
}

function offline(): FetchLike {
  return () => Promise.reject(new TypeError('Failed to fetch'))
}

type Call = { url: string; init: Parameters<FetchLike>[1] }

function recording(answers: number[] = []): { send: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const send: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return answer(answers[calls.length - 1] ?? 202)
  }
  return { send, calls }
}

describe('a batch that could not leave the page', () => {
  it('is parked instead of lost', async () => {
    const store = memoryBatchStore()
    const send = parkingSender(offline(), { store, now: () => NOW })

    const response = await send(URL_, INIT)

    expect(response.ok).toBe(true)
    expect(await store.list()).toEqual([{ id: 1, at: NOW, url: URL_, body: BODY }])
  })

  it('is not parked when the request actually worked', async () => {
    const store = memoryBatchStore()
    const { send } = recording()

    await parkingSender(send, { store })(URL_, INIT)

    expect(await store.list()).toEqual([])
  })

  it('is not parked when the server said no, because that is not an outage', async () => {
    const store = memoryBatchStore()
    const { send } = recording([400])

    const response = await parkingSender(send, { store })(URL_, INIT)

    expect(response.status).toBe(400)
    expect(await store.list()).toEqual([])
  })

  it('still fails loudly when there is nowhere to park it', async () => {
    configureOffline(false)

    await expect(parkingSender(offline())(URL_, INIT)).rejects.toThrow('Failed to fetch')
  })

  it('still fails loudly when the parking itself is refused', async () => {
    const refusing: BatchStore = {
      ...memoryBatchStore(),
      put: () => Promise.reject(new Error('the disk is full')),
    }
    const seen: unknown[] = []

    await expect(
      parkingSender(offline(), { store: refusing, onError: (error) => seen.push(error) })(
        URL_,
        INIT,
      ),
    ).rejects.toThrow('Failed to fetch')
    expect(String(seen[0])).toContain('the disk is full')
  })

  it('does not let a long outage fill the disk', async () => {
    const store = memoryBatchStore()
    let clock = NOW
    const send = parkingSender(offline(), { store, maxBatches: 3, now: () => clock })

    for (let i = 0; i < 10; i++) {
      clock += 1
      await send(URL_, INIT)
    }

    expect(await store.list()).toHaveLength(3)
  })
})

describe('coming back online', () => {
  it('sends what was waiting, oldest first', async () => {
    const store = memoryBatchStore()
    await store.put({ at: NOW - 1_000, url: URL_, body: 'second' })
    await store.put({ at: NOW - 2_000, url: URL_, body: 'first' })
    const { send, calls } = recording()

    const sent = await replayOnce({ apiKey: KEY, send, store })

    expect(sent).toBe(2)
    expect(calls.map((call) => call.init.body)).toEqual(['first', 'second'])
    expect(await store.list()).toEqual([])
  })

  it('builds the headers again instead of storing them', async () => {
    const store = memoryBatchStore()
    await store.put({ at: NOW, url: URL_, body: BODY })
    const { send, calls } = recording()

    await replayOnce({ apiKey: KEY, send, store })

    expect(calls[0]?.init.headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('keeps what it could not send, and stops trying', async () => {
    const store = memoryBatchStore()
    await store.put({ at: NOW - 2_000, url: URL_, body: 'first' })
    await store.put({ at: NOW - 1_000, url: URL_, body: 'second' })
    let calls = 0
    const send: FetchLike = () => {
      calls += 1
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    const sent = await replayOnce({ apiKey: KEY, send, store })

    expect(sent).toBe(0)
    expect(calls).toBe(1)
    expect(await store.list()).toHaveLength(2)
  })

  it('keeps a batch the server asked us to retry', async () => {
    const store = memoryBatchStore()
    await store.put({ at: NOW - 2_000, url: URL_, body: 'first' })
    const { send } = recording([503])

    const sent = await replayOnce({ apiKey: KEY, send, store })

    expect(sent).toBe(0)
    expect(await store.list()).toHaveLength(1)
  })

  it('throws away a batch the server will never accept', async () => {
    const store = memoryBatchStore()
    await store.put({ at: NOW, url: URL_, body: 'nonsense' })
    const { send } = recording([400])

    await replayOnce({ apiKey: KEY, send, store })

    expect(await store.list()).toEqual([])
  })

  it('throws away what went stale while the browser was closed', async () => {
    const store = memoryBatchStore()
    await store.put({ at: 0, url: URL_, body: 'ancient' })
    const { send, calls } = recording()

    await replayOnce({ apiKey: KEY, send, store, now: () => Date.UTC(2026, 10, 3) })

    expect(calls).toEqual([])
    expect(await store.list()).toEqual([])
  })

  it('sends at most as many as it was told to', async () => {
    const store = memoryBatchStore()
    for (let at = 1; at <= 5; at++) {
      await store.put({ at: NOW + at, url: URL_, body: String(at) })
    }
    const { send, calls } = recording()

    await replayOnce({ apiKey: KEY, send, store, replayLimit: 2 })

    expect(calls).toHaveLength(2)
    expect((await store.list()).map((row: StoredBatch) => row.body)).toEqual(['3', '4', '5'])
  })

  it('does nothing when there is no store', async () => {
    configureOffline(false)
    const { send, calls } = recording()

    expect(await replayOnce({ apiKey: KEY, send })).toBe(0)
    expect(calls).toEqual([])
  })
})

describe('when the replay is run', () => {
  it('runs once at install, for what was left from last time', () => {
    let runs = 0

    installed.push(installOnlineReplay(() => (runs += 1), { target: window }))

    expect(runs).toBe(1)
  })

  it('runs again when the browser says it is back', () => {
    let runs = 0
    installed.push(installOnlineReplay(() => (runs += 1), { target: window }))

    window.dispatchEvent(new Event('online'))

    expect(runs).toBe(2)
  })

  it('stops running after uninstalling', () => {
    let runs = 0
    const uninstall = installOnlineReplay(() => (runs += 1), { target: window })

    uninstall()
    window.dispatchEvent(new Event('online'))

    expect(runs).toBe(1)
  })
})

describe('which answers mean keep waiting', () => {
  it.each([429, 500, 502, 503])('keeps a batch after %i', (status) => {
    expect(keepsWaiting(status)).toBe(true)
  })

  it.each([400, 401, 403, 413])('gives up on a batch after %i', (status) => {
    expect(keepsWaiting(status)).toBe(false)
  })
})
