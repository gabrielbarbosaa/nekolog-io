import { describe, expect, it } from 'vitest'
import { DEFAULT_RATE_LIMIT_ENTRIES, memoryRateLimiter } from './memory-rate-limiter'

function clock(start = 0) {
  let at = start
  return {
    now: () => at,
    advance(ms: number) {
      at += ms
    },
  }
}

describe('memoryRateLimiter', () => {
  it('spends the window budget and then refuses', async () => {
    const limiter = memoryRateLimiter()

    expect(await limiter.consume('e_1', 10, 60, 4)).toMatchObject({ allowed: true, remaining: 6 })
    expect(await limiter.consume('e_1', 10, 60, 6)).toMatchObject({ allowed: true, remaining: 0 })
    expect(await limiter.consume('e_1', 10, 60, 1)).toMatchObject({ allowed: false })
  })

  it('charges nothing for the batch it refused', async () => {
    const limiter = memoryRateLimiter()

    await limiter.consume('e_1', 10, 60, 9)
    expect(await limiter.consume('e_1', 10, 60, 5)).toMatchObject({ allowed: false })
    expect(await limiter.consume('e_1', 10, 60, 1)).toMatchObject({ allowed: true, remaining: 0 })
  })

  it('gives every key its own budget', async () => {
    const limiter = memoryRateLimiter()

    await limiter.consume('e_1', 2, 60, 2)
    expect(await limiter.consume('e_1', 2, 60, 1)).toMatchObject({ allowed: false })
    expect(await limiter.consume('e_2', 2, 60, 2)).toMatchObject({ allowed: true })
  })

  it('opens a fresh window once the old one has run out', async () => {
    const time = clock(1_000)
    const limiter = memoryRateLimiter({ now: time.now })

    await limiter.consume('e_1', 5, 60, 5)
    time.advance(59_999)
    expect(await limiter.consume('e_1', 5, 60, 1)).toMatchObject({ allowed: false })

    time.advance(1)
    expect(await limiter.consume('e_1', 5, 60, 5)).toMatchObject({ allowed: true, remaining: 0 })
  })

  it('says how long the caller has to wait, and never says zero', async () => {
    const time = clock(0)
    const limiter = memoryRateLimiter({ now: time.now })

    await limiter.consume('e_1', 1, 60, 1)
    expect(await limiter.consume('e_1', 1, 60, 1)).toMatchObject({ retryAfterSeconds: 60 })

    time.advance(30_000)
    expect(await limiter.consume('e_1', 1, 60, 1)).toMatchObject({ retryAfterSeconds: 30 })

    time.advance(29_900)
    expect(await limiter.consume('e_1', 1, 60, 1)).toMatchObject({ retryAfterSeconds: 1 })
  })

  it('never lets through a batch larger than the whole window budget', async () => {
    const limiter = memoryRateLimiter()

    expect(await limiter.consume('e_1', 100, 60, 500)).toMatchObject({ allowed: false })
    expect(await limiter.consume('e_1', 100, 60, 500)).toMatchObject({ allowed: false })
  })

  it('allows a zero-event call without spending anything', async () => {
    const limiter = memoryRateLimiter()

    expect(await limiter.consume('e_1', 1, 60, 0)).toMatchObject({ allowed: true, remaining: 1 })
    expect(await limiter.consume('e_1', 1, 60, 1)).toMatchObject({ allowed: true })
  })

  it.each([
    ['limit', Number.NaN, 60, 1],
    ['limit', Number.POSITIVE_INFINITY, 60, 1],
    ['limit', -1, 60, 1],
    ['window', 10, Number.NaN, 1],
    ['cost', 10, 60, Number.NaN],
    ['cost', 10, 60, -5],
  ])('refuses rather than guesses when the %s is nonsense', async (_what, limit, window, cost) => {
    const limiter = memoryRateLimiter()

    expect(await limiter.consume('e_1', limit, window, cost)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    })
  })

  it('forgets the oldest key rather than growing without bound', async () => {
    const limiter = memoryRateLimiter({ maxEntries: 10 })

    await limiter.consume('victim', 5, 60, 5)
    expect(await limiter.consume('victim', 5, 60, 1)).toMatchObject({ allowed: false })

    for (let i = 0; i < 50; i += 1) {
      await limiter.consume(`flood_${i}`, 5, 60, 1)
    }

    expect(await limiter.consume('victim', 5, 60, 5)).toMatchObject({ allowed: true })
  })

  it('ships a default entry budget', () => {
    expect(DEFAULT_RATE_LIMIT_ENTRIES).toBeGreaterThan(0)
  })
})
