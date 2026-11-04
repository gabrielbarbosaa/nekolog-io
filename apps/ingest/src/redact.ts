import {
  attributeMatches,
  hasRules,
  NO_REDACTION,
  parseRedactionRules,
  REDACTION_PATTERNS,
  type RedactionPattern,
  type RedactionRules,
} from '@nekolog-io/adapters'

export const MAX_REDACTED_CHARS = 16 * 1024

export const EVERYTHING_REDACTED: RedactionRules = {
  attributes: [],
  patterns: REDACTION_PATTERNS,
  replacement: '[redacted]',
}

export function rulesFor(stored: unknown): RedactionRules {
  if (stored === undefined || stored === null) {
    return NO_REDACTION
  }
  try {
    return parseRedactionRules(stored)
  } catch {
    return EVERYTHING_REDACTED
  }
}

const PATTERNS: Readonly<Record<RedactionPattern, RegExp>> = {
  email: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,10}/g,
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  ipv6: /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g,
  phone_br: /(?:\+55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g,
  cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
  cnpj: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
  jwt: /\beyJ[A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,2048}/g,
  bearer: /\bBearer\s{1,8}[A-Za-z0-9._~+/-]{8,4096}={0,2}/g,
  uuid: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  credit_card: /\b(?:\d[ -]?){13,19}\b/g,
}

export function patternFor(name: RedactionPattern): RegExp {
  return PATTERNS[name]
}

export function redactText(value: string, rules: RedactionRules): string {
  if (value === '' || rules.patterns.length === 0) {
    return value
  }

  const head = value.length > MAX_REDACTED_CHARS ? value.slice(0, MAX_REDACTED_CHARS) : value
  const tail = value.length > MAX_REDACTED_CHARS ? value.slice(MAX_REDACTED_CHARS) : ''

  let redacted = head
  for (const name of rules.patterns) {
    redacted = redacted.replace(PATTERNS[name], rules.replacement)
  }

  return `${redacted}${tail}`
}

export function redactAttributes(
  attributes: Record<string, string>,
  rules: RedactionRules,
): Record<string, string> {
  if (!hasRules(rules)) {
    return attributes
  }

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(attributes)) {
    const dropped = rules.attributes.some((rule) => attributeMatches(key, rule))
    out[key] = dropped ? rules.replacement : redactText(value, rules)
  }
  return out
}
