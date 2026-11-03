import { memorySink } from '@nekolog-io/core'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeClient, currentClient, nekologClient } from '../src/client.ts'
import { NO_PROVIDER, resetFallback, useLogger } from '../src/context.ts'
import { NekologProvider } from '../src/provider.tsx'
import { SDK_NAME } from '../src/version.ts'
import { render } from './render.ts'

afterEach(async () => {
  await closeClient()
  resetFallback()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function Writes({ message }: { message: string }) {
  const logger = useLogger()
  logger.info(message)
  return <span>wrote</span>
}

describe('the logger a component gets', () => {
  it('is the one the provider was given', async () => {
    const sink = memorySink()

    const view = await render(
      <NekologProvider logger={{ ...nullLogger(), info: (m) => sink.emit(eventOf(m)) }}>
        <Writes message="hello" />
      </NekologProvider>,
    )

    expect(view.html()).toContain('wrote')
    expect(sink.events[0]?.message).toBe('hello')
  })

  it('reaches a component any depth down', async () => {
    const sink = memorySink()
    const logger = { ...nullLogger(), info: (m: unknown) => sink.emit(eventOf(m)) }

    await render(
      <NekologProvider logger={logger}>
        <div>
          <div>
            <Writes message="deep" />
          </div>
        </div>
      </NekologProvider>,
    )

    expect(sink.events[0]?.message).toBe('deep')
  })
})

describe('a component with no provider above it', () => {
  it('still renders, and says what is missing instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const view = await render(<Writes message="orphan" />)

    expect(view.html()).toContain('wrote')
    expect(String(warn.mock.calls[0]?.[1])).toContain(NO_PROVIDER)
  })

  it('does not say it twice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await render(<Writes message="one" />)
    await render(<Writes message="two" />)

    expect(warn.mock.calls).toHaveLength(1)
  })
})

describe('the client the provider starts', () => {
  it('is started once, however many providers there are', async () => {
    await render(
      <NekologProvider service="checkout-web">
        <NekologProvider service="ignored">
          <span>two</span>
        </NekologProvider>
      </NekologProvider>,
    )

    expect(currentClient()?.logger.resource.service).toBe('checkout-web')
  })

  it('is started once under strict mode, which renders everything twice', async () => {
    await render(
      <StrictMode>
        <NekologProvider service="checkout-web">
          <span>strict</span>
        </NekologProvider>
      </StrictMode>,
    )

    const first = currentClient()

    await render(
      <StrictMode>
        <NekologProvider service="checkout-web">
          <span>strict again</span>
        </NekologProvider>
      </StrictMode>,
    )

    expect(currentClient()).toBe(first)
  })

  it('survives the provider unmounting, because the page is still the page', async () => {
    const view = await render(
      <NekologProvider service="checkout-web">
        <span>here</span>
      </NekologProvider>,
    )
    const client = currentClient()

    view.unmount()

    expect(currentClient()).toBe(client)
  })

  it('says it is the react sdk', async () => {
    await render(
      <NekologProvider service="checkout-web">
        <span>here</span>
      </NekologProvider>,
    )

    expect(currentClient()?.logger.sdk.name).toBe(SDK_NAME)
  })

  it('lets the caller say otherwise', () => {
    const client = nekologClient({ sdk: { name: '@acme/logging', version: '1.0.0' } })

    expect(client.logger.sdk.name).toBe('@acme/logging')
  })
})

function nullLogger() {
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
    child: () => nullLogger(),
    flush: () => Promise.resolve(),
  }
}

function eventOf(message: unknown) {
  return {
    timestamp: new Date(0).toISOString(),
    level: 'info' as const,
    message: String(message),
  }
}
