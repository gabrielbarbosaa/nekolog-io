import { memorySink } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import { addContext, bindContext, currentContext, runWithContext } from './context.ts'
import { createLogger } from './logger.ts'

function setup() {
  const sink = memorySink()
  return { sink, logger: createLogger({ sink, level: 'trace' }) }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

describe('runWithContext', () => {
  it('reaches a logger created outside the scope', () => {
    const { logger, sink } = setup()

    runWithContext({ attributes: { requestId: 'r-1' } }, () => {
      logger.info('inside')
    })
    logger.info('outside')

    expect(sink.events.map((event) => event.attributes?.requestId)).toEqual(['r-1', undefined])
  })

  it('merges when nested, with the inner scope winning', () => {
    const { logger, sink } = setup()

    runWithContext({ attributes: { requestId: 'r-1', stage: 'outer' } }, () => {
      runWithContext({ attributes: { stage: 'inner' } }, () => {
        logger.info('deep')
      })
    })

    expect(sink.events[0]?.attributes).toEqual({ requestId: 'r-1', stage: 'inner' })
  })

  it('lets the call site win over the ambient context', () => {
    const { logger, sink } = setup()

    runWithContext({ attributes: { stage: 'ambient' } }, () => {
      logger.child({ attributes: { stage: 'child' } }).info('hello')
    })

    expect(sink.events[0]?.attributes).toEqual({ stage: 'child' })
  })

  it('carries trace and session, not just attributes', () => {
    const { logger, sink } = setup()
    const trace = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }

    runWithContext({ trace, session: { userId: 'u-7' } }, () => {
      logger.info('hello')
    })

    expect(sink.events[0]?.trace).toEqual(trace)
    expect(sink.events[0]?.session).toEqual({ userId: 'u-7' })
  })

  it('keeps concurrent requests apart', async () => {
    const { logger, sink } = setup()

    const request = async (id: string, pause: number) =>
      runWithContext({ attributes: { requestId: id } }, async () => {
        await sleep(pause)
        logger.info('step one')
        await sleep(pause)
        logger.info('step two')
      })

    await Promise.all([request('r-1', 12), request('r-2', 2), request('r-3', 6)])

    const byRequest = new Map<string, number>()
    for (const event of sink.events) {
      const id = String(event.attributes?.requestId)
      byRequest.set(id, (byRequest.get(id) ?? 0) + 1)
    }

    expect(sink.events).toHaveLength(6)
    expect([...byRequest.entries()].sort()).toEqual([
      ['r-1', 2],
      ['r-2', 2],
      ['r-3', 2],
    ])
  })

  it('survives the callback throwing, without leaking the scope', () => {
    expect(() =>
      runWithContext({ attributes: { requestId: 'r-1' } }, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(currentContext()).toBeUndefined()
  })

  it('gives back whatever the callback returns', () => {
    expect(runWithContext({}, () => 42)).toBe(42)
  })
})

describe('addContext', () => {
  it('adds to the scope already running', () => {
    const { logger, sink } = setup()

    runWithContext({ attributes: { requestId: 'r-1' } }, () => {
      logger.info('before login')
      addContext({ session: { userId: 'u-7' } })
      logger.info('after login')
    })

    expect(sink.events[0]?.session).toBeUndefined()
    expect(sink.events[1]?.session).toEqual({ userId: 'u-7' })
    expect(sink.events[1]?.attributes).toEqual({ requestId: 'r-1' })
  })

  it('does not reach the scope that contains this one', () => {
    const { logger, sink } = setup()

    runWithContext({ attributes: { requestId: 'r-1' } }, () => {
      runWithContext({}, () => {
        addContext({ attributes: { inner: true } })
      })
      logger.info('outer')
    })

    expect(sink.events[0]?.attributes).toEqual({ requestId: 'r-1' })
  })

  it('says no instead of pretending, when there is no scope', () => {
    expect(addContext({ attributes: { a: 1 } })).toBe(false)
  })
})

describe('bindContext', () => {
  it('carries the context into a callback run later', async () => {
    const { logger, sink } = setup()

    const handler = bindContext({ attributes: { job: 'nightly' } }, () => {
      logger.info('ran')
    })

    await sleep(1)
    handler()

    expect(sink.events[0]?.attributes).toEqual({ job: 'nightly' })
  })

  it('passes the arguments through and returns the result', () => {
    const doubled = bindContext({}, (value: number) => value * 2)

    expect(doubled(21)).toBe(42)
  })
})
