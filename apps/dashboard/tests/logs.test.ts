import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

const SEARCH = read('app/api/orgs/[org]/projects/[project]/logs/route.ts')
const CONTEXT = read('app/api/orgs/[org]/projects/[project]/logs/context/route.ts')
const VOLUME = read('app/api/orgs/[org]/projects/[project]/logs/histogram/route.ts')
const LOGS = read('lib/logs.ts')

const ROUTES = [
  { name: 'logs', source: SEARCH },
  { name: 'logs/context', source: CONTEXT },
  { name: 'logs/histogram', source: VOLUME },
]

function filesUnder(directory: string, ending: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, directory))) {
    const path = join(directory, entry)
    if (statSync(join(ROOT, path)).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next') {
        found.push(...filesUnder(path, ending))
      }
    } else if (entry.endsWith(ending)) {
      found.push(path)
    }
  }
  return found
}

describe('the environments a log query is allowed to touch', () => {
  it.each(ROUTES)('$name takes them from the database, not from the request', ({ source }) => {
    expect(source).toContain('listEnvironments(loginDeps().run, org, project)')
  })

  it.each([
    { name: 'logs', source: SEARCH },
    { name: 'logs/histogram', source: VOLUME },
  ])(
    '$name narrows the server list by the asked id, never querying the id itself',
    ({ source }) => {
      expect(source).toContain('environments.filter((one) => one.id === wanted)')
      expect(source).toContain('environmentIds: scoped.map((one) => one.id)')
      expect(source, 'an id straight off the request skips the project scoping').not.toMatch(
        /environmentIds: \[[^\]]*asked\.get/,
      )
    },
  )

  it('never lets the browser choose how wide a bucket is', () => {
    expect(VOLUME, 'a one-second bucket over a month is a denial of service').not.toMatch(
      /asked\.get\('bucket'\)/,
    )
    expect(VOLUME).toContain('bucketFor(from.getTime(), to.getTime())')
  })

  it('looks the context environment up in that list rather than trusting it', () => {
    expect(CONTEXT).toContain("environments.find((one) => one.id === (asked.get('env') ?? ''))")
    expect(CONTEXT).toContain('environmentId: environment.id')
  })

  it('answers 404 for an environment this project does not have', () => {
    for (const { source } of ROUTES) {
      expect(source).toContain("refusal('no_such_environment', 404)")
    }
  })

  it('names the project from the path on every query it builds', () => {
    expect(SEARCH).toContain('projectId: project')
    expect(CONTEXT).toContain('projectId: project')
  })
})

describe('a parameter this build does not know', () => {
  it.each(ROUTES)('$name refuses it instead of ignoring it', ({ source }) => {
    expect(source).toMatch(/for \(const name of asked\.keys\(\)\)[\s\S]{0,200}unknown_parameter/)
  })

  it('lists exactly the parameters each route reads, in both directions', () => {
    const declared = (source: string, name: string): string[] =>
      [
        ...(
          new RegExp(`${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`).exec(source)?.[1] ?? ''
        ).matchAll(/'([a-z]+)'/g),
      ]
        .map((match) => match[1] as string)
        .sort()

    const readBy = (source: string): string[] =>
      [...source.matchAll(/asked\.get\('([a-z]+)'\)/g)].map((match) => match[1] as string)

    for (const [source, name] of [
      [SEARCH, 'LOG_PARAMETERS'],
      [CONTEXT, 'CONTEXT_PARAMETERS'],
      [VOLUME, 'HISTOGRAM_PARAMETERS'],
    ] as const) {
      const allowed = declared(source, name)
      const used = [...new Set(readBy(source))].sort()

      expect(allowed.length).toBeGreaterThan(0)
      expect(
        used.filter((one) => !allowed.includes(one)),
        'read but not allowed',
      ).toEqual([])
      expect(
        allowed.filter((one) => !used.includes(one)),
        'allowed but never read',
      ).toEqual([])
    }
  })
})

describe('the period a query runs over', () => {
  it('refuses a period that is not a period at all', () => {
    expect(SEARCH).toMatch(/Number\.isNaN\(from\.getTime\(\)\)[\s\S]{0,120}bad_period/)
  })

  it('refuses a period that ends before it starts', () => {
    expect(SEARCH).toContain('to.getTime() <= from.getTime()')
  })

  it('refuses a span wider than the longest retention anyone can buy', () => {
    expect(SEARCH).toContain('MAX_SPAN_MS')
    expect(SEARCH).toMatch(/MAX_SPAN_MS: number = 31 \* 24 \* 60 \* 60 \* 1000/)
  })

  it('refuses a page bigger than the one the query builder allows', () => {
    expect(SEARCH).toMatch(/limit > MAX_ROWS[\s\S]{0,80}bad_limit/)
  })
})

describe('what reaches ClickHouse', () => {
  it('goes through the query builders, which bind every value', () => {
    expect(LOGS).toContain('logSearchQuery(')
    expect(LOGS).toContain('logContextQuery(')
    expect(LOGS).toContain('logHistogramQuery(')
    expect(LOGS).toMatch(
      /queryRows<LogRow>\(config, compiled\.sql, \{ params: compiled\.params \}\)/,
    )
  })

  it('never puts anything from the caller into the text of a statement', () => {
    expect(LOGS, 'a template literal in the SQL is where injection lives').not.toMatch(
      /sql[^\n]*`[^`]*\$\{/,
    )
  })

  it('reads with the credential that may only read', () => {
    expect(LOGS).toContain("required('CLICKHOUSE_READ_USER')")
    expect(LOGS).not.toContain('CLICKHOUSE_JOBS_USER')
    expect(LOGS).not.toContain('CLICKHOUSE_MIGRATOR_USER')
  })

  it('resolves env: in a search against this project, so it can only narrow', () => {
    expect(SEARCH).toContain('named[one.name] = one.id')
    expect(SEARCH).toContain('environments: named')
  })
})

describe('what a failed query tells the browser', () => {
  it('answers a fixed sentence, because the exception can quote a bound value', () => {
    expect(SEARCH).toMatch(/catch \(error\)[\s\S]{0,400}refusal\('logs_unavailable', 503\)/)
    expect(CONTEXT).toMatch(/catch \(error\)[\s\S]{0,300}refusal\('logs_unavailable', 503\)/)
  })

  it('never hands any other exception back, and the search parser is the only one', () => {
    for (const { source } of ROUTES) {
      const outsideTheParser = source.replace(
        /if \(error instanceof SearchError\) \{[\s\S]*?\n {4}\}/,
        '',
      )

      expect(
        outsideTheParser,
        'a ClickHouse message can quote a column or a bound value',
      ).not.toMatch(/\.message|String\(error\)|JSON\.stringify\(error|detail:/)
    }
  })

  it('does say what the search parser could not read, which is the caller own text', () => {
    expect(SEARCH).toContain('error instanceof SearchError')
    expect(SEARCH).toContain("error: 'bad_search', detail: error.message")
  })
})

describe('a log line is untrusted input, wherever it is drawn', () => {
  const COMPONENTS = [...filesUnder('components', '.tsx'), ...filesUnder('app', '.tsx')]

  it('found the components, so none of this is passing on an empty list', () => {
    expect(COMPONENTS.length).toBeGreaterThan(15)
  })

  it.each(COMPONENTS)('%s never renders anything as markup', (path) => {
    expect(read(path)).not.toContain('dangerouslySetInnerHTML')
  })
})
