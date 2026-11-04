import {
  type CompareOperator,
  parseSearch,
  SearchError,
  type SearchNode,
  type SearchValue,
} from './parse.ts'

export const SEARCH_COLUMNS: Readonly<Record<string, string>> = {
  level: 'level',
  service: 'service',
  release: 'release',
  source: 'source',
  trace: 'trace_id',
  span: 'span_id',
  session: 'session_id',
  user: 'user_id',
}

export const ENVIRONMENT_FIELD = 'env'
export const ISSUE_FIELD = 'issue'

export const SEARCH_FIELDS: readonly string[] = [
  ...Object.keys(SEARCH_COLUMNS),
  ENVIRONMENT_FIELD,
  ISSUE_FIELD,
].sort()

export const ATTRIBUTE_KEY_PATTERN: RegExp = /^[A-Za-z0-9_.-]{1,128}$/
const SINGLE_TOKEN = /^[A-Za-z0-9_]+$/
const UNSIGNED_INTEGER = /^\d{1,20}$/

export type CompileOptions = {
  environments?: Readonly<Record<string, string>>
}

export type CompiledSearch = {
  sql: string
  params: Record<string, string>
}

const NEVER = '0'
const ALWAYS = '1'

class Builder {
  readonly params: Record<string, string> = {}
  private count = 0

  bind(value: string, type: string): string {
    this.count += 1
    const name = `p${this.count}`
    this.params[name] = value
    return `{${name}:${type}}`
  }
}

function environmentIdsFor(
  value: SearchValue,
  environments: Readonly<Record<string, string>>,
): string[] {
  if (!value.prefix) {
    const found = environments[value.text]
    return found === undefined ? [] : [found]
  }
  return Object.entries(environments)
    .filter(([name]) => name.startsWith(value.text))
    .map(([, id]) => id)
}

function compileEnvironment(
  values: readonly SearchValue[],
  at: number,
  builder: Builder,
  options: CompileOptions,
): string {
  const environments = options.environments
  if (environments === undefined) {
    throw new SearchError(
      'This search uses env:, but the caller did not say which environments exist.',
      at,
    )
  }

  const ids = [...new Set(values.flatMap((value) => environmentIdsFor(value, environments)))]
  if (ids.length === 0) {
    return NEVER
  }
  return `environment_id IN (${ids.map((id) => builder.bind(id, 'String')).join(', ')})`
}

function compileIssue(values: readonly SearchValue[], builder: Builder): string {
  const numbers = values.map((value) => {
    if (value.prefix) {
      throw new SearchError('An issue is matched whole, so a * does not work here.', value.at)
    }
    if (!UNSIGNED_INTEGER.test(value.text)) {
      throw new SearchError('An issue id is a number.', value.at)
    }
    return value.text
  })

  return `fingerprint IN (${numbers.map((number) => builder.bind(number, 'UInt64')).join(', ')})`
}

function compileColumn(column: string, values: readonly SearchValue[], builder: Builder): string {
  if (values.every((value) => !value.prefix)) {
    const bound = values.map((value) => builder.bind(value.text, 'String'))
    return bound.length === 1 ? `${column} = ${bound[0]}` : `${column} IN (${bound.join(', ')})`
  }

  const parts = values.map((value) =>
    value.prefix
      ? `startsWith(${column}, ${builder.bind(value.text, 'String')})`
      : `${column} = ${builder.bind(value.text, 'String')}`,
  )
  return parts.length === 1 ? (parts[0] as string) : `(${parts.join(' OR ')})`
}

function attributeExpression(key: string, at: number, builder: Builder): string {
  if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new SearchError(
      'An attribute name may hold only letters, digits, dot, dash and underscore.',
      at,
    )
  }
  return `attributes[${builder.bind(key, 'String')}]`
}

function compileTerm(text: string, phrase: boolean, builder: Builder): string {
  if (!phrase && SINGLE_TOKEN.test(text)) {
    return `hasToken(lower(message), ${builder.bind(text.toLowerCase(), 'String')})`
  }
  return `positionCaseInsensitive(message, ${builder.bind(text, 'String')}) > 0`
}

function compareSql(expression: string, operator: CompareOperator, bound: string): string {
  return `${expression} ${operator} ${bound}`
}

function compileNode(node: SearchNode, builder: Builder, options: CompileOptions): string {
  switch (node.kind) {
    case 'all':
      return ALWAYS

    case 'and':
    case 'or': {
      const joiner = node.kind === 'and' ? ' AND ' : ' OR '
      return `(${node.children.map((child) => compileNode(child, builder, options)).join(joiner)})`
    }

    case 'not':
      return `NOT (${compileNode(node.child, builder, options)})`

    case 'term':
      return compileTerm(node.text, node.phrase, builder)

    case 'compare': {
      if (!node.attribute) {
        throw new SearchError(
          'Only an attribute can be compared with a number, as in @status>=500.',
          node.at,
        )
      }
      const expression = attributeExpression(node.field, node.at, builder)
      return compareSql(
        `toFloat64OrNull(${expression})`,
        node.operator,
        builder.bind(String(node.value), 'Float64'),
      )
    }

    case 'field': {
      if (node.attribute) {
        const expression = attributeExpression(node.field, node.at, builder)
        return compileColumn(expression, node.values, builder)
      }

      if (node.field === ENVIRONMENT_FIELD) {
        return compileEnvironment(node.values, node.at, builder, options)
      }

      if (node.field === ISSUE_FIELD) {
        return compileIssue(node.values, builder)
      }

      const column = SEARCH_COLUMNS[node.field]
      if (column === undefined) {
        throw new SearchError(
          `There is no field called ${node.field}. The fields are ${SEARCH_FIELDS.join(', ')}, and anything else goes after an @.`,
          node.at,
        )
      }
      return compileColumn(column, node.values, builder)
    }
  }
}

export function compileSearch(
  search: string | SearchNode,
  options: CompileOptions = {},
): CompiledSearch {
  const node = typeof search === 'string' ? parseSearch(search) : search
  const builder = new Builder()
  const sql = compileNode(node, builder, options)
  return { sql, params: builder.params }
}
