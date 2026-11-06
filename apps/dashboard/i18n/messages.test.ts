import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultLocale, type Locale, locales } from './locales'

const MESSAGES_DIR = fileURLToPath(new URL('../messages/', import.meta.url))

type Messages = { [key: string]: string | Messages }

async function loadMessages(locale: Locale): Promise<Messages> {
  return JSON.parse(await readFile(`${MESSAGES_DIR}${locale}.json`, 'utf8'))
}

function flattenKeys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [path] : flattenKeys(value, path)
  })
}

function flattenEntries(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string'
      ? ([[path, value]] as [string, string][])
      : flattenEntries(value, path)
  })
}

const translatedLocales = locales.filter((locale) => locale !== defaultLocale)

const THE_SAME_IN_EVERY_LANGUAGE = [
  'Sidebar.logs',
  'Sidebar.issues',
  'Sidebar.dashboards',
  'Sidebar.releases',
  'Explorer.searchHint',
  'Explorer.trace_id',
  'Explorer.span_id',
  'Levels.trace',
  'Levels.debug',
  'Levels.info',
  'Levels.warn',
  'Levels.error',
  'Levels.fatal',
  'Keys.title',
  'Auth.email',
  'Members.inviteEmail',
  'Account.email',
]

describe('dashboard message i18n parity', () => {
  it('defines the same keys in every locale', async () => {
    const source = flattenKeys(await loadMessages(defaultLocale)).sort()

    expect(source.length).toBeGreaterThan(0)

    for (const locale of translatedLocales) {
      const translated = flattenKeys(await loadMessages(locale)).sort()

      const missing = source.filter((key) => !translated.includes(key))
      expect(missing, `${locale}.json is missing: ${missing.join(', ')}`).toEqual([])

      const extra = translated.filter((key) => !source.includes(key))
      expect(
        extra,
        `${locale}.json has keys absent from ${defaultLocale}.json: ${extra.join(', ')}`,
      ).toEqual([])
    }
  })

  it('has no translation that is still the English sentence', async () => {
    const source = new Map(flattenEntries(await loadMessages(defaultLocale)))

    for (const locale of translatedLocales) {
      const untranslated = flattenEntries(await loadMessages(locale))
        .filter(([key, value]) => source.get(key) === value)
        .map(([key]) => key)
        .filter((key) => !THE_SAME_IN_EVERY_LANGUAGE.includes(key))

      expect(
        untranslated,
        `${locale}.json still carries the English text at: ${untranslated.join(', ')}`,
      ).toEqual([])
    }
  })

  it('keeps the allow-list to product nouns and to the query language', async () => {
    const values = new Map(flattenEntries(await loadMessages(defaultLocale)))

    for (const key of THE_SAME_IN_EVERY_LANGUAGE) {
      const value = values.get(key)

      expect(value, `${key} is on the allow-list but is not a message`).toBeDefined()
      expect(
        (value as string).split(' ').length,
        `${key} is a sentence, not a name or a query`,
      ).toBeLessThan(3)
    }
  })

  it('has no blank translations', async () => {
    for (const locale of locales) {
      const blank = flattenEntries(await loadMessages(locale))
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)

      expect(blank, `${locale}.json has empty values: ${blank.join(', ')}`).toEqual([])
    }
  })

  it('uses sentence case, because a label in capitals is decoration', async () => {
    for (const locale of locales) {
      const shouting = flattenEntries(await loadMessages(locale))
        .filter(([, value]) => /\b[A-ZÁÉÍÓÚÃÕÂÊÔÇ]{3,}\b/.test(value))
        .map(([key]) => key)

      expect(shouting, `${locale}.json shouts at: ${shouting.join(', ')}`).toEqual([])
    }
  })
})
