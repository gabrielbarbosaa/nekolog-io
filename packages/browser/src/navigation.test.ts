import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTrail, type Trail } from './breadcrumbs.ts'
import { installNavigationBreadcrumbs } from './navigation.ts'
import type { PageDetail } from './page.ts'

const installed: Array<() => void> = []

type FakeHistory = {
  pushState: (...args: unknown[]) => unknown
  replaceState: (...args: unknown[]) => unknown
  pushed: unknown[][]
}

function fakeHistory(onChange: (url: string) => void): FakeHistory {
  const pushed: unknown[][] = []
  return {
    pushed,
    pushState(...args: unknown[]) {
      pushed.push(args)
      onChange(String(args[2]))
      return 'pushed'
    },
    replaceState(...args: unknown[]) {
      pushed.push(args)
      onChange(String(args[2]))
      return 'replaced'
    },
  }
}

let here = 'https://shop.test/cart'

function setup(page: PageDetail = 'path'): { trail: Trail; history: FakeHistory } {
  const trail = createTrail()
  const history = fakeHistory((url) => {
    here = new URL(url, here).href
  })
  installed.push(
    installNavigationBreadcrumbs(trail, {
      target: window,
      history,
      href: () => here,
      page,
      now: () => 1_000,
    }),
  )
  return { trail, history }
}

beforeEach(() => {
  here = 'https://shop.test/cart'
})

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
})

describe('moving around a single page app', () => {
  it('records where pushState went, and where it came from', () => {
    const { trail, history } = setup()

    history.pushState({}, '', '/checkout')

    expect(trail.list()).toEqual([
      {
        at: '1970-01-01T00:00:01.000Z',
        kind: 'navigation',
        message: 'https://shop.test/checkout',
        data: { from: 'https://shop.test/cart' },
      },
    ])
  })

  it('records a replaceState too', () => {
    const { trail, history } = setup()

    history.replaceState({}, '', '/checkout')

    expect(trail.list()).toHaveLength(1)
  })

  it('still does what the app asked, and answers what it answered', () => {
    const { history } = setup()

    const answer = history.pushState({ step: 1 }, '', '/checkout')

    expect(answer).toBe('pushed')
    expect(history.pushed[0]).toEqual([{ step: 1 }, '', '/checkout'])
  })

  it('records the back button', () => {
    const { trail } = setup()
    here = 'https://shop.test/checkout'

    window.dispatchEvent(new Event('popstate'))

    expect(trail.list()[0]?.message).toBe('https://shop.test/checkout')
  })

  it('records a hash change', () => {
    const { trail } = setup('full')
    here = 'https://shop.test/cart#summary'

    window.dispatchEvent(new Event('hashchange'))

    expect(trail.list()[0]?.message).toBe('https://shop.test/cart#summary')
  })

  it('says nothing when the address did not actually change', () => {
    const { trail } = setup()

    window.dispatchEvent(new Event('popstate'))
    window.dispatchEvent(new Event('popstate'))

    expect(trail.list()).toEqual([])
  })
})

describe('what a navigation never records', () => {
  it('leaves the query string behind, like every other address does', () => {
    const { trail, history } = setup()

    history.pushState({}, '', '/reset?token=abc123')

    expect(JSON.stringify(trail.list())).not.toContain('abc123')
    expect(trail.list()[0]?.message).toBe('https://shop.test/reset')
  })

  it('records no address at all when addresses are turned off', () => {
    const { trail, history } = setup(false)

    history.pushState({}, '', '/checkout')

    expect(trail.list()).toEqual([])
  })
})

describe('after uninstalling', () => {
  it('gives the app its own history back', () => {
    const trail = createTrail()
    const history = fakeHistory(() => undefined)
    const original = history.pushState

    const uninstall = installNavigationBreadcrumbs(trail, {
      target: window,
      history,
      href: () => here,
    })
    expect(history.pushState).not.toBe(original)

    uninstall()

    expect(history.pushState).toBe(original)
  })

  it('leaves a later patch of somebody else alone', () => {
    const trail = createTrail()
    const history = fakeHistory(() => undefined)

    const uninstall = installNavigationBreadcrumbs(trail, {
      target: window,
      history,
      href: () => here,
    })
    const theirs = (...args: unknown[]) => args
    history.pushState = theirs
    uninstall()

    expect(history.pushState).toBe(theirs)
  })

  it('stops listening to the back button', () => {
    const trail = createTrail()
    const uninstall = installNavigationBreadcrumbs(trail, {
      target: window,
      history: false,
      href: () => here,
    })

    uninstall()
    here = 'https://shop.test/checkout'
    window.dispatchEvent(new Event('popstate'))

    expect(trail.list()).toEqual([])
  })
})
