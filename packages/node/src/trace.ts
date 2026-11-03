import {
  childSpan,
  createTraceTargetMatcher,
  TRACEPARENT_HEADER,
  type TraceContext,
  type TraceTarget,
  type TraceTargetMatcher,
  traceparentOf,
} from '@nekolog-io/core'
import { currentContext } from './context.ts'

export type FetchArgs = [unknown, unknown?]
type AnyFetch = (this: unknown, ...args: FetchArgs) => Promise<unknown>

export type TracePropagationOptions = {
  targets: readonly TraceTarget[]
  trace?: () => TraceContext | undefined
  target?: { fetch?: unknown }
  matches?: TraceTargetMatcher
}

export function currentTrace(): TraceContext | undefined {
  return currentContext()?.trace
}

function urlOf(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input
  }
  const href = (input as { href?: unknown } | null)?.href
  if (typeof href === 'string') {
    return href
  }
  const url = (input as { url?: unknown } | null)?.url
  return typeof url === 'string' ? url : undefined
}

export function withTraceparent(args: FetchArgs, header: string): FetchArgs {
  const [input, init] = args
  const existing = (init as { headers?: unknown } | undefined)?.headers

  if (typeof Headers === 'function' && existing instanceof Headers) {
    const headers = new Headers(existing)
    headers.set(TRACEPARENT_HEADER, header)
    return [input, { ...(init as object), headers }]
  }
  if (Array.isArray(existing)) {
    return [input, { ...(init as object), headers: [...existing, [TRACEPARENT_HEADER, header]] }]
  }
  if (existing !== undefined && existing !== null) {
    return [
      input,
      { ...(init as object), headers: { ...(existing as object), [TRACEPARENT_HEADER]: header } },
    ]
  }
  return [input, { ...(init as object), headers: { [TRACEPARENT_HEADER]: header } }]
}

export function installTracePropagation(options: TracePropagationOptions): () => void {
  const target = options.target ?? (globalThis as { fetch?: unknown })
  const original = target.fetch
  if (typeof original !== 'function') {
    return () => undefined
  }

  const previous = original as AnyFetch
  const matches = options.matches ?? createTraceTargetMatcher({ targets: options.targets })
  const read = options.trace ?? currentTrace

  const installed: AnyFetch = function nekologFetch(this: unknown, ...args: FetchArgs) {
    let outgoing = args
    try {
      const url = urlOf(args[0])
      const trace = read()
      if (url !== undefined && trace !== undefined && matches(url)) {
        outgoing = withTraceparent(args, traceparentOf(childSpan(trace)))
      }
    } catch {
      outgoing = args
    }
    return previous.apply(this, outgoing)
  }

  target.fetch = installed

  return () => {
    if (target.fetch === installed) {
      target.fetch = previous
    }
  }
}
