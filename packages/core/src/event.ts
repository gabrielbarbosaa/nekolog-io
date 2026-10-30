import { flattenAttributes, mergeAttributeInputs } from './attributes.ts'
import { describe, errorInfoOf, isErrorLike } from './errors.ts'
import {
  EMPTY_MESSAGE_PLACEHOLDER,
  MAX_FINGERPRINT_ITEMS,
  MAX_MESSAGE_BYTES,
  MAX_SESSION_ID_CHARS,
  MAX_USER_ID_CHARS,
  SPAN_ID_CHARS,
  TRACE_ID_CHARS,
} from './limits.ts'
import type {
  AttributeInput,
  LogContext,
  LogEvent,
  LogLevel,
  SessionContext,
  TraceContext,
} from './types.ts'
import { truncateToUtf8Bytes } from './utf8.ts'

const HEX_PATTERN = /^[0-9a-f]+$/i

export function normaliseTrace(trace: TraceContext | undefined): TraceContext | undefined {
  if (!trace) {
    return undefined
  }
  const { traceId, spanId } = trace
  if (typeof traceId !== 'string' || typeof spanId !== 'string') {
    return undefined
  }
  if (traceId.length !== TRACE_ID_CHARS || !HEX_PATTERN.test(traceId)) {
    return undefined
  }
  if (spanId.length !== SPAN_ID_CHARS || !HEX_PATTERN.test(spanId)) {
    return undefined
  }
  return { traceId, spanId }
}

export function normaliseSession(session: SessionContext | undefined): SessionContext | undefined {
  if (!session) {
    return undefined
  }
  const result: SessionContext = {}
  if (typeof session.id === 'string' && session.id !== '') {
    result.id = session.id.slice(0, MAX_SESSION_ID_CHARS)
  }
  if (typeof session.userId === 'string' && session.userId !== '') {
    result.userId = session.userId.slice(0, MAX_USER_ID_CHARS)
  }
  return result.id === undefined && result.userId === undefined ? undefined : result
}

export function normaliseFingerprint(fingerprint: string[] | undefined): string[] | undefined {
  if (!Array.isArray(fingerprint)) {
    return undefined
  }
  const parts = fingerprint
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .slice(0, MAX_FINGERPRINT_ITEMS)
  return parts.length === 0 ? undefined : parts
}

export function isoTimestamp(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? milliseconds : Date.now()
  const date = new Date(safe)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function normaliseMessage(value: string): string {
  const trimmed = truncateToUtf8Bytes(value, MAX_MESSAGE_BYTES).value
  return trimmed === '' ? EMPTY_MESSAGE_PLACEHOLDER : trimmed
}

export function mergeContexts(base: LogContext, extra: LogContext): LogContext {
  const merged: LogContext = {}

  const attributes = mergeAttributeInputs(base.attributes, extra.attributes)
  if (attributes !== undefined) {
    merged.attributes = attributes
  }

  const trace = extra.trace ?? base.trace
  if (trace !== undefined) {
    merged.trace = trace
  }

  if (base.session !== undefined || extra.session !== undefined) {
    merged.session = { ...base.session, ...extra.session }
  }

  const fingerprint = extra.fingerprint ?? base.fingerprint
  if (fingerprint !== undefined) {
    merged.fingerprint = fingerprint
  }

  return merged
}

export type BuildEventInput = {
  level: LogLevel
  subject: unknown
  attributes: AttributeInput | undefined
  context: LogContext
  timestamp: number
}

export function buildEvent(input: BuildEventInput): LogEvent {
  const { level, subject, attributes, context, timestamp } = input

  const error = isErrorLike(subject) ? errorInfoOf(subject) : undefined
  const message = normaliseMessage(
    error?.message ?? (isErrorLike(subject) ? subject.name : describe(subject)),
  )

  const event: LogEvent = {
    timestamp: isoTimestamp(timestamp),
    level,
    message,
  }

  const merged = flattenAttributes(mergeAttributeInputs(context.attributes, attributes))
  if (merged !== undefined) {
    event.attributes = merged
  }

  const trace = normaliseTrace(context.trace)
  if (trace !== undefined) {
    event.trace = trace
  }

  const session = normaliseSession(context.session)
  if (session !== undefined) {
    event.session = session
  }

  if (error !== undefined) {
    event.error = error
  }

  const fingerprint = normaliseFingerprint(context.fingerprint)
  if (fingerprint !== undefined) {
    event.fingerprint = fingerprint
  }

  return event
}
