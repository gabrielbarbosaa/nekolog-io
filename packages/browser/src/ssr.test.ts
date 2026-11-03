// @vitest-environment node

import { memorySink } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import { init } from './client.ts'
import { sessionId } from './context.ts'
import { installFlushOnHide } from './flush.ts'
import { installGlobalHandlers } from './handlers.ts'
import { createLogger } from './logger.ts'

describe('the same bundle rendered on a server', () => {
  it('has no window to hook into, and says nothing about it', () => {
    const logger = createLogger({ sink: memorySink() })

    expect(() => installGlobalHandlers(logger)()).not.toThrow()
    expect(() => installFlushOnHide(logger)()).not.toThrow()
  })

  it('still logs, so a shared component does not have to know where it runs', () => {
    const sink = memorySink()

    createLogger({ sink }).info('rendered on the server')

    expect(sink.events).toHaveLength(1)
  })

  it('still has a session, kept in memory because there is no storage', () => {
    expect(sessionId()).toBe(sessionId())
  })

  it('starts up without touching anything that is not there', () => {
    const sink = memorySink()

    const client = init({ sink })

    expect(() => client.setUser('u_42')).not.toThrow()
    expect(client.logger.resource.runtime).toBe('browser')
  })
})
