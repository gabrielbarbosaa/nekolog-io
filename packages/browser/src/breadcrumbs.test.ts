import { MAX_ATTRIBUTE_VALUE_BYTES } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import {
  type Breadcrumb,
  createTrail,
  DEFAULT_MAX_BREADCRUMBS,
  MAX_BREADCRUMB_MESSAGE_CHARS,
  serialiseTrail,
} from './breadcrumbs.ts'

function crumb(message: string, at = 1_000): Breadcrumb {
  return { at, kind: 'custom', message }
}

describe('the trail', () => {
  it('keeps what happened, in order', () => {
    const trail = createTrail()

    trail.add(crumb('one'))
    trail.add(crumb('two'))

    expect(trail.list().map((entry) => entry.message)).toEqual(['one', 'two'])
  })

  it('drops the oldest once it is full, never the newest', () => {
    const trail = createTrail(3)

    for (const message of ['one', 'two', 'three', 'four']) {
      trail.add(crumb(message))
    }

    expect(trail.list().map((entry) => entry.message)).toEqual(['two', 'three', 'four'])
  })

  it('keeps a month of clicking from growing without bound', () => {
    const trail = createTrail()

    for (let i = 0; i < 10_000; i++) {
      trail.add(crumb(`click ${i}`))
    }

    expect(trail.list()).toHaveLength(DEFAULT_MAX_BREADCRUMBS)
  })

  it('cuts a message nobody could read anyway', () => {
    const trail = createTrail()

    trail.add(crumb('x'.repeat(5_000)))

    expect(trail.list()[0]?.message).toHaveLength(MAX_BREADCRUMB_MESSAGE_CHARS)
  })

  it('hands out a copy, so the caller cannot rewrite history', () => {
    const trail = createTrail()
    trail.add(crumb('one'))

    trail.list().push(crumb('forged'))

    expect(trail.list()).toHaveLength(1)
  })

  it('forgets everything on clear', () => {
    const trail = createTrail()
    trail.add(crumb('one'))

    trail.clear()

    expect(trail.list()).toEqual([])
  })

  it.each([0, -1, 1.5, Number.NaN])('falls back to the default for a limit of %j', (max) => {
    const trail = createTrail(max)

    for (let i = 0; i < DEFAULT_MAX_BREADCRUMBS + 5; i++) {
      trail.add(crumb(`click ${i}`))
    }

    expect(trail.list()).toHaveLength(DEFAULT_MAX_BREADCRUMBS)
  })
})

describe('what goes into the attribute', () => {
  it('is nothing at all when nothing happened', () => {
    expect(serialiseTrail([])).toBeUndefined()
  })

  it('is json the dashboard can read back', () => {
    const crumbs = [crumb('one', 1), crumb('two', 2)]

    const text = serialiseTrail(crumbs) as string

    expect(JSON.parse(text)).toEqual(crumbs)
  })

  it('stays inside the attribute limit the payload contract sets', () => {
    const crumbs = Array.from({ length: DEFAULT_MAX_BREADCRUMBS }, (_, i) =>
      crumb('x'.repeat(MAX_BREADCRUMB_MESSAGE_CHARS), i),
    )

    const text = serialiseTrail(crumbs) as string

    expect(text.length).toBeLessThanOrEqual(MAX_ATTRIBUTE_VALUE_BYTES)
  })

  it('drops the oldest to fit, and what is left is still valid json', () => {
    const crumbs = Array.from({ length: 40 }, (_, i) => crumb('x'.repeat(200), i))

    const text = serialiseTrail(crumbs, 1_000) as string
    const parsed = JSON.parse(text) as Breadcrumb[]

    expect(parsed.length).toBeLessThan(crumbs.length)
    expect(parsed[parsed.length - 1]?.at).toBe(39)
  })

  it('counts the limit in bytes, not characters', () => {
    const wide = [{ at: 1, kind: 'custom', message: '😿'.repeat(50) }] as Breadcrumb[]

    expect(JSON.stringify(wide).length).toBeLessThan(200)
    expect(serialiseTrail(wide, 200)).toBeUndefined()
    expect(serialiseTrail(wide, 400)).toBeDefined()
  })

  it('gives up rather than send half a record', () => {
    expect(serialiseTrail([crumb('x'.repeat(200))], 10)).toBeUndefined()
  })
})
