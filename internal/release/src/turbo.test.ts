import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKSPACES = ['apps', 'internal', 'packages', 'examples']
const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo', '.astro', 'coverage'])
const JOINED = /dirname\(fileURLToPath\(import\.meta\.url\)\)((?:,\s*'\.\.')+)/g
const RESOLVED = /new URL\(\s*['"]([^'"]*)['"]\s*,\s*import\.meta\.url\s*\)/g

type Package = { name: string; directory: string }

function packagesWithTests(): Package[] {
  const found: Package[] = []
  for (const workspace of WORKSPACES) {
    const base = join(ROOT, workspace)
    if (!existsSync(base)) {
      continue
    }
    for (const entry of readdirSync(base)) {
      const directory = join(base, entry)
      const manifest = join(directory, 'package.json')
      if (!statSync(directory).isDirectory() || !existsSync(manifest)) {
        continue
      }
      const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name: string
        scripts?: Record<string, string>
      }
      if (json.scripts?.test !== undefined) {
        found.push({ name: json.name, directory })
      }
    }
  }
  return found
}

function testFilesIn(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) {
      continue
    }
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...testFilesIn(path))
    } else if (entry.endsWith('.test.ts')) {
      found.push(path)
    }
  }
  return found
}

function typescriptIn(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) {
      continue
    }
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...typescriptIn(path))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      found.push(path)
    }
  }
  return found
}

function stepsUp(text: string): number {
  let furthest = 0
  for (const match of text.matchAll(JOINED)) {
    furthest = Math.max(furthest, (match[1]?.match(/'\.\.'/g) ?? []).length)
  }
  for (const match of text.matchAll(RESOLVED)) {
    furthest = Math.max(furthest, (match[1]?.match(/^(?:\.\.\/)+/)?.[0]?.length ?? 0) / 3)
  }
  return furthest
}

function leavesItsPackage(directory: string, file: string): boolean {
  const depth = relative(directory, dirname(file)).split(sep).filter(Boolean).length
  return stepsUp(readFileSync(file, 'utf8')) > depth
}

function readsOutside(pkg: Package): string[] {
  return testFilesIn(pkg.directory)
    .filter((file) => leavesItsPackage(pkg.directory, file))
    .map((file) => relative(ROOT, file))
}

function runsUncached(pkg: Package): boolean {
  const config = join(pkg.directory, 'turbo.json')
  if (!existsSync(config)) {
    return false
  }
  const json = JSON.parse(readFileSync(config, 'utf8')) as {
    extends?: string[]
    tasks?: { test?: { cache?: boolean } }
  }
  return json.extends?.includes('//') === true && json.tasks?.test?.cache === false
}

const PACKAGES = packagesWithTests()
const CROSSING = PACKAGES.filter((pkg) => readsOutside(pkg).length > 0)

describe('a test that holds a port while another package runs', () => {
  const PORT = /^const PORT = (\d+)$/gm

  function portsClaimed(): Array<{ file: string; port: number }> {
    return PACKAGES.flatMap((pkg) =>
      testFilesIn(pkg.directory).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(PORT)].map((match) => ({
          file: relative(ROOT, file),
          port: Number(match[1]),
        })),
      ),
    )
  }

  it('found enough of them for this check to mean anything', () => {
    expect(portsClaimed().length).toBeGreaterThanOrEqual(3)
  })

  it('claims a port no other test claims, because Turbo runs them at once', () => {
    const byPort = new Map<number, string[]>()

    for (const { file, port } of portsClaimed()) {
      byPort.set(port, [...(byPort.get(port) ?? []), file])
    }

    const shared = [...byPort.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([port, files]) => `${port}: ${files.join(' and ')}`)

    expect(shared, 'two tests binding one port do not fail, they answer for each other').toEqual([])
  })
})

describe('a test that reads outside its own package', () => {
  it('was found in enough packages for this check to mean anything', () => {
    expect(PACKAGES.length).toBeGreaterThan(20)
    expect(CROSSING.length).toBeGreaterThanOrEqual(10)
  })

  it('runs uncached, because Turbo cannot see what it reads', () => {
    const cached = CROSSING.filter((pkg) => !runsUncached(pkg)).map(
      (pkg) => `${pkg.name} reads ${readsOutside(pkg).join(', ')}`,
    )

    expect(cached).toEqual([])
  })

  it('is the only reason a package turns its cache off', () => {
    const idle = PACKAGES.filter((pkg) => runsUncached(pkg) && readsOutside(pkg).length === 0).map(
      (pkg) => pkg.name,
    )

    expect(idle).toEqual([])
  })
})

const TEST_VARIABLE = /process\.env\.([A-Z][A-Z0-9_]*_TEST(?:_[A-Z0-9_]+)?)\b/g

function declaredEnv(): string[] {
  const json = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8')) as {
    tasks?: { test?: { env?: string[] } }
  }
  return json.tasks?.test?.env ?? []
}

function variablesTestsRead(): Map<string, string> {
  const found = new Map<string, string>()
  for (const pkg of PACKAGES) {
    for (const file of typescriptIn(pkg.directory)) {
      for (const match of readFileSync(file, 'utf8').matchAll(TEST_VARIABLE)) {
        found.set(match[1] as string, relative(ROOT, file))
      }
    }
  }
  return found
}

describe('an environment variable that decides whether an integration test runs', () => {
  const read = variablesTestsRead()

  it('was found in enough places for this check to mean anything', () => {
    expect(read.size).toBeGreaterThan(8)
  })

  it('is found in a helper beside the tests too, which is where one of them hid', () => {
    expect(read.get('DASHBOARD_HEADERS_TEST_REQUIRED')).toContain('server.ts')
  })

  it('is declared in the root turbo.json, or Turbo strips it and the test skips in silence', () => {
    const declared = new Set(declaredEnv())
    const stripped = [...read]
      .filter(([name]) => !declared.has(name))
      .map(([name, file]) => `${name}, read by ${file}`)

    expect(stripped).toEqual([])
  })
})

describe('the detector itself', () => {
  const inside = "const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')"
  const outside = "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')"

  it('counts how far up a file reaches, in either idiom', () => {
    expect(stepsUp(inside)).toBe(1)
    expect(stepsUp(outside)).toBe(3)
    expect(stepsUp("new URL('../messages/', import.meta.url)")).toBe(1)
    expect(stepsUp("new URL('../../../docs/PLANO.md', import.meta.url)")).toBe(3)
    expect(stepsUp('const ROOT = process.cwd()')).toBe(0)
  })

  it('reports the furthest reach in a file that has several', () => {
    const both = [
      "const DOCS = fileURLToPath(new URL('../src/content/docs/', import.meta.url))",
      "const TYPES = fileURLToPath(new URL('../../../packages/core/src/types.ts', import.meta.url))",
    ].join('\n')

    expect(stepsUp(both)).toBe(3)
  })

  it('separates staying in the package from leaving it', () => {
    const directory = join(ROOT, 'internal', 'release')
    const file = join(directory, 'src', 'anything.test.ts')
    const depth = relative(directory, dirname(file)).split(sep).filter(Boolean).length

    expect(stepsUp(inside) > depth).toBe(false)
    expect(stepsUp(outside) > depth).toBe(true)
  })
})
