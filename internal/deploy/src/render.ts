import { environmentConfig, isJsonObject, type JsonObject, type JsonValue } from './config.ts'

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export type Lookup = (name: string) => string | undefined

export type RenderOptions = {
  environment: string
  lookup: Lookup
}

export function placeholdersIn(value: JsonValue): string[] {
  const found = new Set<string>()
  const visit = (node: JsonValue): void => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(PLACEHOLDER)) {
        found.add(match[1] ?? '')
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
      return
    }
    if (isJsonObject(node)) {
      for (const item of Object.values(node)) {
        visit(item)
      }
    }
  }
  visit(value)
  return [...found].sort()
}

function fill(value: JsonValue, values: Readonly<Record<string, string>>): JsonValue {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole)
  }
  if (Array.isArray(value)) {
    return value.map((item) => fill(item, values))
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fill(item, values)]),
    ) as JsonObject
  }
  return value
}

export function renderForEnvironment(config: JsonObject, options: RenderOptions): JsonObject {
  const chosen = environmentConfig(config, options.environment)
  const narrowed: JsonObject = { ...config, env: { [options.environment]: chosen } }

  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const name of placeholdersIn(narrowed)) {
    const value = options.lookup(name)
    if (value === undefined || value.trim() === '') {
      missing.push(name)
      continue
    }
    values[name] = value
  }
  if (missing.length > 0) {
    throw new Error(
      `The ${options.environment} environment is missing values for: ${missing.join(', ')}.`,
    )
  }

  const filled = fill(narrowed, values) as JsonObject
  const left = placeholdersIn(filled)
  if (left.length > 0) {
    throw new Error(`A supplied value carries a placeholder of its own: ${left.join(', ')}.`)
  }
  return filled
}
