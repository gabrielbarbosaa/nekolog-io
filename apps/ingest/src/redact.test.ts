import {
  MAX_ATTRIBUTE_RULES,
  NO_REDACTION,
  parseRedactionRules,
  REDACTION_PATTERNS,
  type RedactionRules,
} from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  EVERYTHING_REDACTED,
  MAX_REDACTED_CHARS,
  patternFor,
  redactAttributes,
  redactText,
  rulesFor,
} from './redact.ts'

function rules(overrides: Partial<RedactionRules> = {}): RedactionRules {
  return { attributes: [], patterns: [], replacement: '[redacted]', ...overrides }
}

const QUADRATIC_AGAIN = 200

describe('what a stored rule turns into', () => {
  it('is nothing at all when the environment set nothing', () => {
    expect(rulesFor(undefined)).toEqual(NO_REDACTION)
    expect(rulesFor(null)).toEqual(NO_REDACTION)
    expect(rulesFor({})).toEqual(NO_REDACTION)
  })

  it('is what the environment asked for', () => {
    expect(rulesFor({ patterns: ['email'], attributes: ['user.password'] })).toEqual({
      patterns: ['email'],
      attributes: ['user.password'],
      replacement: '[redacted]',
    })
  })

  it('fails closed on a rule it cannot read, rather than writing the data in the clear', () => {
    for (const broken of [
      { patterns: ['regex:.*'] },
      { patterns: 'email' },
      { attributes: [42] },
      { replacement: '<script>' },
      [],
    ]) {
      expect(rulesFor(broken)).toEqual(EVERYTHING_REDACTED)
    }
  })

  it('redacts with every pattern it knows when it falls closed', () => {
    expect([...EVERYTHING_REDACTED.patterns]).toEqual([...REDACTION_PATTERNS])
  })
})

describe('the patterns', () => {
  const samples: Array<[string, string, string]> = [
    ['email', 'write to ana.silva+x@example.co.uk now', 'ana.silva+x@example.co.uk'],
    ['ipv4', 'from 203.0.113.42 at noon', '203.0.113.42'],
    ['ipv6', 'from 2606:4700:4700::1111 at noon', '2606:4700:4700::1111'],
    ['phone_br', 'call +55 11 99999-8888 now', '+55 11 99999-8888'],
    ['cpf', 'cpf 123.456.789-09 ok', '123.456.789-09'],
    ['cnpj', 'cnpj 12.345.678/0001-95 ok', '12.345.678/0001-95'],
    ['jwt', 'token eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM here', 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM'],
    ['bearer', 'auth Bearer abcdefghijklmnop done', 'Bearer abcdefghijklmnop'],
    ['uuid', 'id 01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10 ok', '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10'],
    ['credit_card', 'card 4111 1111 1111 1111 ok', '4111 1111 1111 1111'],
  ]

  it.each(samples)('finds a %s and leaves the rest alone', (name, input, secret) => {
    const out = redactText(input, rules({ patterns: [name as never] }))

    expect(out).not.toContain(secret)
    expect(out).toContain('[redacted]')
    expect(out.startsWith(input.split(secret)[0] ?? '')).toBe(true)
  })

  it('covers every pattern the contract names', () => {
    expect(samples.map(([name]) => name).sort()).toEqual([...REDACTION_PATTERNS].sort())
    for (const name of REDACTION_PATTERNS) {
      expect(patternFor(name)).toBeInstanceOf(RegExp)
    }
  })

  it('replaces every occurrence, not only the first', () => {
    const out = redactText('a@b.test and c@d.test', rules({ patterns: ['email'] }))

    expect(out).toBe('[redacted] and [redacted]')
  })

  it('does not get confused by running twice', () => {
    const once = redactText('a@b.test', rules({ patterns: ['email'] }))

    expect(redactText('a@b.test', rules({ patterns: ['email'] }))).toBe(once)
  })

  it('applies every pattern the environment turned on', () => {
    const out = redactText('a@b.test from 10.0.0.1', rules({ patterns: ['email', 'ipv4'] }))

    expect(out).toBe('[redacted] from [redacted]')
  })

  it('leaves the text alone when no pattern is on', () => {
    expect(redactText('a@b.test', rules())).toBe('a@b.test')
  })

  it('uses the replacement the environment chose', () => {
    expect(redactText('a@b.test', rules({ patterns: ['email'], replacement: '***' }))).toBe('***')
  })
})

describe('attributes', () => {
  it('replaces a value whose key was named', () => {
    const out = redactAttributes(
      { 'user.password': 'hunter2', 'user.name': 'ana' },
      rules({ attributes: ['user.password'] }),
    )

    expect(out).toEqual({ 'user.password': '[redacted]', 'user.name': 'ana' })
  })

  it('replaces a whole family with a trailing star', () => {
    const out = redactAttributes(
      { 'headers.authorization': 'x', 'headers.accept': 'y', 'body.id': 'z' },
      rules({ attributes: ['headers.*'] }),
    )

    expect(out).toEqual({
      'headers.authorization': '[redacted]',
      'headers.accept': '[redacted]',
      'body.id': 'z',
    })
  })

  it('never blanks a key that merely starts with a named one', () => {
    const out = redactAttributes(
      { 'user.password': 'x', 'user.passwordHint': 'mother' },
      rules({ attributes: ['user.password'] }),
    )

    expect(out).toEqual({ 'user.password': '[redacted]', 'user.passwordHint': 'mother' })
  })

  it('does not treat a star as matching the middle of a key', () => {
    const out = redactAttributes({ 'a.headers.b': 'x' }, rules({ attributes: ['headers.*'] }))

    expect(out).toEqual({ 'a.headers.b': 'x' })
  })

  it('still runs the patterns over the values it keeps', () => {
    const out = redactAttributes(
      { 'user.contact': 'ana@example.com' },
      rules({ patterns: ['email'] }),
    )

    expect(out).toEqual({ 'user.contact': '[redacted]' })
  })

  it('keeps the key, so the shape of the row does not change', () => {
    const out = redactAttributes({ 'user.password': 'x' }, rules({ attributes: ['user.password'] }))

    expect(Object.keys(out)).toEqual(['user.password'])
  })

  it('does nothing when there is nothing to do', () => {
    const attributes = { a: '1' }

    expect(redactAttributes(attributes, rules())).toBe(attributes)
  })
})

describe('the cost of redacting a hostile message', () => {
  it('is not quadratic on the shape that used to take 266 ms', () => {
    const hostile = '1-'.repeat(MAX_REDACTED_CHARS / 2)
    const everything = rules({ patterns: [...REDACTION_PATTERNS] })

    const started = performance.now()
    redactText(hostile, everything)
    const took = performance.now() - started

    expect(took).toBeLessThan(QUADRATIC_AGAIN)
  })

  it('is not quadratic on any shape, not only that one', () => {
    const everything = rules({ patterns: [...REDACTION_PATTERNS] })
    const shapes = ['1', 'a@', 'a.', 'a:', '1 ', '1.', '0f-'].map((unit) =>
      unit.repeat(Math.floor(MAX_REDACTED_CHARS / unit.length)),
    )

    const started = performance.now()
    for (const shape of shapes) {
      redactText(shape, everything)
    }
    const took = performance.now() - started

    expect(took).toBeLessThan(shapes.length * QUADRATIC_AGAIN)
  })

  it('only ever looks at the first sixteen kilobytes, and keeps the rest', () => {
    const tail = 'ana@example.com'
    const long = `${'x'.repeat(MAX_REDACTED_CHARS)}${tail}`

    const out = redactText(long, rules({ patterns: ['email'] }))

    expect(out.endsWith(tail)).toBe(true)
    expect(out).toHaveLength(long.length)
  })
})

describe('the contract the dashboard writes against', () => {
  it('refuses a rule that smuggles a regex in, whatever it is called', () => {
    for (const field of ['regex', 'pattern', 'patternSource']) {
      expect(() => parseRedactionRules({ patterns: [`${field}:.*`] })).toThrow(/patterns/)
    }
  })

  it('refuses an attribute rule that is not an attribute key', () => {
    for (const bad of ['user password', 'a*b', '*', '', 'x'.repeat(130)]) {
      expect(() => parseRedactionRules({ attributes: [bad] })).toThrow(/attributes/)
    }
  })

  it('refuses more attribute rules than it will carry', () => {
    const many = Array.from({ length: MAX_ATTRIBUTE_RULES + 1 }, (_, at) => `a.key${at}`)

    expect(() => parseRedactionRules({ attributes: many })).toThrow(/at most 50/)
    expect(parseRedactionRules({ attributes: many.slice(0, -1) }).attributes).toHaveLength(
      MAX_ATTRIBUTE_RULES,
    )
  })

  it('refuses the same attribute rule twice, which is always a mistake', () => {
    expect(() => parseRedactionRules({ attributes: ['user.password', 'user.password'] })).toThrow(
      /appears twice/,
    )
  })

  it('keeps one copy of a pattern named twice, rather than running it twice', () => {
    expect(parseRedactionRules({ patterns: ['email', 'email'] }).patterns).toEqual(['email'])
  })

  it('refuses a replacement that could be read as markup', () => {
    for (const bad of ['<b>', '"', "'", '{{x}}', 'x'.repeat(33)]) {
      expect(() => parseRedactionRules({ replacement: bad })).toThrow(/replacement/)
    }
  })
})
