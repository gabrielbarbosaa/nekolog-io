import { readFileSync } from 'node:fs'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJsonObject(source: string, origin: string): JsonObject {
  let parsed: JsonValue
  try {
    parsed = JSON.parse(source) as JsonValue
  } catch (cause) {
    throw new Error(`${origin} is not valid JSON: ${(cause as Error).message}`)
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${origin} has to hold a JSON object.`)
  }
  return parsed
}

export function readJsonObject(path: string): JsonObject {
  return parseJsonObject(readFileSync(path, 'utf8'), path)
}

export function environmentNames(config: JsonObject): string[] {
  const environments = config.env
  if (!isJsonObject(environments)) {
    throw new Error('This wrangler configuration declares no environments.')
  }
  return Object.keys(environments)
}

export function bindingNames(block: JsonObject): string[] {
  const names: string[] = []
  for (const value of Object.values(block)) {
    if (!Array.isArray(value)) {
      continue
    }
    for (const item of value) {
      if (isJsonObject(item) && typeof item.binding === 'string') {
        names.push(item.binding)
      }
    }
  }
  return names
}

export function environmentConfig(config: JsonObject, environment: string): JsonObject {
  const names = environmentNames(config)
  const environments = config.env as JsonObject
  const chosen = environments[environment]
  if (!isJsonObject(chosen)) {
    throw new Error(
      `There is no environment called "${environment}". This configuration has: ${names.join(', ')}.`,
    )
  }
  return chosen
}
