import { describe, expect, it } from 'vitest'
import type { LogRow } from '../lib/explorer'
import {
  isTraceId,
  offsetLabel,
  TRACE_ID_CHARS,
  TRACE_WINDOW_MS,
  traceFrom,
  traceHrefOf,
  traceIdOf,
  windowAround,
} from '../lib/trace'

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

function row(
  stamp: string,
  service: string,
  source: string,
  overrides: Partial<Record<string, unknown>> = {},
): LogRow {
  return { timestamp: stamp, service, source, level: 'info', message: service, ...overrides }
}

const CLICK = row('2026-10-31 12:00:00.000', 'checkout-web', 'browser')
const REQUEST = row('2026-10-31 12:00:00.120', 'checkout-api', 'node')
const GATEWAY = row('2026-10-31 12:00:00.900', 'payments', 'node', { level: 'error' })

describe('the trace id it will look for', () => {
  it('is the documented width, in hexadecimal', () => {
    expect(TRACE_ID_CHARS).toBe(32)
    expect(isTraceId(TRACE)).toBe(true)
  })

  it('answers empty for anything that is not one, instead of guessing', () => {
    for (const bad of ['', 'short', `${TRACE}0`, TRACE.replace('4', 'z')]) {
      expect(traceIdOf(bad), bad).toBe('')
    }
  })

  it('lowercases what came from the address bar, so one trace is one trace', () => {
    expect(traceIdOf(TRACE.toUpperCase())).toBe(TRACE)
  })
})

describe('the window it asks for', () => {
  it('reaches the same distance either side of the log that was clicked', () => {
    const anchor = new Date('2026-10-31T12:00:00.000Z')
    const { from, to } = windowAround(anchor)

    expect(anchor.getTime() - from.getTime()).toBe(TRACE_WINDOW_MS)
    expect(to.getTime() - anchor.getTime()).toBe(TRACE_WINDOW_MS)
  })
})

describe('the link from a log line to its trace', () => {
  it('carries the moment, so the window is around the log that was clicked', () => {
    const href = traceHrefOf('org_1', 'prj_1', { ...CLICK, trace_id: TRACE })

    expect(href).toBe(`/org_1/prj_1/traces/${TRACE}?at=2026-10-31T12%3A00%3A00.000Z`)
  })

  it('is not offered at all for a log that carries no trace', () => {
    expect(traceHrefOf('org_1', 'prj_1', CLICK)).toBeUndefined()
    expect(traceHrefOf('org_1', 'prj_1', { ...CLICK, trace_id: 'nope' })).toBeUndefined()
  })

  it('points at one trace however the row spelled it', () => {
    const href = traceHrefOf('org_1', 'prj_1', { ...CLICK, trace_id: TRACE.toUpperCase() })

    expect(href).toContain(`/traces/${TRACE}?`)
  })
})

describe('the offset it writes next to each line', () => {
  it('reads in the unit the number deserves', () => {
    expect(offsetLabel(0)).toBe('+0ms')
    expect(offsetLabel(120)).toBe('+120ms')
    expect(offsetLabel(1234)).toBe('+1.23s')
    expect(offsetLabel(65_400)).toBe('+1m05s')
  })

  it('says nothing rather than something wrong', () => {
    expect(offsetLabel(Number.NaN)).toBe('')
    expect(offsetLabel(-1)).toBe('')
  })
})

describe('the timeline it builds', () => {
  it('puts the click in the front and the request in the back in one order', () => {
    const trace = traceFrom(TRACE, [GATEWAY, CLICK, REQUEST])

    expect(trace.steps.map((step) => step.service)).toEqual([
      'checkout-web',
      'checkout-api',
      'payments',
    ])
  })

  it('counts each step from the first one, not from the one before', () => {
    const trace = traceFrom(TRACE, [CLICK, REQUEST, GATEWAY])

    expect(trace.steps.map((step) => step.offsetMs)).toEqual([0, 120, 900])
    expect(trace.elapsedMs).toBe(900)
  })

  it('marks where one service hands over to the next', () => {
    const trace = traceFrom(TRACE, [CLICK, REQUEST, REQUEST, GATEWAY])

    expect(trace.steps.map((step) => step.handover)).toEqual([false, true, false, true])
  })

  it('says when the trace really did cross from the browser to a server', () => {
    expect(traceFrom(TRACE, [CLICK, REQUEST]).crossed).toBe(true)
    expect(traceFrom(TRACE, [REQUEST, GATEWAY]).crossed).toBe(false)
    expect(traceFrom(TRACE, [REQUEST, GATEWAY]).sources).toEqual(['node'])
  })

  it('leaves out a row whose timestamp is not a timestamp', () => {
    const trace = traceFrom(TRACE, [CLICK, row('', 'ghost', 'node'), REQUEST])

    expect(trace.steps.map((step) => step.service)).toEqual(['checkout-web', 'checkout-api'])
  })

  it('gives each step an identity, because the logs table carries none', () => {
    const trace = traceFrom(TRACE, [CLICK, CLICK, CLICK])
    const keys = trace.steps.map((step) => step.key)

    expect(new Set(keys).size, 'three identical rows still get three keys').toBe(3)
  })

  it('does not fall over on a trace with nothing in it', () => {
    const trace = traceFrom(TRACE, [])

    expect(trace.steps).toEqual([])
    expect(trace.elapsedMs).toBe(0)
    expect(trace.crossed).toBe(false)
  })
})
