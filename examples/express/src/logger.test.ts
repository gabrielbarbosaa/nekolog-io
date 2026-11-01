import { memorySink } from '@nekolog-io/node'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createExampleLogger,
  DEFAULT_SERVICE,
  FLUSH_INTERVAL_ENV,
  flushIntervalFrom,
  SENSITIVE_KEYS,
} from './logger.ts'

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

describe('the flush interval the example lets you shorten', () => {
  it('is left to the sdk when nothing asks for one', () => {
    expect(flushIntervalFrom(undefined)).toBeUndefined()
    expect(flushIntervalFrom('   ')).toBeUndefined()
  })

  it('is read as whole milliseconds', () => {
    expect(flushIntervalFrom('250')).toBe(250)
    expect(flushIntervalFrom('0')).toBe(0)
  })

  it.each(['-1', '1.5', 'soon', 'NaN'])('refuses %s instead of flushing at random', (value) => {
    expect(() => flushIntervalFrom(value)).toThrow(FLUSH_INTERVAL_ENV)
  })
})

describe('the service the example reports', () => {
  it('is the one the caller passed', () => {
    expect(createExampleLogger({ sink: memorySink(), service: 'checkout' }).resource.service).toBe(
      'checkout',
    )
  })

  it('falls back to the environment, then to a name of its own', () => {
    process.env.NEKOLOG_SERVICE = 'from-env'
    expect(createExampleLogger({ sink: memorySink() }).resource.service).toBe('from-env')

    delete process.env.NEKOLOG_SERVICE
    expect(createExampleLogger({ sink: memorySink() }).resource.service).toBe(DEFAULT_SERVICE)
  })
})

describe('the fields this example treats as personal', () => {
  it('strips them even though the sdk does not know them', () => {
    const sink = memorySink()
    createExampleLogger({ sink }).info('done', {
      customer: { email: 'ana@exemplo.com', phone: '+55 11 90000-0000' },
      orderId: 'ord_1',
    })

    expect(sink.events[0]?.attributes).toEqual({
      'customer.email': '[redacted]',
      'customer.phone': '[redacted]',
      orderId: 'ord_1',
    })
  })

  it('keeps what the caller added to the list', () => {
    const sink = memorySink()
    createExampleLogger({ sink, privacy: { extraKeys: ['nickname'] } }).info('done', {
      nickname: 'ana',
      email: 'ana@exemplo.com',
    })

    expect(sink.events[0]?.attributes).toEqual({ nickname: '[redacted]', email: '[redacted]' })
  })

  it('names no key so short that it would strip unrelated fields', () => {
    for (const key of SENSITIVE_KEYS) {
      expect(key.length).toBeGreaterThanOrEqual(5)
    }
  })
})
