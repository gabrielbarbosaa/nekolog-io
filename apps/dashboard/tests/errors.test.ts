import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETTINGS_REFUSALS } from '@internal/auth'
import { describe, expect, it } from 'vitest'
import { locales } from '../i18n/locales'

const API = fileURLToPath(new URL('../app/api/', import.meta.url))
const MESSAGES = fileURLToPath(new URL('../messages/', import.meta.url))

const ANSWERED = /(?:error: '([a-z_]+)'|refusal\('([a-z_]+)')/g

const NOT_FOR_A_PERSON = new Set(['bad_origin', 'signed_out', 'no_such_session', 'session_ended'])

function sources(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sources(path))
    } else if (entry === 'route.ts') {
      found.push(readFileSync(path, 'utf8'))
    }
  }
  return found
}

const FROM_AN_OUTCOME: Record<string, string> = {
  no_invite: 'signed.outcome',
  bad_password: 'signed.outcome',
  account_exists: 'signed.outcome',
  wait: 'signed.outcome',
  session_ended: 'signedOut(',
}

function codesAnswered(): string[] {
  const found = new Set<string>([...SETTINGS_REFUSALS, ...Object.keys(FROM_AN_OUTCOME)])
  for (const source of sources(API)) {
    for (const match of source.matchAll(ANSWERED)) {
      found.add((match[1] ?? match[2]) as string)
    }
  }
  return [...found].sort()
}

function messagesFor(locale: string): Record<string, string> {
  const parsed = JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), 'utf8')) as {
    Errors: Record<string, string>
  }
  return parsed.Errors
}

const ANSWERS = codesAnswered()

describe('what a screen says when a route refuses', () => {
  it('found the codes, so none of this is passing on an empty list', () => {
    expect(ANSWERS.length).toBeGreaterThan(20)
    expect(ANSWERS).toContain('invalid_credentials')
    expect(ANSWERS).toContain('the_last_owner')
  })

  it.each(locales)('%s has a sentence for every code a route can answer', (locale) => {
    const said = messagesFor(locale)
    const missing = ANSWERS.filter(
      (code) => !NOT_FOR_A_PERSON.has(code) && said[code] === undefined,
    )

    expect(missing, `no message for: ${missing.join(', ')}`).toEqual([])
  })

  it.each(locales)('%s says something for the two cases with no code at all', (locale) => {
    const said = messagesFor(locale)

    expect(said.unknown, 'a refusal this build has never heard of').toBeDefined()
    expect(said.offline, 'the request that never reached the server').toBeDefined()
  })

  it('still finds the two places a code is built rather than written out', () => {
    const everything = sources(API).join('\n')

    for (const marker of new Set(Object.values(FROM_AN_OUTCOME))) {
      expect(everything, `nothing builds a code with ${marker} any more`).toContain(marker)
    }
  })

  it('carries no message for a code nothing answers any more', () => {
    const known = new Set([...ANSWERS, 'unknown', 'offline', ...NOT_FOR_A_PERSON])
    const stale = Object.keys(messagesFor('en')).filter((code) => !known.has(code))

    expect(stale, `nothing answers: ${stale.join(', ')}`).toEqual([])
  })
})
