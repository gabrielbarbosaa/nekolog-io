import {
  decisionForStatus,
  type FetchLike,
  type FetchResponseLike,
  headersFor,
} from '@nekolog-io/core'
import { type EventTargetLike, globalWindow } from './globals.ts'
import { type BatchStore, indexedDbStore, type StoredBatch } from './store.ts'

export const DEFAULT_REPLAY_LIMIT = 20

const PARKED: FetchResponseLike = {
  ok: true,
  status: 202,
  headers: { get: () => null },
  text: () => Promise.resolve(''),
}

export type OfflineTuning = {
  maxBatches?: number
  maxBytes?: number
  maxAgeMs?: number
  replayLimit?: number
}

let shared: BatchStore | undefined | null

export function offlineStore(): BatchStore | undefined {
  if (shared === undefined) {
    shared = indexedDbStore() ?? null
  }
  return shared ?? undefined
}

export function configureOffline(store: BatchStore | false): BatchStore | undefined {
  shared = store === false ? null : store
  return shared ?? undefined
}

export type ParkingOptions = OfflineTuning & {
  store?: BatchStore
  now?: () => number
  onError?: (error: unknown) => void
}

export function parkingSender(inner: FetchLike, options: ParkingOptions = {}): FetchLike {
  const now = options.now ?? Date.now

  return async (url, init) => {
    try {
      return await inner(url, init)
    } catch (unreachable) {
      const store = options.store ?? offlineStore()
      if (store === undefined) {
        throw unreachable
      }
      try {
        await store.put({ at: now(), url, body: init.body })
        await store.prune({ ...options, now: now() })
      } catch (refused) {
        options.onError?.(refused)
        throw unreachable
      }
      return PARKED
    }
  }
}

export type ReplayOptions = OfflineTuning & {
  apiKey: string
  send: FetchLike
  store?: BatchStore
  now?: () => number
  onError?: (error: unknown) => void
}

export function keepsWaiting(status: number): boolean {
  return decisionForStatus(status) === 'retry'
}

export async function replayOnce(options: ReplayOptions): Promise<number> {
  const store = options.store ?? offlineStore()
  if (store === undefined) {
    return 0
  }

  const headers = headersFor(options.apiKey)
  let sent = 0

  try {
    await store.prune({ ...options, now: (options.now ?? Date.now)() })

    const pending: StoredBatch[] = await store.list(options.replayLimit ?? DEFAULT_REPLAY_LIMIT)
    for (const batch of pending) {
      let response: FetchResponseLike
      try {
        response = await options.send(batch.url, { method: 'POST', headers, body: batch.body })
      } catch (stillOffline) {
        options.onError?.(stillOffline)
        return sent
      }

      if (!response.ok && keepsWaiting(response.status)) {
        return sent
      }

      await store.remove(batch.id)
      sent += 1
    }
  } catch (error) {
    options.onError?.(error)
  }

  return sent
}

export type OnlineReplayOptions = {
  target?: EventTargetLike
  immediately?: boolean
}

export function installOnlineReplay(
  replay: () => void,
  options: OnlineReplayOptions = {},
): () => void {
  const target = options.target ?? globalWindow()
  if (options.immediately !== false) {
    replay()
  }
  if (target === undefined) {
    return () => undefined
  }

  const onOnline = (): void => replay()
  target.addEventListener('online', onOnline)

  return () => {
    target.removeEventListener('online', onOnline)
  }
}
