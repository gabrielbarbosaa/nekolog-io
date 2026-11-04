import { type CompiledSearch, type CompileOptions, compileSearch } from './compile.ts'
import type { SearchNode } from './parse.ts'

export const SCOPE_PREFIX = 's_'

export type SearchScope = {
  projectId: string
  environmentIds: readonly string[]
  from: Date
  to: Date
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

export function clickHouseDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Refusing to build a query around a date that is not a date.')
  }
  return (
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)} ` +
    `${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)}:${pad(value.getUTCSeconds(), 2)}.` +
    `${pad(value.getUTCMilliseconds(), 3)}`
  )
}

export function searchWhere(
  search: string | SearchNode,
  scope: SearchScope,
  options: CompileOptions = {},
): CompiledSearch {
  if (scope.projectId === '') {
    throw new Error('Refusing to build a query with no project to scope it to.')
  }
  if (scope.environmentIds.length === 0) {
    throw new Error('Refusing to build a query with no environment to scope it to.')
  }
  if (scope.to.getTime() <= scope.from.getTime()) {
    throw new Error('Refusing to build a query whose period ends before it starts.')
  }

  const user = compileSearch(search, options)

  const params: Record<string, string> = { ...user.params }
  for (const name of Object.keys(params)) {
    if (name.startsWith(SCOPE_PREFIX)) {
      throw new Error(`The search produced a parameter named ${name}, which the scope reserves.`)
    }
  }

  params[`${SCOPE_PREFIX}project`] = scope.projectId
  params[`${SCOPE_PREFIX}from`] = clickHouseDateTime(scope.from)
  params[`${SCOPE_PREFIX}to`] = clickHouseDateTime(scope.to)

  const environments = scope.environmentIds.map((id, at) => {
    const name = `${SCOPE_PREFIX}env${at}`
    params[name] = id
    return `{${name}:String}`
  })

  const sql = [
    `project_id = {${SCOPE_PREFIX}project:String}`,
    `environment_id IN (${environments.join(', ')})`,
    `timestamp >= {${SCOPE_PREFIX}from:DateTime64(3)}`,
    `timestamp < {${SCOPE_PREFIX}to:DateTime64(3)}`,
    `(${user.sql})`,
  ].join(' AND ')

  return { sql, params }
}
