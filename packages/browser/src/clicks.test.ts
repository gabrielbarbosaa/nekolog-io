import { afterEach, describe, expect, it } from 'vitest'
import { createTrail, type Trail } from './breadcrumbs.ts'
import { describeElement, installClickBreadcrumbs, MAX_CLASSES_IN_SELECTOR } from './clicks.ts'

const installed: Array<() => void> = []

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
  document.body.innerHTML = ''
})

function watching(): Trail {
  const trail = createTrail()
  installed.push(installClickBreadcrumbs(trail, { document, now: () => 1_000 }))
  return trail
}

function render(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

describe('how an element is described', () => {
  it('is the tag when there is nothing else', () => {
    expect(describeElement(render('<button></button>'))).toBe('button')
  })

  it('carries the id and the classes', () => {
    expect(describeElement(render('<button id="pay" class="btn primary"></button>'))).toBe(
      'button#pay.btn.primary',
    )
  })

  it('carries the test id, which is what a developer searches for', () => {
    expect(describeElement(render('<button data-testid="checkout-pay"></button>'))).toBe(
      'button[data-testid=checkout-pay]',
    )
  })

  it('keeps only the first few classes, so a utility framework cannot flood it', () => {
    const classes = Array.from({ length: 30 }, (_, i) => `c${i}`).join(' ')

    const described = describeElement(render(`<div class="${classes}"></div>`)) as string

    expect(described.split('.').length - 1).toBe(MAX_CLASSES_IN_SELECTOR)
  })

  it.each([null, undefined, 'a string', 42, {}])('answers nothing for %j', (target) => {
    expect(describeElement(target)).toBeNull()
  })
})

describe('what a click never records', () => {
  it('leaves the label alone, because a label can name a person', () => {
    const described = describeElement(
      render('<button id="pay">Pagar como Ada Lovelace</button>'),
    ) as string

    expect(described).not.toContain('Ada')
    expect(described).toBe('button#pay')
  })

  it('leaves what was typed alone', () => {
    const input = render('<input id="card" value="4111111111111111" />')

    const described = describeElement(input) as string

    expect(described).not.toContain('4111')
    expect(described).toBe('input#card')
  })

  it('records none of that even when the click really happens', () => {
    const trail = watching()
    const button = render('<button id="pay">Pagar como Ada Lovelace</button>')

    button.click()

    expect(JSON.stringify(trail.list())).not.toContain('Ada')
    expect(trail.list()[0]?.message).toBe('button#pay')
  })
})

describe('a real click', () => {
  it('becomes a breadcrumb', () => {
    const trail = watching()
    const button = render('<button id="pay" class="primary"></button>')

    button.click()

    expect(trail.list()).toEqual([{ at: 1_000, kind: 'click', message: 'button#pay.primary' }])
  })

  it('is seen even when the app stops the event from bubbling', () => {
    const trail = watching()
    const button = render('<button id="pay"></button>')
    button.addEventListener('click', (event) => event.stopPropagation())

    button.click()

    expect(trail.list()).toHaveLength(1)
  })

  it('stops being recorded after uninstalling', () => {
    const trail = createTrail()
    const uninstall = installClickBreadcrumbs(trail, { document, now: () => 1_000 })
    const button = render('<button id="pay"></button>')

    button.click()
    uninstall()
    button.click()

    expect(trail.list()).toHaveLength(1)
  })

  it('records nothing when there is no document', () => {
    const trail = createTrail()

    expect(() => installClickBreadcrumbs(trail, { document: false })()).not.toThrow()
    expect(trail.list()).toEqual([])
  })
})
