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

  it('has no blank translations', async () => {
    for (const locale of locales) {
      const blank = flattenEntries(await loadMessages(locale))
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)

      expect(blank, `${locale}.json has empty values: ${blank.join(', ')}`).toEqual([])
    }
  })
})
