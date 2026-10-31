import {
  MAX_ATTRIBUTE_VALUE_BYTES,
  MAX_ERROR_MESSAGE_BYTES,
  MAX_ERROR_STACK_BYTES,
  MAX_MESSAGE_BYTES,
} from './limits.ts'
import type { Attributes, ErrorInfo, LogEvent } from './types.ts'
import { truncateToUtf8Bytes } from './utf8.ts'

export const REDACTED = '[redacted]'

export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  'apikey',
  'authorization',
  'cardnumber',
  'cnpj',
  'cookie',
  'cpf',
  'creditcard',
  'cvc',
  'cvv',
  'passphrase',
  'password',
  'privatekey',
  'pwd',
  'secret',
  'securityanswer',
  'sessionid',
  'token',
]

const NON_ALPHANUMERIC = /[^a-z0-9]/g

function normaliseKeySegment(segment: string): string {
  return segment.toLowerCase().replace(NON_ALPHANUMERIC, '')
}

export type KeyMatcher = (key: string) => boolean

export function createKeyMatcher(
  extraKeys: readonly string[] = [],
  skipKeys: readonly string[] = [],
): KeyMatcher {
  const skipped = new Set(
    skipKeys
      .filter((key): key is string => typeof key === 'string')
      .map(normaliseKeySegment)
      .filter((key) => key !== ''),
  )

  const needles = [
    ...DEFAULT_SENSITIVE_KEYS,
    ...extraKeys.filter((key): key is string => typeof key === 'string'),
  ]
    .map(normaliseKeySegment)
    .filter((needle) => needle !== '' && !skipped.has(needle))

  return (key) => {
    for (const segment of key.split('.')) {
      const normalised = normaliseKeySegment(segment)
      if (normalised === '' || skipped.has(normalised)) {
        continue
      }
      for (const needle of needles) {
        if (normalised.includes(needle)) {
          return true
        }
      }
    }
    return false
  }
}

const PAIR_HEAD = /(^|[^A-Za-z0-9_.-])([A-Za-z][A-Za-z0-9_.-]{0,63})(['"]?\s*[=:]\s*)/g
const PAIR_VALUE =
  /(?:(?:[Bb]earer|[Bb]asic|[Tt]oken|[Dd]igest)\s+)?(?:"[^"\n]{0,4096}"|'[^'\n]{0,4096}'|[^\s,;&)}\]"']{1,4096})/y
const URL_CREDENTIALS = /\/\/[^\s/:@]{1,128}:[^\s/@]{1,256}@/g
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g
const HTTP_AUTH_SCHEME = /\b(bearer|basic)\s+[A-Za-z0-9\-._~+/]+=*/gi
const NEKOLOG_KEY = /\b(nekolog_(?:sk|pk)_)[A-Za-z0-9_-]+/g
const CARD_NUMBER = /(^|[^0-9])([0-9](?:[ .-]?[0-9]){12,18})(?![0-9])/g
const CPF = /(^|[^0-9])([0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|[0-9]{11})(?![0-9])/g
const NON_DIGIT = /[^0-9]/g
const REPEATED_DIGIT = /^([0-9])\1{10}$/

export function luhnValid(digits: string): boolean {
  if (digits.length === 0) {
    return false
  }
  let sum = 0
  let doubling = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48
    if (value < 0 || value > 9) {
      return false
    }
    if (doubling) {
      value *= 2
      if (value > 9) {
        value -= 9
      }
    }
    sum += value
    doubling = !doubling
  }
  return sum % 10 === 0
}

export function cpfValid(digits: string): boolean {
  if (digits.length !== 11 || REPEATED_DIGIT.test(digits)) {
    return false
  }
  for (let round = 0; round < 2; round += 1) {
    const size = 9 + round
    let sum = 0
    for (let index = 0; index < size; index += 1) {
      sum += (digits.charCodeAt(index) - 48) * (size + 1 - index)
    }
    const remainder = sum % 11
    const expected = remainder < 2 ? 0 : 11 - remainder
    if (digits.charCodeAt(size) - 48 !== expected) {
      return false
    }
  }
  return true
}

function digitsOf(value: string): string {
  return value.replace(NON_DIGIT, '')
}

function looksLikeCard(digits: string): boolean {
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
}

export function toGlobalPattern(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
}

function redactPairs(value: string, matchesKey: KeyMatcher): string {
  PAIR_HEAD.lastIndex = 0
  let out = ''
  let copied = 0
  let found = false

  let head = PAIR_HEAD.exec(value)
  while (head !== null) {
    const [whole, prefix = '', key = '', separator = ''] = head

    if (matchesKey(key)) {
      PAIR_VALUE.lastIndex = head.index + whole.length
      const tail = PAIR_VALUE.exec(value)
      if (tail !== null) {
        found = true
        out += `${value.slice(copied, head.index)}${prefix}${key}${separator}${REDACTED}`
        copied = PAIR_VALUE.lastIndex
        PAIR_HEAD.lastIndex = copied
      }
    }

    head = PAIR_HEAD.exec(value)
  }

  return found ? out + value.slice(copied) : value
}

export function redactText(
  value: string,
  extraPatterns: readonly RegExp[] = [],
  matchesKey?: KeyMatcher,
): string {
  if (value === '') {
    return value
  }

  let out = matchesKey ? redactPairs(value, matchesKey) : value

  out = out
    .replace(URL_CREDENTIALS, `//${REDACTED}@`)
    .replace(JWT, REDACTED)
    .replace(HTTP_AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(NEKOLOG_KEY, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(CARD_NUMBER, (_match, prefix: string, candidate: string) =>
      looksLikeCard(digitsOf(candidate)) ? `${prefix}${REDACTED}` : `${prefix}${candidate}`,
    )
    .replace(CPF, (_match, prefix: string, candidate: string) =>
      cpfValid(digitsOf(candidate)) ? `${prefix}${REDACTED}` : `${prefix}${candidate}`,
    )

  for (const pattern of extraPatterns) {
    const global = toGlobalPattern(pattern)
    global.lastIndex = 0
    out = out.replace(global, REDACTED)
  }

  return out
}

export type RedactionPolicy = {
  matchesKey: KeyMatcher
  patterns: readonly RegExp[]
  scrubText: boolean
}

function scrubValue(policy: RedactionPolicy, value: string, limit: number): string {
  if (!policy.scrubText) {
    return value
  }
  return truncateToUtf8Bytes(redactText(value, policy.patterns, policy.matchesKey), limit).value
}

function scrubAttributes(policy: RedactionPolicy, attributes: Attributes): Attributes {
  const out: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (policy.matchesKey(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] =
      typeof value === 'string' ? scrubValue(policy, value, MAX_ATTRIBUTE_VALUE_BYTES) : value
  }
  return out
}

function scrubError(policy: RedactionPolicy, error: ErrorInfo): ErrorInfo {
  const out: ErrorInfo = {}
  if (error.type !== undefined) {
    out.type = error.type
  }
  if (error.message !== undefined) {
    out.message = scrubValue(policy, error.message, MAX_ERROR_MESSAGE_BYTES)
  }
  if (error.stack !== undefined) {
    out.stack = scrubValue(policy, error.stack, MAX_ERROR_STACK_BYTES)
  }
  return out
}

export function scrubEvent(event: LogEvent, policy: RedactionPolicy): LogEvent {
  const out: LogEvent = {
    timestamp: event.timestamp,
    level: event.level,
    message: scrubValue(policy, event.message, MAX_MESSAGE_BYTES),
  }

  if (event.attributes !== undefined) {
    out.attributes = scrubAttributes(policy, event.attributes)
  }
  if (event.trace !== undefined) {
    out.trace = event.trace
  }
  if (event.session !== undefined) {
    out.session = event.session
  }
  if (event.error !== undefined) {
    out.error = scrubError(policy, event.error)
  }
  if (event.fingerprint !== undefined) {
    out.fingerprint = event.fingerprint
  }

  return out
}
