import { uuidv7 } from '@nekolog-io/core'

export const SESSION_STORAGE_KEY = 'nekolog.session'
export const DEFAULT_SESSION_IDLE_MS: number = 30 * 60 * 1000
export const SESSION_WRITE_INTERVAL_MS: number = 60 * 1000

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type SessionOptions = {
  storage?: StorageLike | false
  key?: string
  idleMs?: number
  now?: () => number
}

export type SessionStore = {
  current(): string
  reset(): string
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

export function readStored(raw: string | null, now: number, idleMs: number): string | null {
  if (raw === null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const { id, seen } = parsed as { id?: unknown; seen?: unknown }
  if (!isSessionId(id) || typeof seen !== 'number' || !Number.isFinite(seen)) {
    return null
  }

  return Math.abs(now - seen) > idleMs ? null : id
}

export function defaultStorage(): StorageLike | undefined {
  try {
    const candidate = (globalThis as { sessionStorage?: StorageLike }).sessionStorage
    if (!candidate) {
      return undefined
    }
    candidate.getItem(SESSION_STORAGE_KEY)
    return candidate
  } catch {
    return undefined
  }
}

export function createSessionStore(options: SessionOptions = {}): SessionStore {
  const now = options.now ?? Date.now
  const key = options.key ?? SESSION_STORAGE_KEY
  const idleMs =
    typeof options.idleMs === 'number' && options.idleMs > 0
      ? options.idleMs
      : DEFAULT_SESSION_IDLE_MS
  const storage = options.storage === false ? undefined : (options.storage ?? defaultStorage())

  let id: string | null = null
  let writtenAt = 0

  const persist = (value: string, at: number): void => {
    writtenAt = at
    if (!storage) {
      return
    }
    try {
      storage.setItem(key, JSON.stringify({ id: value, seen: at }))
    } catch {
      return
    }
  }

  const restore = (at: number): string | null => {
    if (!storage) {
      return null
    }
    try {
      return readStored(storage.getItem(key), at, idleMs)
    } catch {
      return null
    }
  }

  const start = (at: number): string => {
    const fresh = uuidv7()
    id = fresh
    persist(fresh, at)
    return fresh
  }

  return {
    current() {
      const at = now()

      if (id === null) {
        const restored = restore(at)
        if (restored === null) {
          return start(at)
        }
        id = restored
        persist(restored, at)
        return restored
      }

      if (at - writtenAt > idleMs) {
        return start(at)
      }
      if (at - writtenAt >= SESSION_WRITE_INTERVAL_MS) {
        persist(id, at)
      }
      return id
    },
    reset() {
      return start(now())
    },
  }
}
