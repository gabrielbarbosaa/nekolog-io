import { createLogger, type LogEvent } from '@nekolog-io/core'
import {
  BOUNDARY_ATTRIBUTE,
  clearBreadcrumbs,
  clearUser,
  currentUser,
  LoggerContext,
} from '@nekolog-io/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, CUSTOMER_ID } from './App.tsx'

type Rendered = { container: HTMLElement; click: (testId: string) => Promise<void> }

async function render(events: LogEvent[]): Promise<Rendered> {
  const logger = createLogger({
    sink: { emit: (event) => events.push(event) },
    level: 'trace',
  })

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(<LoggerContext.Provider value={logger}>{<App />}</LoggerContext.Provider>)
  })

  return {
    container,
    click: async (testId: string) => {
      const button = container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null
      if (button === null) {
        throw new Error(`the example has no button called ${testId}`)
      }
      await act(async () => {
        button.click()
      })
    },
  }
}

afterEach(() => {
  clearBreadcrumbs()
  clearUser()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('the example a person can click through', () => {
  it('logs the sign in and remembers who it was', async () => {
    const events: LogEvent[] = []
    const view = await render(events)

    await view.click('sign-in')

    expect(events[0]?.message).toBe('Signed in')
    expect(currentUser()).toBe(CUSTOMER_ID)
  })

  it('logs the coupon with the code as an attribute', async () => {
    const events: LogEvent[] = []
    const view = await render(events)

    await view.click('apply-coupon')

    expect(events[0]?.message).toBe('Coupon applied')
    expect(events[0]?.attributes?.['coupon.code']).toBe('WELCOME')
  })

  it('catches a component that breaks, and says which boundary caught it', async () => {
    const events: LogEvent[] = []
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = await render(events)

    await view.click('break')

    expect(view.container.innerHTML).toContain('Algo deu errado')
    const caught = events.find((event) => event.level === 'error') as LogEvent
    expect(caught.message).toBe('the payment component gave up')
    expect(caught.attributes?.[BOUNDARY_ATTRIBUTE]).toBe('checkout')
  })

  it('names a customer the way the rest of the example expects', () => {
    expect(CUSTOMER_ID).toMatch(/^cus_[0-9a-z]+$/)
  })
})
