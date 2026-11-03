import { createLogger, type LogEvent, memorySink } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import { CONTEXT_ATTRIBUTE, describeTrace, NekologLoggerService } from './logger-service.ts'

function watching(): { service: NekologLoggerService; events: LogEvent[] } {
  const sink = memorySink()
  return {
    service: new NekologLoggerService(createLogger({ sink, level: 'trace' })),
    events: sink.events,
  }
}

describe('nest own logging, sent through ours', () => {
  it.each([
    ['log', 'info'],
    ['error', 'error'],
    ['warn', 'warn'],
    ['debug', 'debug'],
    ['verbose', 'trace'],
    ['fatal', 'fatal'],
  ])('turns %s into %s', (method, level) => {
    const { service, events } = watching()

    ;(service as unknown as Record<string, (message: string) => void>)[method]?.('something')

    expect(events[0]?.level).toBe(level)
    expect(events[0]?.message).toBe('something')
  })

  it('keeps the context nest puts last', () => {
    const { service, events } = watching()

    service.log('Mapped {/orders, GET} route', 'RouterExplorer')

    expect(events[0]?.attributes?.[CONTEXT_ATTRIBUTE]).toBe('RouterExplorer')
  })

  it('keeps the stack nest puts first on an error', () => {
    const { service, events } = watching()

    service.error('it broke', 'Error: it broke\n    at somewhere', 'OrdersController')

    expect(events[0]?.attributes?.[CONTEXT_ATTRIBUTE]).toBe('OrdersController')
    expect(String(events[0]?.attributes?.stack)).toContain('at somewhere')
  })

  it('adds nothing when nest said nothing extra', () => {
    const { service, events } = watching()

    service.log('plain')

    expect(events[0]?.attributes).toBeUndefined()
  })

  it.each([undefined, null, 42, '', '   '])('leaves out a stack of %j', (value) => {
    expect(describeTrace(value)).toBeUndefined()
  })
})
