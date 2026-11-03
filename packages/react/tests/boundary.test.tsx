import { type LogEvent, memorySink } from '@nekolog-io/core'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOUNDARY_ATTRIBUTE,
  COMPONENT_STACK_ATTRIBUTE,
  componentStackOf,
  ErrorBoundary,
  MAX_COMPONENT_STACK_CHARS,
  withErrorBoundary,
} from '../src/boundary.tsx'
import { closeClient } from '../src/client.ts'
import { LoggerContext, resetFallback } from '../src/context.ts'
import { render } from './render.ts'

afterEach(async () => {
  await closeClient()
  resetFallback()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function Boom({ message = 'the component gave up' }: { message?: string }): ReactNode {
  throw new Error(message)
}

function Named({ who }: { who: string }): ReactNode {
  return <span>hello {who}</span>
}

function watching(children: ReactNode): { events: LogEvent[]; node: ReactNode } {
  const sink = memorySink()
  const logger = {
    ...stubLogger(),
    error: (subject: unknown, attributes?: Record<string, unknown>) => {
      sink.emit({
        timestamp: new Date(0).toISOString(),
        level: 'error',
        message: subject instanceof Error ? subject.message : String(subject),
        attributes: attributes as LogEvent['attributes'],
      })
    },
  }
  return {
    events: sink.events,
    node: <LoggerContext.Provider value={logger}>{children}</LoggerContext.Provider>,
  }
}

describe('a component that throws while rendering', () => {
  it('is logged as an error instead of taking the page down', async () => {
    const { events, node } = watching(
      <ErrorBoundary fallback={<span>something broke</span>}>
        <Boom />
      </ErrorBoundary>,
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = await render(node)

    expect(view.html()).toContain('something broke')
    expect(events[0]?.message).toBe('the component gave up')
  })

  it('is logged with the component stack, which is where it happened', async () => {
    const { events, node } = watching(
      <ErrorBoundary fallback={<span>broke</span>}>
        <Boom />
      </ErrorBoundary>,
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await render(node)

    expect(String(events[0]?.attributes?.[COMPONENT_STACK_ATTRIBUTE])).toContain('Boom')
  })

  it('is logged with the name of the boundary that caught it', async () => {
    const { events, node } = watching(
      <ErrorBoundary name="checkout" fallback={<span>broke</span>}>
        <Boom />
      </ErrorBoundary>,
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await render(node)

    expect(events[0]?.attributes?.[BOUNDARY_ATTRIBUTE]).toBe('checkout')
  })

  it('still reaches the handler the app passed', async () => {
    const seen: unknown[] = []
    const { node } = watching(
      <ErrorBoundary fallback={<span>broke</span>} onError={(error) => seen.push(error)}>
        <Boom />
      </ErrorBoundary>,
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await render(node)

    expect((seen[0] as Error).message).toBe('the component gave up')
  })

  it('does not stop the app handler when the logging itself fails', async () => {
    const seen: unknown[] = []
    const exploding = {
      ...stubLogger(),
      error: () => {
        throw new Error('the logger gave up too')
      },
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = await render(
      <LoggerContext.Provider value={exploding}>
        <ErrorBoundary fallback={<span>broke</span>} onError={(error) => seen.push(error)}>
          <Boom />
        </ErrorBoundary>
      </LoggerContext.Provider>,
    )

    expect(view.html()).toContain('broke')
    expect(seen).toHaveLength(1)
  })
})

describe('what the boundary renders', () => {
  it('renders its children while nothing is wrong', async () => {
    const { node } = watching(
      <ErrorBoundary fallback={<span>broke</span>}>
        <span>all fine</span>
      </ErrorBoundary>,
    )

    const view = await render(node)

    expect(view.html()).toContain('all fine')
  })

  it('renders nothing when there is no fallback, instead of a blank page crash', async () => {
    const { node } = watching(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = await render(node)

    expect(view.html()).toBe('')
  })

  it('hands the error and a way back to a fallback that is a function', async () => {
    const { node } = watching(
      <ErrorBoundary fallback={({ error }) => <span>{(error as Error).message} — try again</span>}>
        <Boom message="payment failed" />
      </ErrorBoundary>,
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = await render(node)

    expect(view.html()).toContain('payment failed — try again')
  })
})

describe('wrapping a component', () => {
  it('guards it without the caller writing a boundary', async () => {
    const { events, node } = watching(null)
    const Guarded = withErrorBoundary(Boom, { fallback: <span>wrapped</span>, name: 'guarded' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = await render(
      <LoggerContext.Provider value={loggerOf(events)}>
        <Guarded />
      </LoggerContext.Provider>,
    )

    expect(view.html()).toContain('wrapped')
    expect(events[0]?.attributes?.[BOUNDARY_ATTRIBUTE]).toBe('guarded')
    expect(node).toBeDefined()
  })
})

describe('the props a wrapped component gets', () => {
  it('are the ones the caller passed', async () => {
    const Guarded = withErrorBoundary(Named)

    const view = await render(<Guarded who="Ada" />)

    expect(view.html()).toContain('hello Ada')
  })

  it('reach it even on the render that throws', async () => {
    const events: LogEvent[] = []
    const Guarded = withErrorBoundary(Boom, { fallback: <span>wrapped</span> })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await render(
      <LoggerContext.Provider value={loggerOf(events)}>
        <Guarded message="the message from the prop" />
      </LoggerContext.Provider>,
    )

    expect(events[0]?.message).toBe('the message from the prop')
  })
})

describe('the component stack', () => {
  it('is left out when react did not give one', () => {
    expect(componentStackOf({ componentStack: undefined })).toBeUndefined()
    expect(componentStackOf({ componentStack: '   ' })).toBeUndefined()
  })

  it('is cut so one stack cannot eat the whole attribute budget', () => {
    const stack = componentStackOf({ componentStack: 'x'.repeat(10_000) })

    expect(stack).toHaveLength(MAX_COMPONENT_STACK_CHARS)
  })
})

function loggerOf(events: LogEvent[]) {
  return {
    ...stubLogger(),
    error: (subject: unknown, attributes?: Record<string, unknown>) => {
      events.push({
        timestamp: new Date(0).toISOString(),
        level: 'error',
        message: subject instanceof Error ? subject.message : String(subject),
        attributes: attributes as LogEvent['attributes'],
      })
    },
  }
}

function stubLogger() {
  return {
    level: 'info' as const,
    resource: { runtime: 'browser' as const },
    sdk: { name: 'test', version: '0' },
    context: {},
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    log: () => undefined,
    isLevelEnabled: () => true,
    setLevel: () => undefined,
    child: () => stubLogger(),
    flush: () => Promise.resolve(),
  }
}
