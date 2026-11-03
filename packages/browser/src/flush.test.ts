import { createLogger as createCoreLogger, type Logger, type Sink } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFlushOnHide } from './flush.ts'
import { markVisible, pageIsHiding } from './hidden.ts'

const installed: Array<() => void> = []

function flushCounter(): { logger: Logger; count: () => number } {
  let flushes = 0
  const sink: Sink = {
    emit() {
      return
    },
    flush() {
      flushes += 1
      return Promise.resolve()
    },
  }
  return { logger: createCoreLogger({ sink }), count: () => flushes }
}

function visibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  markVisible()
  visibility('visible')
})

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
})

describe('when the page goes away', () => {
  it('flushes on pagehide, which is the last event a page reliably gets', async () => {
    const { logger, count } = flushCounter()
    installed.push(installFlushOnHide(logger, { target: window, document }))

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()

    expect(count()).toBe(1)
  })

  it('marks the page as hiding, so the batch leaves by beacon', () => {
    const { logger } = flushCounter()
    installed.push(installFlushOnHide(logger, { target: window, document }))

    expect(pageIsHiding()).toBe(false)
    window.dispatchEvent(new Event('pagehide'))

    expect(pageIsHiding()).toBe(true)
  })

  it('flushes when the tab is hidden, which is all some phones ever send', async () => {
    const { logger, count } = flushCounter()
    installed.push(installFlushOnHide(logger, { target: window, document }))

    visibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()

    expect(count()).toBe(1)
  })

  it('does not flush when the tab merely comes back', async () => {
    const { logger, count } = flushCounter()
    installed.push(installFlushOnHide(logger, { target: window, document }))

    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()

    expect(count()).toBe(0)
  })

  it('goes back to fetch when the page is restored from the back/forward cache', () => {
    const { logger } = flushCounter()
    installed.push(installFlushOnHide(logger, { target: window, document }))

    window.dispatchEvent(new Event('pagehide'))
    expect(pageIsHiding()).toBe(true)

    window.dispatchEvent(new Event('pageshow'))

    expect(pageIsHiding()).toBe(false)
  })

  it('goes back to fetch when the tab becomes visible again', () => {
    const { logger } = flushCounter()
    installed.push(installFlushOnHide(logger, { target: window, document }))

    visibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(pageIsHiding()).toBe(false)
  })
})

describe('after uninstalling', () => {
  it('nothing else is flushed', async () => {
    const { logger, count } = flushCounter()
    const uninstall = installFlushOnHide(logger, { target: window, document })

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    uninstall()
    markVisible()
    window.dispatchEvent(new Event('pagehide'))
    visibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()

    expect(count()).toBe(1)
  })
})
