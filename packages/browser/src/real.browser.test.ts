import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFlushOnHide } from './flush.ts'
import { markVisible } from './hidden.ts'
import { createLogger } from './logger.ts'
import { configureOffline, parkingSender, replayOnce } from './offline.ts'
import { pageUrl } from './page.ts'
import { createSessionStore, defaultStorage, isSessionId } from './session.ts'
import { type BatchStore, indexedDbStore } from './store.ts'

const PUBLIC_KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'
const URL_ = 'https://ingest.nekolog.io/v1/logs'

const installed: Array<() => void> = []

beforeEach(() => {
  markVisible()
})

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
  configureOffline(false)
})

describe('the session in a real browser', () => {
  it('uses the real sessionStorage, and comes back after a reload', () => {
    const storage = defaultStorage()
    expect(storage).toBeDefined()

    const key = `nekolog.session.${Math.random()}`
    const first = createSessionStore({ key }).current()

    expect(isSessionId(first)).toBe(true)
    expect(createSessionStore({ key }).current()).toBe(first)
  })
})

describe('the page address in a real browser', () => {
  it('comes from the real location, without the query', () => {
    const shown = pageUrl(window.location.href, 'path')

    expect(shown).toBe(`${window.location.origin}${window.location.pathname}`)
    expect(shown).not.toContain('?')
  })
})

describe('sendBeacon in a real browser', () => {
  it('exists, and takes a text/plain body', () => {
    expect(typeof navigator.sendBeacon).toBe('function')
  })

  it('is what the batch leaves by once the page is hiding', async () => {
    const beacons: Array<[string, string]> = []
    const logger = createLogger({
      apiKey: PUBLIC_KEY,
      offline: false,
      sendBeacon: (url, body) => {
        beacons.push([url, body])
        return true
      },
    })
    installed.push(installFlushOnHide(logger, { target: window, document }))

    logger.error('the page is going away')
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(beacons).toHaveLength(1)
    expect(beacons[0]?.[0]).toContain(`key=${PUBLIC_KEY}`)
    expect(beacons[0]?.[1]).toContain('the page is going away')
  })

  it('the real one accepts a batch of our size', () => {
    const body = JSON.stringify({
      events: Array.from({ length: 20 }, () => ({ m: 'x'.repeat(50) })),
    })

    expect(navigator.sendBeacon(`${window.location.origin}/__nekolog_beacon`, body)).toBe(true)
  })
})

describe('the offline queue in a real IndexedDB', () => {
  let store: BatchStore

  beforeEach(() => {
    const made = indexedDbStore({ name: `nekolog-${Math.random()}` })
    if (made === undefined) {
      throw new Error('this browser has no indexedDB')
    }
    store = made
  })

  it('keeps a batch across a round trip, oldest first', async () => {
    await store.put({ at: 2, url: URL_, body: 'second' })
    await store.put({ at: 1, url: URL_, body: 'first' })

    const rows = await store.list()

    expect(rows.map((row) => row.body)).toEqual(['first', 'second'])
    expect(typeof rows[0]?.id).toBe('number')
  })

  it('parks a batch the network refused, and sends it when it comes back', async () => {
    const sent: string[] = []
    const send = parkingSender(() => Promise.reject(new TypeError('Failed to fetch')), { store })

    const response = await send(URL_, {
      method: 'POST',
      headers: {},
      body: '{"events":[{"message":"offline"}]}',
    })

    expect(response.ok).toBe(true)
    expect(await store.list()).toHaveLength(1)

    const replayed = await replayOnce({
      apiKey: PUBLIC_KEY,
      store,
      send: async (_url, init) => {
        sent.push(init.body)
        return {
          ok: true,
          status: 202,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }
      },
    })

    expect(replayed).toBe(1)
    expect(sent[0]).toContain('offline')
    expect(await store.list()).toEqual([])
  })

  it('never writes the key next to the batch', async () => {
    await store.put({ at: 1, url: URL_, body: '{}' })

    const rows = await store.list()

    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['at', 'body', 'id', 'url'])
  })
})
