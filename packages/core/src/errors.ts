import { MAX_ERROR_MESSAGE_BYTES, MAX_ERROR_STACK_BYTES, MAX_ERROR_TYPE_CHARS } from './limits.ts'
import type { ErrorInfo } from './types.ts'
import { truncateToUtf8Bytes } from './utf8.ts'

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) {
    return true
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { name?: unknown; message?: unknown; stack?: unknown }
  return typeof candidate.message === 'string' && typeof candidate.name === 'string'
}

export function sanitiseErrorInfo(value: unknown): ErrorInfo | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const candidate = value as { type?: unknown; message?: unknown; stack?: unknown }

  const type = text(candidate.type)?.slice(0, MAX_ERROR_TYPE_CHARS)
  const message = text(candidate.message)
  const stack = text(candidate.stack)

  const info: ErrorInfo = {}
  if (type !== undefined) {
    info.type = type
  }
  if (message !== undefined) {
    info.message = truncateToUtf8Bytes(message, MAX_ERROR_MESSAGE_BYTES).value
  }
  if (stack !== undefined) {
    info.stack = truncateToUtf8Bytes(stack, MAX_ERROR_STACK_BYTES).value
  }

  return Object.keys(info).length === 0 ? undefined : info
}

export function errorInfoOf(value: Error): ErrorInfo | undefined {
  return sanitiseErrorInfo({ type: value.name, message: value.message, stack: value.stack })
}

export function describe(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return 'undefined'
  }
  const json = typeof value === 'object' ? asJson(value) : undefined
  if (json !== undefined) {
    return json
  }
  try {
    return String(value)
  } catch {
    return '[unserialisable]'
  }
}

function asJson(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' && json !== '{}' ? json : undefined
  } catch {
    return undefined
  }
}
