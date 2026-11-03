import { memorySink } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BREADCRUMBS_ATTRIBUTE, type Breadcrumb } from './breadcrumbs.ts'
import { configureSession } from './context.ts'
import { createLogger } from './logger.ts'
import { addBreadcrumb, breadcrumbTrail, clearBreadcrumbs, configureBreadcrumbs } from './trail.ts'

function trailOf(attributes: Record<string, unknown> | undefined): Breadcrumb[] {
  return JSON.parse(String(attributes?.[BREADCRUMBS_ATTRIBUTE])) as Breadcrumb[]
}

beforeEach(() => {
  configureSession({ storage: false })
  configureBreadcrumbs()
})

afterEach(() => {
  clearBreadcrumbs()
})

describe('what the trail is attached to', () => {
  it('rides along with the error, where it is worth the bytes', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')

    createLogger({ sink }).error('payment failed')

    expect(trailOf(sink.events[0]?.attributes)[0]?.message).toBe('clicked pay')
  })

  it('stays off the ordinary lines, which would blow the batch limit', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')
    const logger = createLogger({ sink, level: 'trace' })

    logger.info('checkout opened')
    logger.warn('card about to expire')

    expect(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeUndefined()
    expect(sink.events[1]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeUndefined()
  })

  it('rides along from the level the caller chose', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')

    createLogger({ sink, breadcrumbs: { attachFrom: 'info' } }).info('checkout opened')

    expect(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeDefined()
  })

  it('rides along with nothing when the caller turns it off', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')

    createLogger({ sink, breadcrumbs: { attachFrom: false } }).error('payment failed')

    expect(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeUndefined()
  })

  it('adds no attribute when nothing has happened yet', () => {
    const sink = memorySink()

    createLogger({ sink }).error('payment failed')

    expect(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeUndefined()
  })

  it('keeps the attributes the caller passed', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')

    createLogger({ sink }).error('payment failed', { orderId: 'ord_7' })

    expect(sink.events[0]?.attributes?.orderId).toBe('ord_7')
    expect(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeDefined()
  })
})

describe('the caller own beforeSend', () => {
  it('still runs, and sees the trail', () => {
    const sink = memorySink()
    let seen: unknown
    addBreadcrumb('clicked pay')

    createLogger({
      sink,
      beforeSend: (event) => {
        seen = event.attributes?.[BREADCRUMBS_ATTRIBUTE]
        return event
      },
    }).error('payment failed')

    expect(seen).toBeDefined()
  })

  it('can take the trail back off', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')

    createLogger({
      sink,
      beforeSend: (event) => {
        const { [BREADCRUMBS_ATTRIBUTE]: _dropped, ...rest } = event.attributes ?? {}
        return { ...event, attributes: rest }
      },
    }).error('payment failed')

    expect(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeUndefined()
  })

  it('can still drop the event entirely', () => {
    const sink = memorySink()
    addBreadcrumb('clicked pay')

    createLogger({ sink, beforeSend: () => null }).error('payment failed')

    expect(sink.events).toEqual([])
  })
})

describe('the sensitive data filter', () => {
  it('reaches inside the trail, because a breadcrumb is an attribute like any other', () => {
    const sink = memorySink()
    addBreadcrumb('typed 4111111111111111 into the card field')

    createLogger({ sink }).error('payment failed')

    const text = String(sink.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE])
    expect(text).not.toContain('4111111111111111')
    expect(text).toContain('[redacted]')
  })

  it('leaves json the dashboard can still read', () => {
    const sink = memorySink()
    addBreadcrumb('GET https://api.test/me with Bearer abcdefghijklmnop')

    createLogger({ sink }).error('payment failed')

    const crumbs = trailOf(sink.events[0]?.attributes)
    expect(crumbs[0]?.message).not.toContain('abcdefghijklmnop')
  })
})

describe('a breadcrumb the app adds by hand', () => {
  it('is kept with the data it carries', () => {
    addBreadcrumb('coupon applied', { code: 'WELCOME' })

    expect(breadcrumbTrail().list()[0]).toMatchObject({
      kind: 'custom',
      message: 'coupon applied',
      data: { code: 'WELCOME' },
    })
  })

  it.each(['', 42, null, undefined])('is refused when the message is %j', (message) => {
    addBreadcrumb(message as string)

    expect(breadcrumbTrail().list()).toEqual([])
  })
})
