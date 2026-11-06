import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isJsonObject, type JsonObject, readJsonObject } from './json.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SHARED = ['adapters', 'clickhouse', 'config', 'db']

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

describe('the server libraries, which this repository never publishes', () => {
  it.each(SHARED)('%s is private, so changeset publish cannot reach it', (folder) => {
    expect(manifestOf(folder).private).toBe(true)
  })

  it.each(SHARED)('%s keeps nothing that pretends it is published', (folder) => {
    const manifest = manifestOf(folder)

    expect(manifest.publishConfig, `${folder} still maps a dist/ for npm`).toBeUndefined()
    expect(manifest.files, `${folder} still lists files to pack`).toBeUndefined()

    const scripts = manifest.scripts as JsonObject
    expect(scripts.lint, `${folder} still packs a tarball to lint`).toBeUndefined()
    expect(scripts.build, `${folder} still builds a dist nothing reads`).toBeUndefined()
  })

  it.each(SHARED)('%s resolves to its source, which is what runs with no build step', (folder) => {
    const targets = exportTargets(manifestOf(folder).exports)

    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target.startsWith('./src/')).toBe(true)
      expect(target.endsWith('.ts')).toBe(true)
    }
  })

  it('is depended on by nothing that goes to npm', () => {
    const names = SHARED.map((folder) => manifestOf(folder).name as string)

    for (const [folder, manifest] of published()) {
      for (const dependency of dependenciesOf(manifest)) {
        expect(
          names,
          `${folder} is published and depends on ${dependency}, which is not`,
        ).not.toContain(dependency)
      }
    }
  })

  it('keeps the adapters free of runtime dependencies, which the SBOM used to prove', () => {
    expect(manifestOf('adapters').dependencies).toBeUndefined()
  })
})

describe('the ClickHouse package, which carries more than code', () => {
  const manifest = manifestOf('clickhouse')

  it('keeps the migrations the runner reads at runtime', () => {
    const sql = readdirSync(join(ROOT, 'packages', 'clickhouse', 'migrations'))

    expect(sql.length).toBeGreaterThan(0)
    expect(sql.every((file) => file.endsWith('.sql'))).toBe(true)
  })

  it('runs the runner from source, with the shebang that makes it a command', () => {
    expect((manifest.scripts as JsonObject).ch).toBe('node src/cli.ts')
    expect(readFileSync(join(ROOT, 'packages', 'clickhouse', 'src', 'cli.ts'), 'utf8')).toMatch(
      /^#!\/usr\/bin\/env node\n/,
    )
  })

  it('keeps the entry point that reads the disk apart from the ones that do not', () => {
    const targets = Object.keys(manifest.exports as JsonObject)

    expect(targets).toContain('./log-store')
    expect(targets).toContain('./client')
    expect(targets).toContain('./usage-store')
  })
})
