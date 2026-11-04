import type { SqlRunner } from '@nekolog-io/adapters'

export type ParameterisedQuery = {
  query(text: string, params?: unknown[]): Promise<unknown>
}

export function httpSqlRunner(sql: ParameterisedQuery): SqlRunner {
  return async (text, params) => {
    const rows = await sql.query(text, [...params])
    if (!Array.isArray(rows)) {
      throw new Error('The SQL driver answered with something that is not a list of rows.')
    }
    return rows as ReadonlyArray<Record<string, unknown>>
  }
}
