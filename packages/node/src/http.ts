import type { LogContext, LogLevel, TraceContext } from '@nekolog-io/core'
import { randomHex, TRACEPARENT_HEADER, traceForRequest, traceparentOf } from '@nekolog-io/core'

export const REQUEST_ID_HEADER = 'x-request-id'
export const MAX_REQUEST_ID_CHARS = 64
export const REQUEST_ID_BYTES = 8

export const REQUEST_ID_ATTRIBUTE = 'request.id'
export const PARENT_SPAN_ATTRIBUTE = 'trace.parentSpanId'
export const METHOD_ATTRIBUTE = 'http.method'
export const ROUTE_ATTRIBUTE = 'http.route'
export const STATUS_ATTRIBUTE = 'http.status'
export const DURATION_ATTRIBUTE = 'http.durationMs'

export const UNMATCHED_ROUTE = 'unmatched'

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/

export function newRequestId(): string {
  return randomHex(REQUEST_ID_BYTES)
}

export function requestIdFrom(header: unknown, fallback: () => string = newRequestId): string {
  if (typeof header !== 'string') {
    return fallback()
  }
  const trimmed = header.trim()
  if (trimmed === '' || trimmed.length > MAX_REQUEST_ID_CHARS || !SAFE_REQUEST_ID.test(trimmed)) {
    return fallback()
  }
  return trimmed
}

export function levelForStatus(status: number): LogLevel {
  if (!Number.isFinite(status) || status >= 500) {
    return 'error'
  }
  return status >= 400 ? 'warn' : 'info'
}

export type IncomingRequestOptions = {
  traceparent?: unknown
  requestId?: unknown
  newRequestId?: () => string
  random?: () => number
}

export type IncomingRequest = {
  trace: TraceContext
  requestId: string
  sampled: boolean
  context: LogContext
  headers: Record<string, string>
}

export function startRequest(options: IncomingRequestOptions = {}): IncomingRequest {
  const { trace, parentSpanId, sampled } = traceForRequest(options.traceparent, options.random)
  const requestId = requestIdFrom(options.requestId, options.newRequestId ?? newRequestId)

  const attributes: Record<string, string> = { [REQUEST_ID_ATTRIBUTE]: requestId }
  if (parentSpanId !== undefined) {
    attributes[PARENT_SPAN_ATTRIBUTE] = parentSpanId
  }

  return {
    trace,
    requestId,
    sampled,
    context: { trace, attributes },
    headers: {
      [TRACEPARENT_HEADER]: traceparentOf(trace, sampled),
      [REQUEST_ID_HEADER]: requestId,
    },
  }
}

export type AccessLine = {
  method: string
  route: string
  status: number
  durationMs: number
}

export function accessMessage(line: AccessLine): string {
  return `${line.method} ${line.route} ${line.status}`
}

export function accessAttributes(line: AccessLine): Record<string, string | number> {
  return {
    [METHOD_ATTRIBUTE]: line.method,
    [ROUTE_ATTRIBUTE]: line.route,
    [STATUS_ATTRIBUTE]: line.status,
    [DURATION_ATTRIBUTE]: line.durationMs,
  }
}
