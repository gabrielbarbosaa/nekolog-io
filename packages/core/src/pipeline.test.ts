import { describe, expect, it, vi } from 'vitest'
import { MAX_MESSAGE_BYTES } from './limits.ts'
import { createLogger } from './logger.ts'
import { REDACTED } from './redact.ts'
import { memorySink } from './sinks.ts'
import type { LogEvent, LoggerOptions } from './types.ts'

const FIXED_NOW = Date.UTC(2026, 9, 31, 12, 0, 0, 0)

function setup(options: Partial<LoggerOptions> = {}) {
  const sink = memorySink()
  const logger = createLogger({ sink, now: () => FIXED_NOW, level: 'trace', ...options })
  return { logger, sink }
}

describe('privacy in the logger', () => {
  it('strips sensitive data without being asked', () => {
    const { logger, sink } = setup()

    logger.info('login for 529.982.247-25', { user: { name: 'ana', password: 'hunter2' } })

    expect(sink.events[0]?.message).toBe(`login for ${REDACTED}`)
    expect(sink.events[0]?.attributes).toEqual({
      'user.name': 'ana',
      'user.password': REDACTED,
    })
  })

  it('can be turned off on purpose', () => {
    const { logger, sink } = setup({ privacy: { enabled: false } })

    logger.info('cpf 529.982.247-25', { password: 'hunter2' })

    expect(sink.events[0]?.message).toBe('cpf 529.982.247-25')
    expect(sink.events[0]?.attributes).toEqual({ password: 'hunter2' })
  })

  it('takes extra keys and extra patterns', () => {
    const { logger, sink } = setup({
      privacy: { extraKeys: ['prontuario'], extraPatterns: [/INT-\d+/] },
    })

    logger.info('case INT-4821 opened', { prontuario: '99x', orderId: 7 })

    expect(sink.events[0]?.message).toBe(`case ${REDACTED} opened`)
    expect(sink.events[0]?.attributes).toEqual({ prontuario: REDACTED, orderId: 7 })
  })
})

describe('sampling in the logger', () => {
  it('drops the sampled-out logs but never the errors', () => {
    const { logger, sink } = setup({ sampling: { rate: 0 }, random: () => 0.99 })

    logger.info('dropped')
    logger.warn('dropped')
    logger.error('kept')

    expect(sink.events.map((event) => event.message)).toEqual(['kept'])
  })

  it('keeps or drops a whole trace together', () => {
    const traceId = 'f'.repeat(32)
    const { logger, sink } = setup({
      sampling: { rate: 0.5, alwaysFrom: false },
      random: () => 0.99,
      context: { trace: { traceId, spanId: '1'.repeat(16) } },
    })

    for (let index = 0; index < 20; index += 1) {
      logger.info(`event ${index}`)
    }

    expect(sink.events.length === 0 || sink.events.length === 20).toBe(true)
  })

  it('does not ask the sampler anything at the default rate', () => {
    const random = vi.fn(() => 0.99)
    const { logger, sink } = setup({ random })

    logger.info('kept')

    expect(sink.events).toHaveLength(1)
    expect(random).not.toHaveBeenCalled()
  })
})

describe('beforeSend', () => {
  it('can change the event', () => {
    const { logger, sink } = setup({
      beforeSend(event) {
        return { ...event, message: `[checkout] ${event.message}` }
      },
    })

    logger.info('paid')

    expect(sink.events[0]?.message).toBe('[checkout] paid')
  })

  it('drops the event when it returns null', () => {
    const { logger, sink } = setup({ beforeSend: () => null })

    logger.info('gone')

    expect(sink.events).toHaveLength(0)
  })

  it('sees the event before redaction, so it can route on the real value', () => {
    const seen: string[] = []
    const { logger, sink } = setup({
      beforeSend(event) {
        seen.push(event.message)
        return event
      },
    })

    logger.info('cpf 529.982.247-25')

    expect(seen).toEqual(['cpf 529.982.247-25'])
    expect(sink.events[0]?.message).toBe(`cpf ${REDACTED}`)
  })

  it('cannot undo the redaction, because privacy gets the last word', () => {
    const { logger, sink } = setup({
      beforeSend(event) {
        return { ...event, attributes: { ...event.attributes, password: 'hunter2' } }
      },
    })

    logger.info('hello')

    expect(sink.events[0]?.attributes).toEqual({ password: REDACTED })
  })

  it('drops the event and reports when it throws, without reaching the app', () => {
    const onError = vi.fn()
    const boom = new Error('hook exploded')
    const { logger, sink } = setup({
      onError,
      beforeSend() {
        throw boom
      },
    })

    expect(() => logger.info('gone')).not.toThrow()
    expect(sink.events).toHaveLength(0)
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('warns once when a hook forgets to return the event', () => {
    const onError = vi.fn()
    const { logger, sink } = setup({
      onError,
      beforeSend(event) {
        event.attributes = { ...event.attributes, tagged: true }
      },
    })

    logger.info('a')
    logger.info('b')

    expect(sink.events).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0]?.[0])).toContain('beforeSend returned nothing')
  })

  it('refuses an event whose level it broke', () => {
    const onError = vi.fn()
    const { logger, sink } = setup({
      onError,
      beforeSend: (event) => ({ ...event, level: 'verbose' as LogEvent['level'] }),
    })

    logger.info('gone')

    expect(sink.events).toHaveLength(0)
    expect(String(onError.mock.calls[0]?.[0])).toContain('not a valid log event')
  })

  it('repairs an event the hook left outside the contract', () => {
    const { logger, sink } = setup({
      beforeSend: (event) => ({
        ...event,
        timestamp: 'not a date',
        message: 'x'.repeat(MAX_MESSAGE_BYTES * 2),
        attributes: { nested: { deep: 1 } } as unknown as LogEvent['attributes'],
        trace: { traceId: 'short', spanId: 'short' },
        fingerprint: ['keep', 42 as unknown as string],
      }),
    })

    logger.info('hello')

    const event = sink.events[0]
    expect(event?.timestamp).toBe(new Date(FIXED_NOW).toISOString())
    expect(event?.message.length).toBe(MAX_MESSAGE_BYTES)
    expect(event?.attributes).toEqual({ 'nested.deep': 1 })
    expect(event?.trace).toBeUndefined()
    expect(event?.fingerprint).toEqual(['keep'])
  })

  it('runs after sampling, so a dropped log never reaches the hook', () => {
    const beforeSend = vi.fn((event: LogEvent) => event)
    const { logger } = setup({ sampling: { rate: 0 }, random: () => 0.99, beforeSend })

    logger.info('dropped')

    expect(beforeSend).not.toHaveBeenCalled()
  })
})
