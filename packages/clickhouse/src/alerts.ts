import { type AlertRule, type AlertWindow, windowMinutes } from '@nekolog-io/adapters'
import { assertIdentifier } from './log-store.ts'
import { type CompileOptions, compileSearch } from './search/compile.ts'
import { clickHouseDateTime } from './search/scope.ts'

export const MEASURE_PREFIX = 'm'
export const ERROR_LEVELS: readonly string[] = ['error', 'fatal']
export const MAX_RULES_PER_QUERY = 100

export type AlertScope = {
  projectId: string
  environmentId: string
}

export type AlertTarget = {
  database: string
  table?: string
}

export type Measurement = {
  ruleId: string
  matched: number
  errors: number
}

export type CompiledAlertBatch = {
  sql: string
  params: Record<string, string>
  columns: ReadonlyArray<{ ruleId: string; matched: string; errors: string | null }>
}

export function measurableHere(rule: AlertRule): boolean {
  const { type } = rule.condition
  return type === 'threshold' || type === 'error_rate' || type === 'absence'
}

function windowStart(at: Date, window: AlertWindow): Date {
  return new Date(at.getTime() - windowMinutes(window) * 60_000)
}

export function alertBatchQuery(
  rules: ReadonlyArray<AlertRule>,
  scope: AlertScope,
  at: Date,
  target: AlertTarget,
  options: CompileOptions = {},
): CompiledAlertBatch {
  const measurable = rules.filter(measurableHere)

  if (measurable.length === 0) {
    throw new Error('Refusing to build an alert query with no rule to measure.')
  }
  if (measurable.length > MAX_RULES_PER_QUERY) {
    throw new Error(
      `Refusing to measure ${measurable.length} rules in one query; the limit is ${MAX_RULES_PER_QUERY}.`,
    )
  }
  if (scope.projectId === '' || scope.environmentId === '') {
    throw new Error('Refusing to build an alert query with no environment to scope it to.')
  }
  if (Number.isNaN(at.getTime())) {
    throw new Error('Refusing to build an alert query around a moment that is not a moment.')
  }

  const database = assertIdentifier(target.database, 'database name')
  const table = assertIdentifier(target.table ?? 'logs', 'table name')

  const params: Record<string, string> = {
    [`${MEASURE_PREFIX}_project`]: scope.projectId,
    [`${MEASURE_PREFIX}_environment`]: scope.environmentId,
    [`${MEASURE_PREFIX}_to`]: clickHouseDateTime(at),
  }

  let earliest = at
  const selects: string[] = []
  const columns: Array<{ ruleId: string; matched: string; errors: string | null }> = []

  measurable.forEach((rule, position) => {
    const compiled = compileSearch(rule.condition.query, options)

    for (const [name, value] of Object.entries(compiled.params)) {
      const scopedName = `r${position}_${name}`
      if (scopedName in params) {
        throw new Error(`Two rules in the batch both produced the parameter ${scopedName}.`)
      }
      params[scopedName] = value
    }

    const scoped = compiled.sql.replace(/\{p(\d+):/g, `{r${position}_p$1:`)
    const from = windowStart(at, rule.condition.window)
    if (from.getTime() < earliest.getTime()) {
      earliest = from
    }

    const fromName = `${MEASURE_PREFIX}_from${position}`
    params[fromName] = clickHouseDateTime(from)

    const inWindow = `timestamp >= {${fromName}:DateTime64(3)} AND (${scoped})`
    const matched = `matched${position}`
    selects.push(`countIf(${inWindow}) AS ${matched}`)

    const errors = rule.condition.type === 'error_rate' ? `errors${position}` : null
    if (errors !== null) {
      const levels = ERROR_LEVELS.map((level) => `'${level}'`).join(', ')
      selects.push(`countIf(${inWindow} AND level IN (${levels})) AS ${errors}`)
    }

    columns.push({ ruleId: rule.id, matched, errors })
  })

  params[`${MEASURE_PREFIX}_earliest`] = clickHouseDateTime(earliest)

  const sql =
    `SELECT ${selects.join(', ')} ` +
    `FROM ${database}.${table} ` +
    `WHERE project_id = {${MEASURE_PREFIX}_project:String} ` +
    `AND environment_id = {${MEASURE_PREFIX}_environment:String} ` +
    `AND timestamp >= {${MEASURE_PREFIX}_earliest:DateTime64(3)} ` +
    `AND timestamp < {${MEASURE_PREFIX}_to:DateTime64(3)}`

  return { sql, params, columns }
}

export function measurementsFrom(
  batch: CompiledAlertBatch,
  row: Record<string, unknown> | undefined,
): ReadonlyArray<Measurement> {
  if (row === undefined) {
    throw new Error('ClickHouse answered the alert batch with no row at all.')
  }

  return batch.columns.map((column) => ({
    ruleId: column.ruleId,
    matched: countOf(row[column.matched], column.matched),
    errors: column.errors === null ? 0 : countOf(row[column.errors], column.errors),
  }))
}

function countOf(value: unknown, column: string): number {
  const asNumber = typeof value === 'string' ? Number(value) : value
  if (typeof asNumber !== 'number' || !Number.isFinite(asNumber) || asNumber < 0) {
    throw new Error(`ClickHouse answered ${JSON.stringify(value)} for ${column}, which is no count`)
  }
  return asNumber
}
