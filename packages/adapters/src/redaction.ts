export const REDACTION_PATTERNS = [
  'email',
  'ipv4',
  'ipv6',
  'phone_br',
  'cpf',
  'cnpj',
  'jwt',
  'bearer',
  'uuid',
  'credit_card',
] as const

export type RedactionPattern = (typeof REDACTION_PATTERNS)[number]

export const DEFAULT_REPLACEMENT = '[redacted]'
export const MAX_ATTRIBUTE_RULES = 50
export const MAX_ATTRIBUTE_RULE_CHARS = 128
export const MAX_REPLACEMENT_CHARS = 32

const ATTRIBUTE_RULE = /^[A-Za-z0-9_.-]{1,128}\*?$/
const REPLACEMENT = /^[A-Za-z0-9 _.\-[\]()]{1,32}$/

export type RedactionRules = {
  attributes: readonly string[]
  patterns: readonly RedactionPattern[]
  replacement: string
}

export const NO_REDACTION: RedactionRules = {
  attributes: [],
  patterns: [],
  replacement: DEFAULT_REPLACEMENT,
}

export class RedactionRuleError extends Error {
  readonly field: string

  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`)
    this.name = 'RedactionRuleError'
    this.field = field
  }
}

function listOf(value: unknown, field: string): readonly unknown[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new RedactionRuleError(field, 'expected a list')
  }
  return value
}

export function parseRedactionRules(input: unknown): RedactionRules {
  if (input === undefined || input === null) {
    return NO_REDACTION
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new RedactionRuleError('rules', 'expected an object')
  }

  const raw = input as Record<string, unknown>

  const attributes = listOf(raw.attributes, 'attributes')
  if (attributes.length > MAX_ATTRIBUTE_RULES) {
    throw new RedactionRuleError('attributes', `at most ${MAX_ATTRIBUTE_RULES} rules`)
  }

  const seen = new Set<string>()
  for (const one of attributes) {
    if (typeof one !== 'string' || !ATTRIBUTE_RULE.test(one)) {
      throw new RedactionRuleError(
        'attributes',
        `${JSON.stringify(one)} is not an attribute key, optionally ending in a star`,
      )
    }
    if (seen.has(one)) {
      throw new RedactionRuleError('attributes', `${one} appears twice`)
    }
    seen.add(one)
  }

  const patterns = listOf(raw.patterns, 'patterns')
  const named = new Set<string>()
  for (const one of patterns) {
    if (typeof one !== 'string' || !(REDACTION_PATTERNS as readonly string[]).includes(one)) {
      throw new RedactionRuleError(
        'patterns',
        `${JSON.stringify(one)} is not one of ${REDACTION_PATTERNS.join(', ')}`,
      )
    }
    named.add(one)
  }

  const replacement = raw.replacement === undefined ? DEFAULT_REPLACEMENT : raw.replacement
  if (typeof replacement !== 'string' || !REPLACEMENT.test(replacement)) {
    throw new RedactionRuleError(
      'replacement',
      `expected up to ${MAX_REPLACEMENT_CHARS} plain characters`,
    )
  }

  return {
    attributes: attributes as readonly string[],
    patterns: [...named] as readonly RedactionPattern[],
    replacement,
  }
}

export function attributeMatches(key: string, rule: string): boolean {
  if (rule.endsWith('*')) {
    return key.startsWith(rule.slice(0, -1))
  }
  return key === rule
}

export function hasRules(rules: RedactionRules): boolean {
  return rules.attributes.length > 0 || rules.patterns.length > 0
}
