import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Locale, locales } from '../i18n/locales'

const MESSAGES_DIR = fileURLToPath(new URL('../messages/', import.meta.url))
const REPO = fileURLToPath(new URL('../../../', import.meta.url))

const SDKS = [
  '@nekolog-io/browser',
  '@nekolog-io/bundler-plugin',
  '@nekolog-io/cli',
  '@nekolog-io/express',
  '@nekolog-io/fastify',
  '@nekolog-io/hono',
  '@nekolog-io/nestjs',
  '@nekolog-io/next',
  '@nekolog-io/node',
  '@nekolog-io/pino',
  '@nekolog-io/react',
  '@nekolog-io/winston',
]

const SHARED = [
  '@nekolog-io/adapters',
  '@nekolog-io/clickhouse',
  '@nekolog-io/config',
  '@nekolog-io/core',
  '@nekolog-io/db',
]

type Messages = { [key: string]: string | Messages }

function collect(node: Messages): string[] {
  return Object.values(node).flatMap((value) =>
    typeof value === 'string' ? [value] : collect(value),
  )
}

async function pageText(locale: Locale): Promise<string> {
  const messages = JSON.parse(await readFile(`${MESSAGES_DIR}${locale}.json`, 'utf8')) as Messages
  return collect(messages.HomePage as Messages).join('\n')
}

function says(text: string, value: string): boolean {
  const escaped = value.replace(/[*+?^${}()|[\]\\]/g, '\\$&').replace('\\.', '[.,]')
  return new RegExp(`(?<![\\d.,])${escaped}(?!\\d|[.,]\\d)`).test(text)
}

async function publishedPackages(): Promise<string[]> {
  const entries = await readdir(`${REPO}packages`, { withFileTypes: true })
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = JSON.parse(
      await readFile(`${REPO}packages/${entry.name}/package.json`, 'utf8'),
    ) as { name: string; private?: boolean }
    if (manifest.private !== true) {
      names.push(manifest.name)
    }
  }
  return names.sort()
}

describe('the two kinds of published package', () => {
  it('together are every package this repository publishes, and nothing else', async () => {
    expect([...SDKS, ...SHARED].sort()).toEqual(await publishedPackages())
  })

  it('do not overlap, so a package is one thing or the other', () => {
    expect(SDKS.filter((name) => SHARED.includes(name))).toEqual([])
  })
})

describe('what the landing page claims', () => {
  it('counts the SDKs the repository actually publishes', async () => {
    expect(SDKS).toHaveLength(12)

    for (const locale of locales) {
      expect(says(await pageText(locale), '12'), `${locale} does not say 12`).toBe(true)
    }
  })

  it('names the CPU budget the ingestion is actually measured against', async () => {
    const budget = await readFile(`${REPO}internal/load/src/budget.ts`, 'utf8')

    expect(budget).toMatch(/WORKER_CPU_BUDGET_MS = 10\b/)
    for (const locale of locales) {
      const text = await pageText(locale)

      expect(says(text, '10'), `${locale} does not name the 10 ms limit`).toBe(true)
      expect(says(text, '10.8'), `${locale} does not say what was measured`).toBe(true)
    }
  })

  it('names the batch sizes the SDK actually uses', async () => {
    const limits = await readFile(`${REPO}packages/core/src/limits.ts`, 'utf8')

    expect(limits).toMatch(/MAX_EVENTS_PER_BATCH = 500\b/)
    expect(limits).toMatch(/DEFAULT_MAX_BATCH_EVENTS = 200\b/)
    for (const locale of locales) {
      const text = await pageText(locale)

      expect(says(text, '500'), `${locale} does not say 500`).toBe(true)
      expect(says(text, '200'), `${locale} does not say 200`).toBe(true)
    }
  })

  it('does not promise a size budget the browser SDK misses', async () => {
    const budget = JSON.parse(
      await readFile(`${REPO}packages/browser/.size-limit.json`, 'utf8'),
    ) as Array<{ limit: string }>

    expect(budget[0]?.limit).toBe('12.5 kB')
    for (const locale of locales) {
      const text = await pageText(locale)

      expect(says(text, '12.05'), `${locale} does not say what init measures`).toBe(true)
      expect(says(text, '5'), `${locale} does not name the target it missed`).toBe(true)
    }
  })

  it('names the oldest Node the compatibility matrix still runs', async () => {
    const matrix = await readFile(`${REPO}.github/workflows/compat.yml`, 'utf8')

    expect(matrix, 'the matrix no longer starts at Node 22').toMatch(/node: \["22",/)
    for (const locale of locales) {
      expect(says(await pageText(locale), '22'), `${locale} does not say Node 22`).toBe(true)
    }
  })

  it('tells the reader there is nothing to sign up for', async () => {
    for (const locale of locales) {
      const text = await pageText(locale)

      expect(text.toLowerCase()).toContain('npm')
      expect(says(text, '1.0')).toBe(true)
    }
  })

  it('says the same measured numbers as the launch post, in both languages', async () => {
    const posts = await Promise.all(
      ['post.en.md', 'post.pt-BR.md'].map(async (file) => ({
        file,
        text: await readFile(`${REPO}docs/launch/${file}`, 'utf8'),
      })),
    )

    for (const { file, text } of posts) {
      for (const number of ['10', '10.8', '500', '200', '12.05', '5']) {
        expect(says(text, number), `${file} does not say ${number}`).toBe(true)
      }
    }
  })

  it('would notice a number that is only in the English page', async () => {
    expect(says('the limit is 10 ms', '10')).toBe(true)
    expect(says('o limite é 10,8 ms', '10.8')).toBe(true)
    expect(says('answered 400 and moved on', '40')).toBe(false)
    expect(says('12,05 kB', '5')).toBe(false)
    expect(says('the target was 5 kB', '5')).toBe(true)
  })
})
