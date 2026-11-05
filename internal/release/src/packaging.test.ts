import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isJsonObject, type JsonObject, readJsonObject } from './json.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SHARED = ['adapters', 'clickhouse', 'config', 'db']

const TYPES_FROM_SOURCE = ['db']

function manifestOf(folder: string): JsonObject {
  return readJsonObject(join(ROOT, 'packages', folder, 'package.json'))
}

function published(): Array<[string, JsonObject]> {
  return readdirSync(join(ROOT, 'packages'))
    .map((folder): [string, JsonObject] => [folder, manifestOf(folder)])
    .filter(([, manifest]) => manifest.private !== true)
}

function dependenciesOf(manifest: JsonObject): string[] {
  const declared = manifest.dependencies
  return isJsonObject(declared) ? Object.keys(declared) : []
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(exportTargets)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(exportTargets)
  }
  return []
}

describe('every package this repository publishes', () => {
  it.each(published())('%s carries what npm needs', (folder, manifest) => {
    expect(manifest.license).toBe('SEE LICENSE IN LICENSE')
    expect(manifest.files).toBeDefined()
    expect((manifest.repository as JsonObject).directory).toBe(`packages/${folder}`)
  })

  it.each(published())('%s depends on nothing private', (_folder, manifest) => {
    for (const dependency of dependenciesOf(manifest)) {
      expect(dependency.startsWith('@internal/')).toBe(false)
      expect(dependency.startsWith('@apps/')).toBe(false)
    }
  })

  it.each(published())('%s ships every file its exports point at', (folder, manifest) => {
    const shipped = (manifest.files as string[]).map((entry) => entry.replace(/^\.\//, ''))
    const targets = exportTargets(manifest.publishConfig ?? manifest.exports)

    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      const path = target.replace(/^\.\//, '')
      const covered = shipped.some((entry) => path === entry || path.startsWith(`${entry}/`))
      expect(covered, `${folder} publishes ${target} but ships only ${shipped.join(', ')}`).toBe(
        true,
      )
    }
  })
})

describe('the packages the dashboard consumes', () => {
  it.each(SHARED)('%s resolves to its source inside this workspace', (folder) => {
    for (const target of exportTargets(manifestOf(folder).exports)) {
      expect(target.startsWith('./src/')).toBe(true)
      expect(target.endsWith('.ts')).toBe(true)
    }
  })

  it.each(SHARED)('%s runs from its build once published', (folder) => {
    const config = manifestOf(folder).publishConfig

    expect(isJsonObject(config)).toBe(true)
    const entries = (config as JsonObject).exports as JsonObject
    const runtime = Object.values(entries).map((entry) =>
      typeof entry === 'string' ? entry : ((entry as JsonObject).default as string),
    )

    expect(runtime.length).toBeGreaterThan(0)
    for (const target of runtime) {
      expect(target.startsWith('./dist/')).toBe(true)
    }
  })

  it.each(SHARED.filter((folder) => !TYPES_FROM_SOURCE.includes(folder)))(
    '%s publishes generated declarations',
    (folder) => {
      const entries = (manifestOf(folder).publishConfig as JsonObject).exports as JsonObject

      for (const entry of Object.values(entries)) {
        expect((entry as JsonObject).types).toMatch(/^\.\/dist\/.+\.d\.mts$/)
      }
    },
  )

  it.each(TYPES_FROM_SOURCE)('%s publishes its source as the types, and says why', (folder) => {
    const entries = (manifestOf(folder).publishConfig as JsonObject).exports as JsonObject
    const source = join(ROOT, 'packages', folder, 'src', 'index.ts')

    for (const entry of Object.values(entries)) {
      expect((entry as JsonObject).types).toBe('./src/index.ts')
    }
    expect(readFileSync(join(ROOT, 'packages', folder, 'README.md'), 'utf8')).toContain(
      'isolatedDeclarations',
    )
    expect(
      readFileSync(source, 'utf8'),
      'the published source cannot import a sibling: the consumer compiles it with its own settings',
    ).not.toMatch(/from '\.\.?\//)
  })

  it.each(SHARED)('%s is checked against the tarball, not the directory', (folder) => {
    const scripts = manifestOf(folder).scripts as JsonObject

    expect(scripts.lint).toContain('pnpm pack')
    expect(scripts.lint).toContain('publint package.tgz')
    expect(scripts.lint).toContain('attw package.tgz')
  })
})

describe('the ClickHouse package, which carries more than code', () => {
  const manifest = manifestOf('clickhouse')

  it('ships the migrations the runner reads at runtime', () => {
    expect(manifest.files).toContain('migrations')

    const sql = readdirSync(join(ROOT, 'packages', 'clickhouse', 'migrations'))
    expect(sql.length).toBeGreaterThan(0)
    expect(sql.every((file) => file.endsWith('.sql'))).toBe(true)
  })

  it('exposes the runner as a command, with the shebang that makes it one', () => {
    const bin = (manifest.publishConfig as JsonObject).bin as JsonObject
    const entry = Object.values(bin)[0]

    expect(entry).toBe('./dist/cli.mjs')
    expect(readFileSync(join(ROOT, 'packages', 'clickhouse', 'src', 'cli.ts'), 'utf8')).toMatch(
      /^#!\/usr\/bin\/env node\n/,
    )
  })

  it('keeps the entry points a Worker needs away from the one that reads the disk', () => {
    const targets = Object.keys(manifest.exports as JsonObject)

    expect(targets).toContain('./log-store')
    expect(targets).toContain('./client')
    expect(targets).toContain('./usage-store')
  })
})
