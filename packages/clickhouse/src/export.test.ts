import { describe, expect, it } from 'vitest'
import {
  compileExport,
  EXPORT_FORMATS,
  EXPORT_KEY_PREFIX,
  EXPORT_PLAIN_COLUMNS,
  EXPORT_TEXT_COLUMNS,
  type ExportRequest,
  exportObjectKey,
  exportSelectList,
  FORMULA_LEAD_CHARACTERS,
  guardedColumn,
  REDACTED,
  sqlText,
  withoutTrailingSlashes,
} from './export.ts'
import { LOG_COLUMNS } from './search/context.ts'
import { SCOPE_PREFIX } from './search/scope.ts'

const EXPORT_ID = 'exp_01JBQ8R4T7V2WXYZ0123456789'
const SECRET = 'b0e7a4c21d8f5639ae0c47b2f81d3a69'
const ACCESS_KEY = 'GK31c2f218a2e44f485b94239e'

const REQUEST: ExportRequest = {
  exportId: EXPORT_ID,
  format: 'csv',
  scope: {
    projectId: 'prj_1',
    environmentIds: ['env_prod'],
    from: new Date('2026-10-01T00:00:00.000Z'),
    to: new Date('2026-10-02T00:00:00.000Z'),
  },
  destination: {
    endpoint: 'https://account.r2.cloudflarestorage.com/nekolog-exports',
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET,
  },
  target: { database: 'nekolog_dev' },
}

function build(overrides: Partial<ExportRequest> = {}) {
  return compileExport({ ...REQUEST, ...overrides })
}

describe('the object key', () => {
  it('stays inside the prefix the database insists on', () => {
    for (const format of EXPORT_FORMATS) {
      const key = exportObjectKey(EXPORT_ID, format)

      expect(key.startsWith(EXPORT_KEY_PREFIX)).toBe(true)
      expect(key).toMatch(/^exports\/[A-Za-z0-9._/-]+$/)
      expect(key).not.toContain('..')
    }
  })

  it('names the compression in the suffix, which is how ClickHouse picks it', () => {
    expect(exportObjectKey(EXPORT_ID, 'json')).toBe(`${EXPORT_KEY_PREFIX}${EXPORT_ID}.ndjson.gz`)
    expect(exportObjectKey(EXPORT_ID, 'csv')).toBe(`${EXPORT_KEY_PREFIX}${EXPORT_ID}.csv.gz`)
    expect(exportObjectKey(EXPORT_ID, 'xml')).toBe(`${EXPORT_KEY_PREFIX}${EXPORT_ID}.xml.gz`)
  })

  it('refuses an id that is not one of ours, so nothing walks out of the prefix', () => {
    for (const bad of ['../../etc/passwd', 'exp_short', '', 'iss_01JBQ8R4T7V2WXYZ0123456789']) {
      expect(() => exportObjectKey(bad, 'csv')).toThrow(/Refusing/)
    }
  })
})

describe('the formula guard', () => {
  it('covers exactly the characters a spreadsheet treats as the start of a formula', () => {
    expect([...FORMULA_LEAD_CHARACTERS]).toEqual(['=', '+', '-', '@', '\t', '\r'])
  })

  it('classifies every column of the table, so a new one cannot arrive unguarded', () => {
    expect([...EXPORT_TEXT_COLUMNS, ...EXPORT_PLAIN_COLUMNS].sort()).toEqual(
      [...LOG_COLUMNS].sort(),
    )
    expect(EXPORT_TEXT_COLUMNS.filter((name) => EXPORT_PLAIN_COLUMNS.includes(name))).toEqual([])
  })

  it('guards every text column in CSV', () => {
    const list = exportSelectList('csv')

    for (const column of EXPORT_TEXT_COLUMNS) {
      expect(list).toContain(guardedColumn(column))
    }
  })

  it('leaves the numbers and the map alone, because neither can start a formula', () => {
    const list = exportSelectList('csv')

    for (const column of EXPORT_PLAIN_COLUMNS) {
      expect(list).not.toContain(`concat('''', ${column})`)
      expect(list).toContain(column)
    }
  })

  it('does not guard JSON or XML, where a leading equals sign means nothing', () => {
    for (const format of ['json', 'xml'] as const) {
      expect(exportSelectList(format)).toBe([...LOG_COLUMNS].join(', '))
    }
  })

  it('selects every column of the table in every format', () => {
    for (const format of EXPORT_FORMATS) {
      const list = exportSelectList(format)
      for (const column of LOG_COLUMNS) {
        expect(list).toContain(column)
      }
    }
  })
})

describe('trimming the endpoint', () => {
  it('drops every trailing slash and nothing else', () => {
    expect(withoutTrailingSlashes('https://a/b///')).toBe('https://a/b')
    expect(withoutTrailingSlashes('https://a/b')).toBe('https://a/b')
    expect(withoutTrailingSlashes('///')).toBe('')
    expect(withoutTrailingSlashes('')).toBe('')
  })

  it('stays linear on a pathological endpoint, where a regex would not', () => {
    const hostile = `https://a/${'/'.repeat(200_000)}x`
    const started = performance.now()

    expect(withoutTrailingSlashes(hostile)).toBe(hostile)
    expect(performance.now() - started).toBeLessThan(20)
  })
})

describe('sqlText', () => {
  it('escapes the quote that would otherwise end the literal', () => {
    expect(sqlText("it's")).toBe("'it\\'s'")
  })

  it('escapes the backslash before it can escape anything else', () => {
    expect(sqlText('a\\')).toBe("'a\\\\'")
    expect(sqlText("\\'")).toBe("'\\\\\\''")
  })
})

describe('the statement it compiles', () => {
  it('writes through the s3 function, which keeps the bytes off the worker', () => {
    const { sql } = build()

    expect(sql.startsWith('INSERT INTO FUNCTION s3(')).toBe(true)
    expect(sql).toContain('CSVWithNames')
  })

  it('names the object inside the destination, and nothing else', () => {
    const { sql, url, objectKey } = build()

    expect(url).toBe(`https://account.r2.cloudflarestorage.com/nekolog-exports/${objectKey}`)
    expect(sql).toContain(sqlText(url))
  })

  it('truncates on insert, because a retry must overwrite rather than fail', () => {
    expect(build().sql).toContain('s3_truncate_on_insert = 1')
  })

  it('asks for the rows oldest first, which is the order a log file is read in', () => {
    const { sql, select } = build()

    expect(select).toContain('ORDER BY logs.timestamp')
    expect(sql).toContain('ORDER BY logs.timestamp')
  })

  it('offers the select on its own, which is what the reader can be shown before exporting', () => {
    const { sql, select } = build()

    expect(select.startsWith('SELECT ')).toBe(true)
    expect(select).not.toContain('s3(')
    expect(select).not.toContain(SECRET)
    expect(sql).toContain(select)
  })

  it('scopes by project, environment and period, all as bound parameters', () => {
    const { sql, params } = build()

    expect(sql).toContain(`project_id = {${SCOPE_PREFIX}project:String}`)
    expect(params[`${SCOPE_PREFIX}project`]).toBe('prj_1')
    expect(params[`${SCOPE_PREFIX}env0`]).toBe('env_prod')
    expect(params[`${SCOPE_PREFIX}from`]).toBe('2026-10-01 00:00:00.000')
    expect(params[`${SCOPE_PREFIX}to`]).toBe('2026-10-02 00:00:00.000')
  })

  it('carries the reader filter through as parameters too', () => {
    const { sql, params } = build({ search: 'level:error @orderId:"ord_1"' })

    expect(Object.values(params)).toContain('ord_1')
    expect(sql).not.toContain('ord_1')
  })

  it('refuses a database name that is not an identifier', () => {
    expect(() => build({ target: { database: 'nekolog_dev; DROP TABLE logs' } })).toThrow(
      /Refusing/,
    )
  })

  it('refuses a destination that is not a plain http address', () => {
    for (const endpoint of ['file:///etc', "https://a'--", 'https://a b', 'not a url']) {
      expect(() => build({ destination: { ...REQUEST.destination, endpoint } })).toThrow(/Refusing/)
    }
  })

  it('refuses to run without credentials rather than writing somewhere public', () => {
    expect(() => build({ destination: { ...REQUEST.destination, secretAccessKey: '' } })).toThrow(
      /Refusing/,
    )
    expect(() => build({ destination: { ...REQUEST.destination, accessKeyId: '' } })).toThrow(
      /Refusing/,
    )
  })

  it('refuses a period that ends before it starts', () => {
    expect(() =>
      build({
        scope: {
          ...REQUEST.scope,
          from: new Date('2026-10-02T00:00:00.000Z'),
          to: new Date('2026-10-01T00:00:00.000Z'),
        },
      }),
    ).toThrow(/Refusing/)
  })
})

describe('what may be written down', () => {
  it('offers a form of the statement that carries neither the key nor the secret', () => {
    const { redacted } = build()

    expect(redacted).not.toContain(SECRET)
    expect(redacted).not.toContain(ACCESS_KEY)
    expect(redacted).toContain(REDACTED)
  })

  it('keeps everything else, so the redacted form is still worth reading', () => {
    const { sql, redacted } = build()

    expect(redacted).toContain('CSVWithNames')
    expect(redacted).toContain('nekolog_dev.logs')
    expect(redacted.length).toBeLessThan(sql.length)
  })

  it('still carries the credentials in the statement that actually runs', () => {
    const { sql } = build()

    expect(sql).toContain(SECRET)
    expect(sql).toContain(ACCESS_KEY)
  })
})
