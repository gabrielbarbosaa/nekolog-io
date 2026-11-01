import { isJsonObject, type JsonObject, type JsonValue, readJsonObject } from './config.ts'
import type { Lookup } from './render.ts'

const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/
const SECRET_LOOKING = /PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL/
const NEKOLOG_KEY = /nekolog_(pk|sk)_/

export type SecretManifest = Readonly<Record<string, readonly string[]>>

export function parseSecretManifest(document: JsonObject, origin: string): SecretManifest {
  const manifest: Record<string, readonly string[]> = {}
  for (const [app, names] of Object.entries(document)) {
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error(`${origin} has to list at least one secret for "${app}".`)
    }
    const listed = names.map((name) => {
      if (typeof name !== 'string' || !SECRET_NAME.test(name)) {
        throw new Error(
          `${origin} lists ${JSON.stringify(name)} for "${app}", which is not a name.`,
        )
      }
      return name
    })
    if (new Set(listed).size !== listed.length) {
      throw new Error(`${origin} lists the same secret twice for "${app}".`)
    }
    manifest[app] = listed
  }
  return manifest
}

export function readSecretManifest(path: string): SecretManifest {
  return parseSecretManifest(readJsonObject(path), path)
}

export function secretNamesFor(manifest: SecretManifest, app: string): readonly string[] {
  const names = manifest[app]
  if (names === undefined) {
    throw new Error(
      `No app called "${app}" needs secrets. The manifest covers: ${Object.keys(manifest).join(', ')}.`,
    )
  }
  return names
}

export function secretValues(names: readonly string[], lookup: Lookup): Record<string, string> {
  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const name of names) {
    const value = lookup(name)
    if (value === undefined || value.trim() === '') {
      missing.push(name)
      continue
    }
    values[name] = value
  }
  if (missing.length > 0) {
    throw new Error(`These secrets are not set: ${missing.join(', ')}.`)
  }
  return values
}

export function varsIn(config: JsonObject): Array<[string, JsonValue]> {
  const entries: Array<[string, JsonValue]> = []
  const visit = (node: JsonValue): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
      return
    }
    if (!isJsonObject(node)) {
      return
    }
    for (const [key, item] of Object.entries(node)) {
      if (key === 'vars' && isJsonObject(item)) {
        entries.push(...Object.entries(item))
        continue
      }
      visit(item)
    }
  }
  visit(config)
  return entries
}

export function assertNoSecretVars(config: JsonObject, secretNames: readonly string[]): void {
  const forbidden = new Set(secretNames)
  for (const [name, value] of varsIn(config)) {
    if (forbidden.has(name)) {
      throw new Error(`${name} is a secret, so it cannot be a plain var in the configuration.`)
    }
    if (SECRET_LOOKING.test(name)) {
      throw new Error(`${name} reads like a secret, so it cannot be a plain var.`)
    }
    if (typeof value === 'string' && NEKOLOG_KEY.test(value)) {
      throw new Error(`${name} holds what looks like a NekoLog API key.`)
    }
  }
}
