import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NO_REDACTION } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  ENVIRONMENT_COLORS,
  type EnvironmentSettings,
  LEVELS,
  MAX_ORIGINS,
  MAX_PROJECT_NAME_CHARS,
  MAX_RETENTION_DAYS,
  REDACTION_FIELDS,
  readEnvironmentName,
  readEnvironmentSettings,
  readOriginPattern,
  readProjectName,
  STARTING_ENVIRONMENTS,
} from './projects.ts'

const SOUND = {
  color: 'chart-1',
  retentionDays: 7,
  minLevel: 'info',
  sampleRate: 0.5,
  dailyEventQuota: 10_000,
  originAllowlist: ['https://app.example.com'],
  redactionRules: { patterns: ['email'], attributes: ['user.*'] },
}

function settingsOf(body: Record<string, unknown>): EnvironmentSettings {
  const read = readEnvironmentSettings(body)
  if ('refused' in read) {
    throw new Error(`refused ${read.refused} on ${read.field}`)
  }
  return read.settings
}

function refusalOf(body: Record<string, unknown>): string {
  const read = readEnvironmentSettings(body)
  if (!('refused' in read)) {
    throw new Error('it was accepted')
  }
  return read.refused
}

describe('the name of a project', () => {
  it('collapses whitespace and keeps what is left', () => {
    expect(readProjectName('  the   shop  ')).toBe('the shop')
  })

  it('refuses a blank name and one past the ceiling', () => {
    expect(readProjectName('   ')).toBeUndefined()
    expect(readProjectName('a'.repeat(MAX_PROJECT_NAME_CHARS + 1))).toBeUndefined()
    expect(readProjectName('a'.repeat(MAX_PROJECT_NAME_CHARS))).toHaveLength(MAX_PROJECT_NAME_CHARS)
  })
})

describe('the name of an environment, which a key will carry', () => {
  it.each(['production', 'qa', 'pr-1234', 'a'])('accepts %s', (name) => {
    expect(readEnvironmentName(name)).toBe(name)
  })

  it('lowercases, because the database insists', () => {
    expect(readEnvironmentName(' PRODUCTION ')).toBe('production')
  })

  it.each(['', '1st', '-leading', 'with space', 'tilde~', 'a'.repeat(32), 'UPPER_CASE'])(
    'refuses %s',
    (name) => {
      expect(readEnvironmentName(name)).toBeUndefined()
    },
  )

  it('matches the shape the schema itself checks', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../../packages/db/src/index.ts', import.meta.url)),
      'utf8',
    )

    expect(schema).toContain("sql`name ~ '^[a-z][a-z0-9-]{0,30}$'`")
  })
})

describe('an origin a public key may be used from', () => {
  it.each([
    ['https://app.example.com', 'https://app.example.com'],
    ['  HTTPS://App.Example.com/  ', 'https://app.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://*.example.com', 'https://*.example.com'],
    ['*', '*'],
  ])('reads %s as %s', (input, expected) => {
    expect(readOriginPattern(input)).toBe(expected)
  })

  it.each([
    'https://app.example.com/path',
    'https://user:secret@app.example.com',
    'https://app.example.com?a=b',
    'https://*.com',
    'https://*',
    'example.com',
    '',
    'https://',
    'https://app example.com',
  ])('refuses %s, rather than storing a pattern that can never match', (input) => {
    expect(readOriginPattern(input)).toBeUndefined()
  })
})

describe('the settings of one environment', () => {
  it('reads a sound body whole', () => {
    expect(settingsOf(SOUND)).toEqual({
      color: 'chart-1',
      retentionDays: 7,
      minLevel: 'info',
      sampleRate: 0.5,
      dailyEventQuota: 10_000,
      originAllowlist: ['https://app.example.com'],
      redactionRules: {
        attributes: ['user.*'],
        patterns: ['email'],
        replacement: '[redacted]',
      },
    })
  })

  it.each(LEVELS)('takes %s as a minimum level', (level) => {
    expect(settingsOf({ ...SOUND, minLevel: level }).minLevel).toBe(level)
  })

  it.each(ENVIRONMENT_COLORS)('takes %s as a colour', (color) => {
    expect(settingsOf({ ...SOUND, color }).color).toBe(color)
  })

  it('treats an absent colour, quota and allowlist as nothing set', () => {
    const settings = settingsOf({
      retentionDays: 1,
      minLevel: 'trace',
      sampleRate: 1,
    })

    expect(settings.color).toBeUndefined()
    expect(settings.dailyEventQuota).toBeUndefined()
    expect(settings.originAllowlist).toBeUndefined()
    expect(settings.redactionRules).toEqual({})
  })

  it('keeps an empty allowlist empty, which is not the same as absent', () => {
    expect(settingsOf({ ...SOUND, originAllowlist: [] }).originAllowlist).toEqual([])
  })

  it('drops a repeated origin instead of storing it twice', () => {
    expect(
      settingsOf({
        ...SOUND,
        originAllowlist: ['https://a.test', 'HTTPS://A.TEST/', 'https://b.test'],
      }).originAllowlist,
    ).toEqual(['https://a.test', 'https://b.test'])
  })

  it.each([
    ['unknown_color', { color: 'brand' }],
    ['bad_retention', { retentionDays: 0 }],
    ['bad_retention', { retentionDays: 1.5 }],
    ['bad_retention', { retentionDays: MAX_RETENTION_DAYS + 1 }],
    ['bad_retention', { retentionDays: '7' }],
    ['unknown_level', { minLevel: 'verbose' }],
    ['bad_sample_rate', { sampleRate: 0 }],
    ['bad_sample_rate', { sampleRate: 1.0001 }],
    ['bad_sample_rate', { sampleRate: Number.NaN }],
    ['bad_quota', { dailyEventQuota: 0 }],
    ['bad_quota', { dailyEventQuota: 1.5 }],
    ['bad_origins', { originAllowlist: 'https://a.test' }],
    ['bad_origins', { originAllowlist: ['https://a.test/orders'] }],
    [
      'too_many_origins',
      { originAllowlist: Array.from({ length: MAX_ORIGINS + 1 }, (_, n) => `https://a${n}.test`) },
    ],
    ['bad_redaction_rules', { redactionRules: { patterns: ['ssn'] } }],
    ['bad_redaction_rules', { redactionRules: { regex: '.*' } }],
    ['bad_redaction_rules', { redactionRules: [] }],
  ])('refuses with %s', (expected, patch) => {
    expect(refusalOf({ ...SOUND, ...patch })).toBe(expected)
  })

  it('names the field it refused, so a form can point at it', () => {
    const read = readEnvironmentSettings({ ...SOUND, sampleRate: 4 })

    expect('refused' in read && read.field).toBe('sampleRate')
  })

  it('never lets a tenant write a regular expression of their own', () => {
    for (const key of ['regex', 'pattern', 'patternSource']) {
      expect(refusalOf({ ...SOUND, redactionRules: { [key]: '(a+)+$' } })).toBe(
        'bad_redaction_rules',
      )
    }
  })

  it('names the key it did not know, rather than discarding it quietly', () => {
    const read = readEnvironmentSettings({ ...SOUND, redactionRules: { regex: '.*' } })

    expect('refused' in read && read.field).toBe('regex')
  })

  it('knows exactly the fields the parser reads, so a new one cannot arrive unguarded', () => {
    expect([...REDACTION_FIELDS].sort()).toEqual(Object.keys(NO_REDACTION).sort())
  })
})

describe('what a project is born with', () => {
  it('is the three the plan names, in that order', () => {
    expect(STARTING_ENVIRONMENTS.map((one) => one.name)).toEqual([
      'production',
      'staging',
      'development',
    ])
  })

  it.each(STARTING_ENVIRONMENTS)('gives $name a colour from the closed list', ({ color }) => {
    expect(ENVIRONMENT_COLORS as readonly string[]).toContain(color)
  })

  it('gives each of them a different colour', () => {
    expect(new Set(STARTING_ENVIRONMENTS.map((one) => one.color)).size).toBe(
      STARTING_ENVIRONMENTS.length,
    )
  })
})

describe('every statement in this module', () => {
  const source = readFileSync(fileURLToPath(new URL('./projects.ts', import.meta.url)), 'utf8')
  const constants = [...source.matchAll(/^const ([A-Z_]+) = `([\s\S]*?)`$/gm)].map((match) => ({
    name: match[1] as string,
    text: match[2] as string,
  }))

  const FRAGMENTS = ['BELONGS_TO', 'SOMETHING_ELSE_IS_LEFT']
  const statements = constants.filter((one) => !FRAGMENTS.includes(one.name))

  it('was found, so none of this is passing on an empty list', () => {
    expect(statements.map((one) => one.name).sort()).toEqual([
      'CREATE_ENVIRONMENT',
      'CREATE_PROJECT',
      'DELETE_ENVIRONMENT',
      'DELETE_PROJECT',
      'LIST_ENVIRONMENTS',
      'LIST_PROJECTS',
      'ONE_ENVIRONMENT',
      'ONE_PROJECT',
      'RENAME_PROJECT',
      'UPDATE_ENVIRONMENT',
    ])
  })

  it('names the organization itself, so an id alone never reaches another tenant', () => {
    const unscoped = statements
      .filter((one) => !one.text.includes('organization_id') && !one.text.includes('BELONGS_TO'))
      .map((one) => one.name)

    expect(unscoped).toEqual([])
  })

  it('has the organization inside the fragment the environment statements lean on', () => {
    const belongs = constants.find((one) => one.name === 'BELONGS_TO')

    expect(belongs?.text).toContain('projects.organization_id = $1')
    expect(belongs?.text).toContain('projects.id = environments.project_id')
  })

  it('binds every value it is given, and interpolates nothing but those fragments', () => {
    for (const { name, text } of constants) {
      const interpolations = [...text.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1] as string)

      expect(
        interpolations.every((one) => FRAGMENTS.includes(one)),
        name,
      ).toBe(true)
    }
  })
})

describe('the colours an environment may take', () => {
  const stylesheet = readFileSync(
    fileURLToPath(new URL('../../../apps/dashboard/app/globals.css', import.meta.url)),
    'utf8',
  )

  it.each(ENVIRONMENT_COLORS)('%s is a token the dashboard actually declares', (color) => {
    expect(stylesheet).toContain(`--color-${color}:`)
  })

  it('found a stylesheet, so that is not passing on an empty file', () => {
    expect(stylesheet.length).toBeGreaterThan(1000)
  })
})
