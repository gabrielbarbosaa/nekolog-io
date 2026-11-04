export const FINGERPRINT_VERSION = 'fingerprint_v1'
export const NO_FINGERPRINT = '0'

export const MAX_STACK_FRAMES = 5
export const MAX_PART_CHARS = 200
export const MAX_NORMALISED_CHARS = 1024

export type FingerprintError = {
  type?: string
  message?: string
  stack?: string
}

export type FingerprintInput = {
  level: string
  message: string
  service: string
  error?: FingerprintError
  fingerprint?: readonly string[]
}

export type FingerprintRule = 'manual' | 'stack' | 'message' | 'log'

const ERROR_LEVELS = new Set(['error', 'fatal'])

const SKIPPED_FRAMES = [
  'node_modules',
  'node:',
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'safari-web-extension://',
  'webpack-internal:///node_modules',
  '<anonymous>',
  '[native code]',
]

const QUOTED = /"[^"]*"|'[^']*'/g
const URL_LIKE = /\bhttps?:\/\/[^\s"'<>)]*/g
const EMAIL = /\b[^\s@<>"'(),;]+@[^\s@<>"'(),;]+\.[A-Za-z]{2,}\b/g
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const LONG_HEX = /\b[0-9a-fA-F]{16,}\b/g
const NUMBER = /\b\d+(?:\.\d+)?\b/g
const WHITESPACE = /\s+/g

const LOCATION_SUFFIX = /:\d+(?::\d+)?$/
const HEX_SEGMENT = /^[0-9a-fA-F]{6,}$/
const MIXED_SEGMENT = /^[0-9a-z]{8,}$/
const HAS_DIGIT = /\d/
const HAS_LETTER = /[a-z]/
const MINIFIED_NAME = /\.min(?:\.[a-z0-9]+)?$/

function pathOf(url: string): string {
  const afterScheme = url.indexOf('://')
  if (afterScheme === -1) {
    return url
  }
  const slash = url.indexOf('/', afterScheme + 3)
  return slash === -1 ? '/' : url.slice(slash)
}

export function normaliseMessage(message: string): string {
  return message
    .slice(0, MAX_NORMALISED_CHARS)
    .replace(QUOTED, '<str>')
    .replace(URL_LIKE, (url) => pathOf(url))
    .replace(EMAIL, '<email>')
    .replace(UUID, '<uuid>')
    .replace(LONG_HEX, '<hex>')
    .replace(NUMBER, '<n>')
    .replace(WHITESPACE, ' ')
    .trim()
}

function looksLikeAHash(segment: string): boolean {
  if (HEX_SEGMENT.test(segment)) {
    return true
  }
  const lower = segment.toLowerCase()
  return MIXED_SEGMENT.test(lower) && HAS_DIGIT.test(lower) && HAS_LETTER.test(lower)
}

export function normaliseFile(location: string): { file: string; hashed: boolean } {
  const withoutPosition = location.replace(LOCATION_SUFFIX, '')
  const withoutQuery = (withoutPosition.split('?')[0] ?? '').split('#')[0] ?? ''
  const path = withoutQuery.includes('://') ? pathOf(withoutQuery) : withoutQuery

  const cut = path.lastIndexOf('/')
  const directory = cut === -1 ? '' : path.slice(0, cut + 1)
  const name = cut === -1 ? path : path.slice(cut + 1)

  const segments = name.split('.')
  const kept = segments.filter((segment, at) => at === 0 || !looksLikeAHash(segment))

  return { file: `${directory}${kept.join('.')}`, hashed: kept.length !== segments.length }
}

export type StackFrame = {
  functionName: string
  location: string
}

export function parseFrame(line: string): StackFrame | undefined {
  const text = line.trim()
  if (text === '') {
    return undefined
  }

  const withoutAt = text.startsWith('at ') ? text.slice(3).trim() : text

  const open = withoutAt.lastIndexOf('(')
  if (withoutAt.endsWith(')') && open > 0) {
    return {
      functionName: withoutAt.slice(0, open).trim(),
      location: withoutAt.slice(open + 1, -1).trim(),
    }
  }

  const monkey = withoutAt.lastIndexOf('@')
  if (monkey > 0) {
    return {
      functionName: withoutAt.slice(0, monkey).trim(),
      location: withoutAt.slice(monkey + 1).trim(),
    }
  }

  if (text.startsWith('at ')) {
    const bare = withoutAt.startsWith('async ') ? withoutAt.slice(6).trim() : withoutAt
    return { functionName: '', location: bare }
  }

  return undefined
}

export function looksLikeALocation(location: string): boolean {
  if (location === '' || location === 'native' || /\s/.test(location)) {
    return false
  }
  return location.includes('/') || location.includes('\\') || LOCATION_SUFFIX.test(location)
}

function isOurs(location: string): boolean {
  if (!looksLikeALocation(location)) {
    return false
  }
  return !SKIPPED_FRAMES.some((skipped) => location.includes(skipped))
}

export function appFrames(stack: string): string[] {
  const frames: string[] = []

  for (const line of stack.split('\n')) {
    if (frames.length === MAX_STACK_FRAMES) {
      break
    }
    const frame = parseFrame(line)
    if (frame === undefined || !isOurs(frame.location)) {
      continue
    }

    const { file, hashed } = normaliseFile(frame.location)
    const minified = hashed || MINIFIED_NAME.test(file.replace(/\.[a-z0-9]+$/, ''))
    const named = minified ? '' : frame.functionName

    frames.push(named === '' ? file : `${named} ${file}`)
  }

  return frames
}

function bounded(part: string): string {
  return part.length > MAX_PART_CHARS ? part.slice(0, MAX_PART_CHARS) : part
}

export type FingerprintParts = {
  rule: FingerprintRule
  parts: string[]
}

export function fingerprintPartsFor(input: FingerprintInput): FingerprintParts | undefined {
  const error = input.error
  if (error === undefined && !ERROR_LEVELS.has(input.level)) {
    return undefined
  }

  const manual = (input.fingerprint ?? []).filter((part) => part.trim() !== '')
  if (manual.length > 0) {
    return { rule: 'manual', parts: manual.map(bounded) }
  }

  const type = error?.type ?? ''

  if (error?.stack !== undefined && error.stack !== '') {
    const frames = appFrames(error.stack)
    if (frames.length > 0) {
      return { rule: 'stack', parts: [type, ...frames].map(bounded) }
    }
  }

  if (error !== undefined) {
    return {
      rule: 'message',
      parts: [type, normaliseMessage(error.message ?? input.message)].map(bounded),
    }
  }

  return { rule: 'log', parts: [input.service, normaliseMessage(input.message)].map(bounded) }
}

function unsignedFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (let at = 0; at < 8; at += 1) {
    value = (value << 8n) | BigInt(bytes[at] ?? 0)
  }
  return value
}

export async function hashParts(rule: FingerprintRule, parts: readonly string[]): Promise<string> {
  const text = [FINGERPRINT_VERSION, rule, ...parts].join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const value = unsignedFromBytes(new Uint8Array(digest))
  return value === 0n ? '1' : value.toString()
}

export async function fingerprintFor(input: FingerprintInput): Promise<string> {
  const found = fingerprintPartsFor(input)
  if (found === undefined) {
    return NO_FINGERPRINT
  }
  return hashParts(found.rule, found.parts)
}
