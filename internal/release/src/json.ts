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
