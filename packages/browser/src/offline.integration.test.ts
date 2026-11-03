import type { FetchLike } from '@nekolog-io/core'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { init } from './client.ts'
import { configureOffline } from './offline.ts'
import { type BatchStore, indexedDbStore, type StoredBatch } from './store.ts'

const PUBLIC_KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'

async function until(ready: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (ready()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`gave up waiting for ${what}`)
}

type Call = { url: string; body: string }

describe('a page that loses the network and comes back', () => {
  const calls: Call[] = []
  let store: BatchStore
  let online = false
  let client: ReturnType<typeof init> | undefined

  const send: FetchLike = async (url, init) => {
    if (!online) {
      throw new TypeError('Failed to fetch')
    }
    calls.push({ url, body: init.body })
    return {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: () => Promise.resolve('{"accepted":1}'),
    }
  }

  beforeEach(() => {
    calls.length = 0
    online = false
    const made = indexedDbStore({ factory: new IDBFactory(), name: `nekolog-${Math.random()}` })
    if (made === undefined) {
      throw new Error('fake-indexeddb did not provide a factory')
    }
    store = configureOffline(made) as BatchStore
    client = init({
      apiKey: PUBLIC_KEY,
      service: 'checkout-web',
      session: { storage: false },
      fetch: send,
      sendBeacon: false,
      globalHandlers: false,
      flushOnHide: false,
      breadcrumbs: { clicks: false, navigation: false, fetch: false },
    })
  })

  afterEach(async () => {
    await client?.close()
    client = undefined
    configureOffline(false)
  })

  it('keeps the log on disk until the network is back', async () => {
    client?.logger.error('payment failed while offline')
    await client?.flush()

    expect(calls).toEqual([])

    const parked = await store.list()
    expect(parked).toHaveLength(1)
    expect((parked[0] as StoredBatch).body).toContain('payment failed while offline')

    online = true
    window.dispatchEvent(new Event('online'))
    await until(() => calls.length === 1, 'the parked batch to be sent')

    expect(calls[0]?.body).toContain('payment failed while offline')
    expect(await store.list()).toEqual([])
  })

  it('never writes the key next to the batch', async () => {
    client?.logger.error('payment failed while offline')
    await client?.flush()

    const parked = await store.list()

    expect(JSON.stringify(parked)).not.toContain(PUBLIC_KEY)
  })

  it('sends what the last visit left behind, without waiting for an online event', async () => {
    client?.logger.error('from the visit before')
    await client?.flush()
    await client?.close()
    client = undefined

    online = true
    client = init({
      apiKey: PUBLIC_KEY,
      session: { storage: false },
      fetch: send,
      sendBeacon: false,
      globalHandlers: false,
      flushOnHide: false,
      breadcrumbs: { clicks: false, navigation: false, fetch: false },
    })
    await until(() => calls.length === 1, 'the batch from the last visit to be sent')

    expect(calls[0]?.body).toContain('from the visit before')
  })
})
