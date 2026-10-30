import {
  INVALID_ATTRIBUTE_KEY_CHARS,
  MAX_ATTRIBUTE_DEPTH,
  MAX_ATTRIBUTE_KEY_CHARS,
  MAX_ATTRIBUTE_KEYS,
  MAX_ATTRIBUTE_VALUE_BYTES,
} from './limits.ts'
import type { AttributeInput, Attributes, AttributeValue } from './types.ts'
import { truncateToUtf8Bytes } from './utf8.ts'

export function sanitiseKey(key: string): string | null {
  const cleaned = key.replace(INVALID_ATTRIBUTE_KEY_CHARS, '_').slice(0, MAX_ATTRIBUTE_KEY_CHARS)
  return cleaned === '' ? null : cleaned
}

function isFlattenable(value: object): boolean {
  if (Array.isArray(value)) {
    return true
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype === Object.prototype || prototype === null) {
    return true
  }
  return (value as { toString?: unknown }).toString === Object.prototype.toString
}

function errorLike(value: object): value is Error {
  return value instanceof Error
}

function scalarOf(value: unknown): AttributeValue | undefined {
  if (value === null) {
    return null
  }
  switch (typeof value) {
    case 'string':
      return truncateToUtf8Bytes(value, MAX_ATTRIBUTE_VALUE_BYTES).value
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'boolean':
      return value
    case 'bigint':
      return value.toString()
    default:
      return undefined
  }
}

type Collector = {
  out: Attributes
  seen: WeakSet<object>
  full: boolean
}

function put(collector: Collector, path: string, value: AttributeValue): void {
  if (collector.full) {
    return
  }
  const key = sanitiseKey(path)
  if (key === null) {
    return
  }
  if (!(key in collector.out) && Object.keys(collector.out).length >= MAX_ATTRIBUTE_KEYS) {
    collector.full = true
    return
  }
  collector.out[key] = value
}

function visit(collector: Collector, path: string, value: unknown, depth: number): void {
  if (collector.full) {
    return
  }

  const scalar = scalarOf(value)
  if (scalar !== undefined) {
    put(collector, path, scalar)
    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  if (value instanceof Date) {
    put(collector, path, Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString())
    return
  }

  if (errorLike(value)) {
    visit(collector, `${path}.name`, value.name, depth + 1)
    visit(collector, `${path}.message`, value.message, depth + 1)
    return
  }

  if (collector.seen.has(value)) {
    put(collector, path, '[Circular]')
    return
  }

  if (depth >= MAX_ATTRIBUTE_DEPTH || !isFlattenable(value)) {
    put(collector, path, stringifyOpaque(value))
    return
  }

  collector.seen.add(value)
  for (const childKey of ownKeys(value)) {
    const childPath = path === '' ? childKey : `${path}.${childKey}`
    const read = readProperty(value, childKey)
    if (read.ok) {
      visit(collector, childPath, read.value, depth + 1)
    } else {
      put(collector, childPath, '[unreadable]')
    }
    if (collector.full) {
      break
    }
  }
  collector.seen.delete(value)
}

function ownKeys(value: object): string[] {
  try {
    return Object.keys(value)
  } catch {
    return []
  }
}

function readProperty(
  value: object,
  key: string,
): { ok: true; value: unknown } | { ok: false; value?: undefined } {
  try {
    return { ok: true, value: (value as Record<string, unknown>)[key] }
  } catch {
    return { ok: false }
  }
}

function stringifyOpaque(value: object): string {
  try {
    const text = value.toString()
    return typeof text === 'string'
      ? truncateToUtf8Bytes(text, MAX_ATTRIBUTE_VALUE_BYTES).value
      : '[object]'
  } catch {
    return '[unserialisable]'
  }
}

export function flattenAttributes(input: AttributeInput | undefined): Attributes | undefined {
  if (input === undefined || input === null) {
    return undefined
  }

  const collector: Collector = { out: {}, seen: new WeakSet(), full: false }
  visit(collector, '', input, 0)

  return Object.keys(collector.out).length === 0 ? undefined : collector.out
}

export function mergeAttributeInputs(
  base: AttributeInput | undefined,
  extra: AttributeInput | undefined,
): AttributeInput | undefined {
  if (base === undefined) {
    return extra
  }
  if (extra === undefined) {
    return base
  }
  return { ...base, ...extra }
}
