import {
  childSpan,
  createTraceTargetMatcher,
  newSpanId,
  newTraceId,
  type TraceContext,
  type TraceTarget,
  type TraceTargetMatcher,
} from '@nekolog-io/core'
import { globalHref } from './globals.ts'

export type TraceTuning = {
  targets?: readonly TraceTarget[]
  sameOrigin?: boolean
}

let page: TraceContext | undefined

export function currentTrace(): TraceContext {
  if (page === undefined) {
    page = { traceId: newTraceId(), spanId: newSpanId() }
  }
  return page
}

export function resetTrace(): TraceContext {
  page = { traceId: newTraceId(), spanId: newSpanId() }
  return page
}

export function nextSpan(): TraceContext {
  return childSpan(currentTrace())
}

export function traceMatcherFor(
  tuning: TraceTuning = {},
  href: () => string | undefined = globalHref,
): TraceTargetMatcher {
  return createTraceTargetMatcher({
    targets: tuning.targets,
    sameOrigin: tuning.sameOrigin !== false,
    origin: href(),
  })
}
