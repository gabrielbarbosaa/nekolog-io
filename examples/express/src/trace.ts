import { randomBytes } from 'node:crypto'
import type { TraceContext } from '@nekolog-io/node'

export const TRACE_VERSION = '00'
export const SAMPLED_FLAG = 1
export const TRACE_ID_BYTES = 16
export const SPAN_ID_BYTES = 8

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ALL_ZEROS = /^0+$/

export type RandomBytes = (size: number) => Uint8Array

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

function hex(random: RandomBytes, size: number): string {
  return Buffer.from(random(size)).toString('hex')
}

export function traceForRequest(header: unknown, random: RandomBytes = randomBytes): RequestTrace {
  const spanId = hex(random, SPAN_ID_BYTES)
  const incoming = parseTraceparent(header)

  if (incoming === undefined) {
    return { trace: { traceId: hex(random, TRACE_ID_BYTES), spanId }, sampled: true }
  }
  return {
    trace: { traceId: incoming.traceId, spanId },
    parentSpanId: incoming.parentSpanId,
    sampled: incoming.sampled,
  }
}

export function traceparentOf(trace: TraceContext, sampled: boolean): string {
  const flags = sampled ? '01' : '00'
  return `${TRACE_VERSION}-${trace.traceId}-${trace.spanId}-${flags}`
}
