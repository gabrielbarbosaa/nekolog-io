import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SOURCE_LOCALE, TRANSLATED_LOCALES } from '../locales.mjs'

const DOCS_DIR = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const PAGE_EXTENSIONS = ['.md', '.mdx']

/** Every page path under src/content/docs/, relative to it, using "/" separators. */
async function listPages(): Promise<string[]> {
  const entries = await readdir(DOCS_DIR, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const dir = entry.parentPath.slice(DOCS_DIR.length).replaceAll('\\', '/')
      return dir ? `${dir}/${entry.name}` : entry.name
    })
}

/**
 * The locale-independent identity of a page: "pt-br/getting-started/intro.md"
 * and "getting-started/intro.mdx" are both the page "getting-started/intro".
 * The extension is dropped so a translation may use .md where the source uses
 * .mdx (Starlight resolves both to the same route).
 */
function pageId(path: string, localeDir: string): string {
  const withoutLocale = localeDir ? path.slice(localeDir.length + 1) : path
  return withoutLocale.replace(/\.mdx?$/, '')
}

function localeOf(path: string) {
  return TRANSLATED_LOCALES.find((locale) => path.startsWith(`${locale.dir}/`)) ?? SOURCE_LOCALE
}

describe('documentation i18n parity', () => {
  it('has every page translated into every locale', async () => {
    const pages = await listPages()

    // Guard against the walk silently finding nothing and the test passing vacuously.
    expect(pages.length).toBeGreaterThan(0)

    const byLocale = new Map<string, Set<string>>()
    for (const locale of [SOURCE_LOCALE, ...TRANSLATED_LOCALES]) {
      byLocale.set(locale.lang, new Set())
    }
    for (const path of pages) {
      const locale = localeOf(path)
      byLocale.get(locale.lang)?.add(pageId(path, locale.dir))
    }

    const source = byLocale.get(SOURCE_LOCALE.lang) ?? new Set()
    expect(source.size).toBeGreaterThan(0)

    for (const locale of TRANSLATED_LOCALES) {
      const translated = byLocale.get(locale.lang) ?? new Set()

      const missing = [...source].filter((page) => !translated.has(page)).sort()
      expect(
        missing,
        `Missing ${locale.lang} translations. Add: ${missing
          .map((page) => `src/content/docs/${locale.dir}/${page}.md`)
          .join(', ')}`,
      ).toEqual([])

      // A page that only exists in a translation is just as broken: readers of
      // other locales silently never see it.
      const orphaned = [...translated].filter((page) => !source.has(page)).sort()
      expect(
        orphaned,
        `These ${locale.lang} pages have no English source: ${orphaned.join(', ')}`,
      ).toEqual([])
    }
  })
})
