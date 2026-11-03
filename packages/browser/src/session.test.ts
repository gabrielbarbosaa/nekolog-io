import { describe, expect, it } from 'vitest'
import {
  createSessionStore,
  DEFAULT_SESSION_IDLE_MS,
  isSessionId,
  readStored,
  SESSION_STORAGE_KEY,
  SESSION_WRITE_INTERVAL_MS,
  type StorageLike,
} from './session.ts'

function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  writes: number
  items: Record<string, string>
} {
  const items = { ...initial }
  return {
    items,
    writes: 0,
    getItem(key) {
      return items[key] ?? null
    },
    setItem(key, value) {
      this.writes += 1
      items[key] = value
    },
    removeItem(key) {
      delete items[key]
    },
  }
}

function stored(id: string, seen: number): string {
  return JSON.stringify({ id, seen })
}

const AN_ID = '0193b5f0-1234-7abc-8def-0123456789ab'

describe('the session identifier', () => {
  it('is a uuid and nothing else', () => {
    expect(isSessionId(AN_ID)).toBe(true)
    expect(isSessionId('')).toBe(false)
    expect(isSessionId('../../etc/passwd')).toBe(false)
    expect(isSessionId(AN_ID.toUpperCase())).toBe(false)
    expect(isSessionId(AN_ID.repeat(40))).toBe(false)
  })

  it('is new on the first visit', () => {
    const storage = fakeStorage()
    const store = createSessionStore({ storage, now: () => 1_000 })

    const id = store.current()

    expect(isSessionId(id)).toBe(true)
    expect(storage.items[SESSION_STORAGE_KEY]).toBe(stored(id, 1_000))
  })

  it('survives a reload within the same tab', () => {
    const storage = fakeStorage()
    const first = createSessionStore({ storage, now: () => 1_000 }).current()

    const second = createSessionStore({ storage, now: () => 2_000 }).current()

    expect(second).toBe(first)
  })

  it('starts over after the idle window', () => {
    const storage = fakeStorage()
    const first = createSessionStore({ storage, now: () => 0 }).current()

    const later = createSessionStore({
      storage,
      now: () => DEFAULT_SESSION_IDLE_MS + 1,
    }).current()

    expect(later).not.toBe(first)
  })

  it('keeps the same session while the tab is in use', () => {
    const storage = fakeStorage()
    let clock = 0
    const store = createSessionStore({ storage, now: () => clock })
    const first = store.current()

    for (let i = 0; i < 200; i++) {
      clock += DEFAULT_SESSION_IDLE_MS / 2
      expect(store.current()).toBe(first)
    }
  })

  it('starts over when the tab went quiet for longer than the idle window', () => {
    const storage = fakeStorage()
    let clock = 0
    const store = createSessionStore({ storage, now: () => clock })
    const first = store.current()

    clock = DEFAULT_SESSION_IDLE_MS + 1

    expect(store.current()).not.toBe(first)
  })

  it('does not write to storage on every single log', () => {
    const storage = fakeStorage()
    let clock = 0
    const store = createSessionStore({ storage, now: () => clock })
    store.current()
    const afterStart = storage.writes

    for (let i = 0; i < 100; i++) {
      clock += 1
      store.current()
    }

    expect(storage.writes).toBe(afterStart)

    clock += SESSION_WRITE_INTERVAL_MS
    store.current()

    expect(storage.writes).toBe(afterStart + 1)
  })

  it('reset gives a different session right away', () => {
    const store = createSessionStore({ storage: fakeStorage(), now: () => 1_000 })
    const first = store.current()

    const second = store.reset()

    expect(second).not.toBe(first)
    expect(store.current()).toBe(second)
  })
})

describe('what the stored value is allowed to be', () => {
  const now = 10_000

  it.each([
    ['not json', 'not json at all'],
    ['a bare string', `"${AN_ID}"`],
    ['an array', '[]'],
    ['null', 'null'],
    ['no identifier', JSON.stringify({ seen: now })],
    ['an identifier that is not a uuid', stored('<script>alert(1)</script>', now)],
    ['an identifier of the wrong case', stored(AN_ID.toUpperCase(), now)],
    ['no timestamp', JSON.stringify({ id: AN_ID })],
    ['a timestamp that is not a number', JSON.stringify({ id: AN_ID, seen: '10000' })],
    ['a timestamp that is not finite', JSON.stringify({ id: AN_ID, seen: null })],
  ])('refuses %s', (_case, raw) => {
    expect(readStored(raw, now, DEFAULT_SESSION_IDLE_MS)).toBeNull()
  })

  it('refuses a timestamp from the future, which is a clock that jumped', () => {
    const raw = stored(AN_ID, now + DEFAULT_SESSION_IDLE_MS + 1)

    expect(readStored(raw, now, DEFAULT_SESSION_IDLE_MS)).toBeNull()
  })

  it('accepts what it wrote itself', () => {
    expect(readStored(stored(AN_ID, now), now, DEFAULT_SESSION_IDLE_MS)).toBe(AN_ID)
  })

  it('mints a fresh session instead of trusting a poisoned one', () => {
    const storage = fakeStorage({ [SESSION_STORAGE_KEY]: stored('a'.repeat(5_000), 0) })

    const id = createSessionStore({ storage, now: () => 0 }).current()

    expect(isSessionId(id)).toBe(true)
  })
})

describe('storage that is not there', () => {
  it('still produces a session when storage is refused', () => {
    const exploding: StorageLike = {
      getItem() {
        throw new Error('The user disabled storage')
      },
      setItem() {
        throw new Error('The user disabled storage')
      },
      removeItem() {
        throw new Error('The user disabled storage')
      },
    }

    const store = createSessionStore({ storage: exploding, now: () => 0 })

    expect(isSessionId(store.current())).toBe(true)
  })

  it('still produces a session with no storage at all', () => {
    const store = createSessionStore({ storage: false, now: () => 0 })

    expect(isSessionId(store.current())).toBe(true)
  })

  it('keeps the session in memory when it cannot be written down', () => {
    const store = createSessionStore({ storage: false, now: () => 0 })

    expect(store.current()).toBe(store.current())
  })
})
