import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SOURCE_LOCALE, TRANSLATED_LOCALES } from '../locales.mjs'

const DOCS_URL = new URL('../src/content/docs/', import.meta.url)
const DOCS_DIR = fileURLToPath(DOCS_URL)
const PAGE_EXTENSIONS = ['.md', '.mdx']
const BASE = '/docs/'
const INTERNAL_LINK = /\]\((\/docs\/[^)\s]*)\)/g

type Page = { path: string; id: string; lang: string; body: string }

async function listPages(): Promise<string[]> {
  const entries = await readdir(DOCS_DIR, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const dir = entry.parentPath.slice(DOCS_DIR.length).replaceAll('\\', '/')
      return dir ? `${dir}/${entry.name}` : entry.name
    })
}

function localeOf(path: string) {
  return TRANSLATED_LOCALES.find((locale) => path.startsWith(`${locale.dir}/`)) ?? SOURCE_LOCALE
}

function idOf(path: string, dir: string): string {
  const withoutLocale = dir ? path.slice(dir.length + 1) : path
  return withoutLocale.replace(/\.mdx?$/, '')
}

function targetOf(href: string): { id: string; lang: string } {
  const withoutBase = href.slice(BASE.length).split('#')[0] ?? ''
  const trimmed = withoutBase.replace(/\/$/, '')
  const locale = TRANSLATED_LOCALES.find(
    (candidate) => trimmed === candidate.dir || trimmed.startsWith(`${candidate.dir}/`),
  )
  if (locale === undefined) {
    return { id: trimmed === '' ? 'index' : trimmed, lang: SOURCE_LOCALE.lang }
  }
  const rest = trimmed.slice(locale.dir.length).replace(/^\//, '')
  return { id: rest === '' ? 'index' : rest, lang: locale.lang }
}

async function readPages(): Promise<Page[]> {
  const paths = await listPages()
  return Promise.all(
    paths.map(async (path) => {
      const locale = localeOf(path)
      return {
        path,
        id: idOf(path, locale.dir),
        lang: locale.lang,
        body: await readFile(new URL(path, DOCS_URL), 'utf8'),
      }
    }),
  )
}

function linksOf(page: Page): string[] {
  return [...page.body.matchAll(INTERNAL_LINK)].map(([, href]) => href as string)
}

describe('documentation links', () => {
  it('points every internal link at a page that exists', async () => {
    const pages = await readPages()
    expect(pages.length).toBeGreaterThan(0)

    const known = new Set(pages.map((page) => `${page.lang} ${page.id}`))
    const broken: string[] = []
    let checked = 0

    for (const page of pages) {
      for (const href of linksOf(page)) {
        checked += 1
        const target = targetOf(href)
        if (!known.has(`${target.lang} ${target.id}`)) {
          broken.push(`${page.path} → ${href}`)
        }
      }
    }

    expect(checked).toBeGreaterThan(0)
    expect(broken, `Links with no page behind them:\n${broken.join('\n')}`).toEqual([])
  })

  it('keeps every page linking inside its own locale', async () => {
    const pages = await readPages()
    const crossing: string[] = []

    for (const page of pages) {
      for (const href of linksOf(page)) {
        const target = targetOf(href)
        if (target.lang !== page.lang) {
          crossing.push(`${page.path} (${page.lang}) → ${href} (${target.lang})`)
        }
      }
    }

    expect(
      crossing,
      `These links drop the reader into another language:\n${crossing.join('\n')}`,
    ).toEqual([])
  })

  it('links every guide from the quickstart of its own locale', async () => {
    const pages = await readPages()
    const guides = pages.filter((page) => page.id.startsWith('guides/'))
    expect(guides.length).toBeGreaterThan(0)

    for (const locale of [SOURCE_LOCALE, ...TRANSLATED_LOCALES]) {
      const quickstart = pages.find(
        (page) => page.lang === locale.lang && page.id === 'getting-started/quickstart',
      )
      expect(quickstart, `No quickstart for ${locale.lang}`).toBeDefined()

      const linked = new Set(linksOf(quickstart as Page).map((href) => targetOf(href).id))
      const missing = guides
        .filter((page) => page.lang === locale.lang && !linked.has(page.id))
        .map((page) => page.id)
        .sort()

      expect(missing, `The ${locale.lang} quickstart does not link: ${missing.join(', ')}`).toEqual(
        [],
      )
    }
  })
})
