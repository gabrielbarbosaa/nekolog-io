import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  appUrlMatchesTheDashboard,
  DASHBOARD_PORT,
  envVerdicts,
  missingFrom,
  pemLooksReal,
  placeholdersIn,
  REQUIRED_FOR_DASHBOARD,
  REQUIRED_FOR_JOBS,
} from './checks.ts'
import { escapePem, FILLED, needsFilling, parseEnv, renderDevEnv, valuesOf } from './env.ts'

const EXAMPLE = readFileSync(
  fileURLToPath(new URL('../../../.env.example', import.meta.url)),
  'utf8',
)

const pair = generateKeyPairSync('ed25519')

const GENERATED = {
  secret: (bytes: number) => randomBytes(bytes).toString('base64url'),
  privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}

function render(current = ''): ReturnType<typeof renderDevEnv> {
  return renderDevEnv(EXAMPLE, current, GENERATED)
}

function valuesFrom(text: string): Record<string, string> {
  return valuesOf(parseEnv(text))
}

describe('the example this all starts from', () => {
  it('declares every variable the dashboard and the jobs need', () => {
    const declared = valuesFrom(EXAMPLE)

    expect(missingFrom(REQUIRED_FOR_DASHBOARD, declared)).toEqual([])
    expect(missingFrom(REQUIRED_FOR_JOBS, declared)).toEqual([])
  })

  it('points APP_URL at the dashboard, not at the landing page', () => {
    expect(appUrlMatchesTheDashboard(valuesFrom(EXAMPLE).APP_URL)).toBe(true)
    expect(valuesFrom(EXAMPLE).APP_URL).toContain(String(DASHBOARD_PORT))
  })

  it('still carries a placeholder for every value this script generates', () => {
    const declared = valuesFrom(EXAMPLE)

    for (const name of Object.keys(FILLED)) {
      expect(declared[name], `${name} is not in .env.example`).toBeDefined()
      expect(needsFilling(name, declared[name]), `${name} is already a real value`).toBe(true)
    }
  })
})

describe('writing a .env from nothing', () => {
  it('leaves no placeholder behind and satisfies every check the doctor makes', () => {
    const written = render()
    const values = valuesFrom(written.text)

    expect(placeholdersIn(values)).toEqual([])
    expect(envVerdicts(values).filter((verdict) => !verdict.ok)).toEqual([])
  })

  it('writes a signing key that actually parses', () => {
    const values = valuesFrom(render().text)

    expect(pemLooksReal(values.AUTH_JWT_PRIVATE_KEY)).toBe(true)
    expect(pemLooksReal(values.AUTH_JWT_PUBLIC_KEY)).toBe(true)
    expect(values.AUTH_JWT_PRIVATE_KEY, 'a PEM has to survive as one line').not.toMatch(/\r|\n/)
  })

  it('names what it generated', () => {
    expect(render().generated.sort()).toEqual(Object.keys(FILLED).sort())
  })

  it('keeps every comment of the example, which is where the explanations live', () => {
    const comments = EXAMPLE.split('\n').filter((line) => line.startsWith('#'))
    const written = render().text

    for (const comment of comments) {
      expect(written).toContain(comment)
    }
  })
})

describe('writing a .env over one that is already there', () => {
  it('never replaces a value somebody set', () => {
    const current = [
      'DATABASE_URL=postgres://real@db.test/nekolog',
      'EMAIL_FROM=me@acme.test',
    ].join('\n')
    const values = valuesFrom(render(current).text)

    expect(values.DATABASE_URL).toBe('postgres://real@db.test/nekolog')
    expect(values.EMAIL_FROM).toBe('me@acme.test')
  })

  it('never replaces a secret that is already real', () => {
    const first = render().text
    const again = renderDevEnv(EXAMPLE, first, GENERATED)

    expect(again.generated, 'running it twice must mint nothing new').toEqual([])
    expect(valuesFrom(again.text).AUTH_JWT_PRIVATE_KEY).toBe(valuesFrom(first).AUTH_JWT_PRIVATE_KEY)
  })

  it('does replace a placeholder, which is the whole reason this exists', () => {
    const current = 'AUTH_JWT_PRIVATE_KEY=dev-only-fake-ed25519-private-key'

    expect(render(current).generated).toContain('AUTH_JWT_PRIVATE_KEY')
    expect(pemLooksReal(valuesFrom(render(current).text).AUTH_JWT_PRIVATE_KEY)).toBe(true)
  })

  it('replaces a blank value too', () => {
    expect(render('AUTH_OTP_SECRET=').generated).toContain('AUTH_OTP_SECRET')
    expect(render('AUTH_OTP_SECRET=   ').generated).toContain('AUTH_OTP_SECRET')
  })

  it('reads a .env a Windows editor left a byte order mark on', () => {
    const current = `﻿DATABASE_URL=postgres://real@db.test/nekolog`
    const values = valuesFrom(render(current).text)

    expect(values.DATABASE_URL, 'a BOM would hide the first variable').toBe(
      'postgres://real@db.test/nekolog',
    )
    expect(render(current).text.charCodeAt(0), 'and it writes none of its own').not.toBe(0xfeff)
  })

  it('keeps a variable the example does not know about', () => {
    const values = valuesFrom(render('MY_OWN_THING=keep me').text)

    expect(values.MY_OWN_THING).toBe('keep me')
  })

  it('ends with exactly one newline, however many the example had', () => {
    expect(render().text.endsWith('\n')).toBe(true)
    expect(render().text.endsWith('\n\n')).toBe(false)
  })
})

describe('a PEM going into a one-line file', () => {
  it('escapes its newlines, because that is what lib/keys.ts un-escapes', () => {
    const escaped = escapePem('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n')

    expect(escaped).toBe('-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----')
    expect(escaped).not.toMatch(/\n/)
  })

  it('is read back the way the dashboard reads it', () => {
    const escaped = escapePem(GENERATED.privateKey)

    expect(pemLooksReal(escaped)).toBe(true)
  })
})

describe('the doctor, told that something is wrong', () => {
  it('says so when a variable is missing', () => {
    const broken = { ...valuesFrom(render().text), DATABASE_URL: '' }
    const failed = envVerdicts(broken).filter((verdict) => !verdict.ok)

    expect(
      failed.map((verdict) => verdict.name),
      'DATABASE_URL belongs to the dashboard and to the jobs, so both say so',
    ).toEqual([
      'the dashboard has every variable it needs',
      'the jobs have every variable they need',
    ])
    expect(failed.every((verdict) => verdict.detail.includes('DATABASE_URL'))).toBe(true)
  })

  it('says so when APP_URL points at the landing page', () => {
    const broken = { ...valuesFrom(render().text), APP_URL: 'http://localhost:3000' }
    const failed = envVerdicts(broken).filter((verdict) => !verdict.ok)

    expect(failed).toHaveLength(1)
    expect(failed[0]?.detail).toContain('bad_origin')
  })

  it('says so when the signing key is not a key', () => {
    const broken = { ...valuesFrom(render().text), AUTH_JWT_PRIVATE_KEY: 'nonsense' }
    const failed = envVerdicts(broken).filter((verdict) => !verdict.ok)

    expect(failed.map((verdict) => verdict.name)).toContain(
      'the signing key is a real Ed25519 pair',
    )
  })

  it('refuses a PEM that lost its body', () => {
    expect(pemLooksReal('-----BEGIN PRIVATE KEY-----\\n-----END PRIVATE KEY-----')).toBe(false)
    expect(pemLooksReal(undefined)).toBe(false)
    expect(pemLooksReal('')).toBe(false)
  })
})
