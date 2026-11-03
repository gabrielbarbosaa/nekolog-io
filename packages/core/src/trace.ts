import { SPAN_ID_CHARS, TRACE_ID_CHARS } from './limits.ts'
import { randomHex } from './random.ts'
import type { TraceContext } from './types.ts'

export const TRACE_VERSION = '00'
export const TRACEPARENT_HEADER = 'traceparent'
export const SAMPLED_FLAG = 1
export const TRACE_ID_BYTES: number = TRACE_ID_CHARS / 2
export const SPAN_ID_BYTES: number = SPAN_ID_CHARS / 2

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ALL_ZEROS = /^0+$/

export type IncomingTrace = {
  traceId: string
  parentSpanId: string
  sampled: boolean
}

export type RequestTrace = {
  trace: TraceContext
  parentSpanId?: string
  sampled: boolean
}

export function newTraceId(random?: () => number): string {
  return randomHex(TRACE_ID_BYTES, random)
}

export function newSpanId(random?: () => number): string {
  return randomHex(SPAN_ID_BYTES, random)
}

export function parseTraceparent(header: unknown): IncomingTrace | undefined {
  if (typeof header !== 'string') {
    return undefined
  }

  const found = TRACEPARENT.exec(header.trim())
  if (found === null) {
    return undefined
  }

  const version = found[1] ?? ''
  const traceId = found[2] ?? ''
  const parentSpanId = found[3] ?? ''
  const flags = found[4] ?? ''

  if (version === 'ff' || ALL_ZEROS.test(traceId) || ALL_ZEROS.test(parentSpanId)) {
    return undefined
  }

  return {
    traceId,
    parentSpanId,
    sampled: (Number.parseInt(flags, 16) & SAMPLED_FLAG) === SAMPLED_FLAG,
  }
}

export function traceparentOf(trace: TraceContext, sampled = true): string {
  return `${TRACE_VERSION}-${trace.traceId}-${trace.spanId}-${sampled ? '01' : '00'}`
}

export function traceForRequest(header: unknown, random?: () => number): RequestTrace {
  const spanId = newSpanId(random)
  const incoming = parseTraceparent(header)

  if (incoming === undefined) {
    return { trace: { traceId: newTraceId(random), spanId }, sampled: true }
  }

  return {
    trace: { traceId: incoming.traceId, spanId },
    parentSpanId: incoming.parentSpanId,
    sampled: incoming.sampled,
  }
}

export function childSpan(trace: TraceContext, random?: () => number): TraceContext {
  return { traceId: trace.traceId, spanId: newSpanId(random) }
}

export type TraceTarget = string | RegExp

export type TraceTargetOptions = {
  targets?: readonly TraceTarget[]
  sameOrigin?: boolean
  origin?: string
}

export type TraceTargetMatcher = (url: string) => boolean

type UrlLike = {
  readonly origin: string
  readonly protocol: string
  readonly host: string
  readonly pathname: string
  readonly href: string
}

type UrlConstructor = new (url: string, base?: string) => UrlLike

function parseUrl(url: string, base?: string): UrlLike | undefined {
  const Url = (globalThis as { URL?: UrlConstructor }).URL
  if (Url === undefined) {
    return undefined
  }
  try {
    return new Url(url, base)
  } catch {
    return undefined
  }
}

function hostMatches(host: string, entry: string): boolean {
  if (entry.startsWith('.')) {
    return host === entry.slice(1) || host.endsWith(entry)
  }
  return host === entry
}

function entryMatches(url: UrlLike, entry: string): boolean {
  const trimmed = entry.trim()
  if (trimmed === '') {
    return false
  }

  if (trimmed.includes('://')) {
    const declared = parseUrl(trimmed)
    if (declared === undefined || declared.origin !== url.origin) {
      return false
    }
    const path = declared.pathname === '/' ? '' : declared.pathname
    return path === '' || url.pathname === path || url.pathname.startsWith(`${path}/`)
  }

  const [host = '', ...rest] = trimmed.split('/')
  if (!hostMatches(url.host, host)) {
    return false
  }
  const path = rest.join('/')
  return path === '' || url.pathname === `/${path}` || url.pathname.startsWith(`/${path}/`)
}

export function createTraceTargetMatcher(options: TraceTargetOptions = {}): TraceTargetMatcher {
  const targets = options.targets ?? []
  const sameOrigin = options.sameOrigin === true && typeof options.origin === 'string'
  const origin = options.origin

  const here = origin === undefined ? undefined : parseUrl(origin)

  return (candidate) => {
    const url = parseUrl(candidate, origin)
    if (url === undefined) {
      return false
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    if (sameOrigin && here !== undefined && url.origin === here.origin) {
      return true
    }

    for (const target of targets) {
      if (target instanceof RegExp) {
        if (target.test(url.href)) {
          return true
        }
        continue
      }
      if (typeof target === 'string' && entryMatches(url, target)) {
        return true
      }
    }

    return false
  }
}
