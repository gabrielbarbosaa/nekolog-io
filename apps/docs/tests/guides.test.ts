import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SOURCE_LOCALE, TRANSLATED_LOCALES } from '../locales.mjs'

const DOCS_URL = new URL('../src/content/docs/', import.meta.url)
const CONFIG_URL = new URL('../astro.config.mjs', import.meta.url)
const PAGE_EXTENSIONS = ['.md', '.mdx']

const SERVER_GUIDES = ['express', 'fastify', 'hono', 'nestjs', 'next']
const ALL_LOCALES = [SOURCE_LOCALE, ...TRANSLATED_LOCALES]
const ALLOW_HEADERS = /allowedheaders|allowheaders|access-control-allow-headers/i
const EXPOSE_HEADERS = /exposedheaders|exposeheaders|access-control-expose-headers/i

async function sourcePageIds(): Promise<string[]> {
  const entries = await readdir(DOCS_URL, { recursive: true, withFileTypes: true })
  const translated = TRANSLATED_LOCALES.map((locale) => locale.dir)
  return entries
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const dir = entry.parentPath.replaceAll('\\', '/').split('/content/docs/')[1] ?? ''
      return dir ? `${dir}/${entry.name}` : entry.name
    })
    .filter((path) => !translated.some((dir) => path.startsWith(`${dir}/`)))
    .map((path) => path.replace(/\.mdx?$/, ''))
    .filter((id) => id !== 'index')
}

function bodyOf(locale: { dir: string }, id: string): Promise<string> {
  const path = locale.dir === '' ? `${id}.md` : `${locale.dir}/${id}.md`
  return readFile(new URL(path, DOCS_URL), 'utf8')
}

function linesMatching(body: string, pattern: RegExp): string[] {
  return body.split('\n').filter((line) => pattern.test(line))
}

describe('the sidebar', () => {
  it('lists every page', async () => {
    const config = await readFile(CONFIG_URL, 'utf8')
    const listed = new Set(
      [...config.matchAll(/slug:\s*'([^']+)'/g)].map(([, slug]) => slug as string),
    )
    const pages = await sourcePageIds()

    expect(pages.length).toBeGreaterThan(0)

    const unlisted = pages.filter((id) => !listed.has(id)).sort()
    expect(
      unlisted,
      `These pages build but no sidebar entry points at them: ${unlisted.join(', ')}`,
    ).toEqual([])

    const dangling = [...listed].filter((slug) => !pages.includes(slug)).sort()
    expect(dangling, `These sidebar entries have no page: ${dangling.join(', ')}`).toEqual([])
  })
})

describe('the traceparent CORS note', () => {
  it('tells every server guide, in every locale, to allow the header', async () => {
    for (const locale of ALL_LOCALES) {
      for (const guide of SERVER_GUIDES) {
        const body = await bodyOf(locale, `guides/${guide}`)
        const allowing = linesMatching(body, ALLOW_HEADERS)

        expect(
          allowing.length,
          `${locale.lang} guides/${guide} says nothing about allowing request headers in CORS`,
        ).toBeGreaterThan(0)

        expect(
          allowing.some((line) => line.includes('traceparent')),
          `${locale.lang} guides/${guide} lists allowed CORS headers without traceparent`,
        ).toBe(true)
      }
    }
  })

  it('explains both headers on the tracing page, in every locale', async () => {
    for (const locale of ALL_LOCALES) {
      const body = await bodyOf(locale, 'guides/tracing')

      expect(
        linesMatching(body, ALLOW_HEADERS).some((line) => line.includes('traceparent')),
        `${locale.lang} guides/tracing does not name Access-Control-Allow-Headers: traceparent`,
      ).toBe(true)

      expect(
        linesMatching(body, EXPOSE_HEADERS).some((line) => line.includes('x-request-id')),
        `${locale.lang} guides/tracing does not name Access-Control-Expose-Headers: x-request-id`,
      ).toBe(true)
    }
  })
})
