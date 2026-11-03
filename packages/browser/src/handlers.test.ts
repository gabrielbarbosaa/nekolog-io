import { createLogger as createCoreLogger, type LogEvent, memorySink } from '@nekolog-io/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ERROR_COLUMN_ATTRIBUTE,
  ERROR_KIND_ATTRIBUTE,
  ERROR_LINE_ATTRIBUTE,
  ERROR_SOURCE_ATTRIBUTE,
  installGlobalHandlers,
  UNCAUGHT,
  UNHANDLED_REJECTION,
} from './handlers.ts'

const installed: Array<() => void> = []

function watching(): { events: LogEvent[] } {
  const sink = memorySink()
  const logger = createCoreLogger({ sink, level: 'trace' })
  installed.push(installGlobalHandlers(logger, { target: window }))
  return sink
}

function errorEvent(detail: Partial<ErrorEvent>): ErrorEvent {
  return new ErrorEvent('error', { cancelable: true, ...detail })
}

function rejectionEvent(reason: unknown): Event {
  const event = new Event('unhandledrejection', { cancelable: true })
  Object.defineProperty(event, 'reason', { value: reason })
  return event
}

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
})

describe('an error nobody caught', () => {
  it('is logged with the error itself', () => {
    const sink = watching()
    const boom = new TypeError('cannot read properties of undefined')

    window.dispatchEvent(errorEvent({ error: boom, message: 'Uncaught TypeError' }))

    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]?.level).toBe('error')
    expect(sink.events[0]?.message).toBe('cannot read properties of undefined')
    expect(sink.events[0]?.error?.type).toBe('TypeError')
    expect(sink.events[0]?.attributes?.[ERROR_KIND_ATTRIBUTE]).toBe(UNCAUGHT)
  })

  it('records where in the bundle it happened', () => {
    const sink = watching()

    window.dispatchEvent(
      errorEvent({
        error: new Error('boom'),
        filename: 'https://shop.test/assets/main-a1b2.js',
        lineno: 12,
        colno: 7,
      }),
    )

    expect(sink.events[0]?.attributes?.[ERROR_SOURCE_ATTRIBUTE]).toBe(
      'https://shop.test/assets/main-a1b2.js',
    )
    expect(sink.events[0]?.attributes?.[ERROR_LINE_ATTRIBUTE]).toBe(12)
    expect(sink.events[0]?.attributes?.[ERROR_COLUMN_ATTRIBUTE]).toBe(7)
  })

  it('falls back to the message when the browser hides the error object', () => {
    const sink = watching()

    window.dispatchEvent(errorEvent({ message: 'Script error.' }))

    expect(sink.events[0]?.message).toBe('Script error.')
  })

  it('still says something when there is neither an error nor a message', () => {
    const sink = watching()

    window.dispatchEvent(errorEvent({ message: '' }))

    expect(sink.events[0]?.message).toBe('Uncaught error')
  })

  it('does not stop the browser from reporting it as well', () => {
    watching()
    const event = errorEvent({ error: new Error('boom') })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})

describe('a promise nobody caught', () => {
  it('is logged with the reason', () => {
    const sink = watching()

    window.dispatchEvent(rejectionEvent(new Error('the request failed')))

    expect(sink.events[0]?.message).toBe('the request failed')
    expect(sink.events[0]?.attributes?.[ERROR_KIND_ATTRIBUTE]).toBe(UNHANDLED_REJECTION)
  })

  it('is logged even when the reason is not an error', () => {
    const sink = watching()

    window.dispatchEvent(rejectionEvent('just a string'))

    expect(sink.events[0]?.message).toBe('just a string')
  })

  it('says something when there is no reason at all', () => {
    const sink = watching()

    window.dispatchEvent(rejectionEvent(undefined))

    expect(sink.events[0]?.message).toBe('Unhandled promise rejection')
  })
})

describe('after uninstalling', () => {
  it('nothing else is logged', () => {
    const sink = memorySink()
    const logger = createCoreLogger({ sink, level: 'trace' })
    const uninstall = installGlobalHandlers(logger, { target: window })

    window.dispatchEvent(errorEvent({ error: new Error('first') }))
    uninstall()
    window.dispatchEvent(errorEvent({ error: new Error('second') }))
    window.dispatchEvent(rejectionEvent(new Error('third')))

    expect(sink.events.map((event) => event.message)).toEqual(['first'])
  })
})

describe('a logger that itself fails', () => {
  it('cannot loop, because the handler refuses to re-enter', () => {
    let calls = 0
    const logger = createCoreLogger({
      level: 'trace',
      sink: {
        emit() {
          calls += 1
          window.dispatchEvent(errorEvent({ error: new Error('from inside the sink') }))
        },
      },
    })
    installed.push(installGlobalHandlers(logger, { target: window }))

    window.dispatchEvent(errorEvent({ error: new Error('the first one') }))

    expect(calls).toBe(1)
  })
})
