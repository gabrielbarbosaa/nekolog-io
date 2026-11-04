import { readFile } from 'node:fs/promises'
import {
  MAX_ISSUE_ROWS,
  MAX_SOURCE_MAP_BYTES,
  MAX_SOURCE_MAPS_PER_RELEASE,
} from '@nekolog-io/adapters'
import {
  HISTOGRAM_BUCKETS,
  MAX_CONDITIONS,
  MAX_DEPTH,
  MAX_HISTOGRAM_BUCKETS,
  MAX_QUERY_CHARS,
  MAX_SEARCH_ROWS,
  SEARCH_FIELDS,
} from '@nekolog-io/clickhouse/search'
import { describe, expect, it } from 'vitest'
import { DEFAULT_REQUESTS_PER_MINUTE, HISTOGRAM_PARAMS, ISSUE_PARAMS, LOG_PARAMS } from './app.ts'
import { API_ERROR_CODES, STATUS_FOR_CODE } from './errors.ts'
import { MAX_PERIOD_MS } from './period.ts'

const DOCS = new URL('../../docs/src/content/docs/', import.meta.url)
const LOCALES = ['', 'pt-br/', 'es/']

const DAY_MS = 24 * 60 * 60 * 1000

async function page(locale: string, id: string): Promise<string> {
  return readFile(new URL(`${locale}${id}.md`, DOCS), 'utf8')
}

function says(body: string, number: number): boolean {
  return new RegExp(`(?<![\\d.,])${number}(?!\\d|[.,]\\d)`).test(body)
}

describe('the public API reference, in every language', () => {
  it('names every error code and the status it answers with', async () => {
    for (const locale of LOCALES) {
      const body = await page(locale, 'api/reference')

      for (const code of API_ERROR_CODES) {
        expect(body, `${locale} is missing ${code}`).toContain(`\`${code}\``)
        expect(body, `${locale} is missing the status of ${code}`).toMatch(
          new RegExp(`\`${code}\`\\s*\\|\\s*${STATUS_FOR_CODE[code]}`),
        )
      }
    }
  })

  it('states the limits the code actually enforces', async () => {
    const expected = [
      MAX_SEARCH_ROWS,
      MAX_ISSUE_ROWS,
      MAX_HISTOGRAM_BUCKETS,
      DEFAULT_REQUESTS_PER_MINUTE,
      MAX_PERIOD_MS / DAY_MS,
      MAX_SOURCE_MAP_BYTES / (1024 * 1024),
      MAX_SOURCE_MAPS_PER_RELEASE,
    ]

    for (const locale of LOCALES) {
      const body = await page(locale, 'api/reference')
      for (const number of expected) {
        expect(says(body, number), `${locale} never says ${number}`).toBe(true)
      }
    }
  })

  it('names every parameter each route takes', async () => {
    for (const locale of LOCALES) {
      const body = await page(locale, 'api/reference')

      for (const name of new Set([...LOG_PARAMS, ...HISTOGRAM_PARAMS, ...ISSUE_PARAMS])) {
        expect(body, `${locale} never names ${name}`).toContain(`\`${name}\``)
      }
    }
  })

  it('names every histogram bucket the code offers', async () => {
    for (const locale of LOCALES) {
      const body = await page(locale, 'api/reference')
      for (const bucket of HISTOGRAM_BUCKETS) {
        expect(body, `${locale} never names the ${bucket} bucket`).toContain(`\`${bucket}\``)
      }
    }
  })
})

describe('the search language page, in every language', () => {
  it('names every field the parser accepts, and no field it does not', async () => {
    for (const locale of LOCALES) {
      const body = await page(locale, 'api/search')
      const named = [...body.matchAll(/`([a-z]+)`/g)].map(([, name]) => name as string)

      for (const field of SEARCH_FIELDS) {
        expect(body, `${locale} never names ${field}`).toContain(`\`${field}\``)
      }
      for (const name of new Set(named)) {
        if (['level', 'service', 'release', 'source', 'trace', 'span', 'session'].includes(name)) {
          expect(SEARCH_FIELDS, `${locale} names ${name}, which is not a field`).toContain(name)
        }
      }
    }
  })

  it('states the three limits specification 4 sets', async () => {
    for (const locale of LOCALES) {
      const body = await page(locale, 'api/search')

      for (const number of [MAX_QUERY_CHARS, MAX_CONDITIONS, MAX_DEPTH]) {
        expect(says(body, number), `${locale} never says ${number}`).toBe(true)
      }
    }
  })
})
