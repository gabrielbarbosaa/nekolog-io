import type { FetchLike } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import { BEACON_MAX_BYTES, createSender, keyedUrl, type SendBeaconLike } from './beacon.ts'

const KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'
const URL_ = 'https://ingest.nekolog.io/v1/logs'

type Call = { url: string; init: Parameters<FetchLike>[1] }

function recordingFetch(): { send: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const send: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: () => Promise.resolve('{"accepted":1}'),
    }
  }
  return { send, calls }
}

function recordingBeacon(answer = true): { send: SendBeaconLike; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = []
  const send: SendBeaconLike = (url, body) => {
    calls.push([url, body])
    return answer
  }
  return { send, calls }
}

const BODY = '{"events":[]}'
const INIT = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: BODY }

describe('the key in the address', () => {
  it('appends it to a plain endpoint', () => {
    expect(keyedUrl(URL_, KEY)).toBe(`${URL_}?key=${KEY}`)
  })

  it('appends it to an endpoint that already has a query', () => {
    expect(keyedUrl(`${URL_}?x=1`, KEY)).toBe(`${URL_}?x=1&key=${KEY}`)
  })

  it('escapes a key that would otherwise forge another parameter', () => {
    expect(keyedUrl(URL_, 'a&b=c')).toBe(`${URL_}?key=a%26b%3Dc`)
  })
})

describe('how a batch leaves the page', () => {
  it('uses fetch while the page is on screen, and keeps the key out of the address', async () => {
    const fetch = recordingFetch()
    const beacon = recordingBeacon()
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: beacon.send,
      hiding: () => false,
    })

    await send(URL_, INIT)

    expect(beacon.calls).toEqual([])
    expect(fetch.calls[0]?.url).toBe(URL_)
    expect(fetch.calls[0]?.init.keepalive).toBe(true)
  })

  it('uses the beacon once the page is going away, because fetch may be killed', async () => {
    const fetch = recordingFetch()
    const beacon = recordingBeacon()
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: beacon.send,
      hiding: () => true,
    })

    const response = await send(URL_, INIT)

    expect(beacon.calls).toEqual([[`${URL_}?key=${KEY}`, BODY]])
    expect(fetch.calls).toEqual([])
    expect(response.ok).toBe(true)
  })

  it('carries the key in the address only on the beacon, which cannot send a header', async () => {
    const fetch = recordingFetch()
    const beacon = recordingBeacon()
    let hiding = false
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: beacon.send,
      hiding: () => hiding,
    })

    await send(URL_, INIT)
    hiding = true
    await send(URL_, INIT)

    expect(fetch.calls[0]?.url).not.toContain('key=')
    expect(fetch.calls[0]?.init.headers).toEqual(INIT.headers)
    expect(beacon.calls[0]?.[0]).toContain(`key=${KEY}`)
  })

  it('falls back to fetch when the browser refuses the beacon', async () => {
    const fetch = recordingFetch()
    const beacon = recordingBeacon(false)
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: beacon.send,
      hiding: () => true,
    })

    await send(URL_, INIT)

    expect(beacon.calls).toHaveLength(1)
    expect(fetch.calls).toHaveLength(1)
  })

  it('falls back to fetch when the beacon throws', async () => {
    const fetch = recordingFetch()
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: () => {
        throw new Error('The browser said no')
      },
      hiding: () => true,
    })

    await send(URL_, INIT)

    expect(fetch.calls).toHaveLength(1)
  })

  it('does not hand the beacon a body past the browser limit', async () => {
    const fetch = recordingFetch()
    const beacon = recordingBeacon()
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: beacon.send,
      hiding: () => true,
    })

    await send(URL_, { ...INIT, body: 'x'.repeat(BEACON_MAX_BYTES + 1) })

    expect(beacon.calls).toEqual([])
    expect(fetch.calls).toHaveLength(1)
  })

  it('measures that limit in bytes, not in characters', async () => {
    const fetch = recordingFetch()
    const beacon = recordingBeacon()
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: beacon.send,
      hiding: () => true,
    })

    await send(URL_, { ...INIT, body: '😿'.repeat(BEACON_MAX_BYTES / 4) })

    expect(beacon.calls).toHaveLength(1)

    await send(URL_, { ...INIT, body: '😿'.repeat(BEACON_MAX_BYTES / 4 + 1) })

    expect(beacon.calls).toHaveLength(1)
    expect(fetch.calls).toHaveLength(1)
  })

  it('uses fetch when the page has no beacon at all', async () => {
    const fetch = recordingFetch()
    const send = createSender({
      apiKey: KEY,
      fetch: fetch.send,
      sendBeacon: false,
      hiding: () => true,
    })

    await send(URL_, INIT)

    expect(fetch.calls).toHaveLength(1)
  })
})
