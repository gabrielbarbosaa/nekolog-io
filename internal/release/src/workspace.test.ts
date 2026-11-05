import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEPENDENCY_FREE,
  matchesFilter,
  publishedFrom,
  SBOM_DIR,
  SbomRefused,
  sbomCommand,
} from './sbom.ts'
import { directoriesFor, workspaceGlobsFrom, workspaceProjects } from './workspace.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SCRIPTS = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

describe('finding the workspace', () => {
  it('reads the globs out of pnpm-workspace.yaml rather than carrying a second list', () => {
    expect(workspaceGlobsFrom(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'))).toEqual([
      'apps/*',
      'packages/*',
      'internal/*',
      'examples/*',
    ])
  })

  it('stops at the end of the packages block instead of eating the rest of the file', () => {
    const globs = workspaceGlobsFrom('packages:\n  - "packages/*"\n\nallowBuilds:\n  - "esbuild"\n')

    expect(globs).toEqual(['packages/*'])
  })

  it('refuses a workspace that lists nothing', () => {
    expect(() => workspaceGlobsFrom('minimumReleaseAge: 4320\n')).toThrow(SbomRefused)
  })

  it('refuses a glob it would have to guess at', () => {
    expect(() => directoriesFor(ROOT, ['packages/**/src'])).toThrow(SbomRefused)
  })

  it('finds every project the repository actually has', () => {
    const names = workspaceProjects(ROOT).map((project) => project.name)

    expect(names).toContain('@nekolog-io/core')
    expect(names).toContain('@apps/ingest')
    expect(names).toContain('@internal/release')
    expect(names).toContain('@examples/express')
  })
})

describe('what the release publishes', () => {
  const published = publishedFrom(workspaceProjects(ROOT))

  it('is seventeen packages, all of them under the one scope', () => {
    expect(published.map((project) => project.name).sort()).toEqual([
      '@nekolog-io/adapters',
      '@nekolog-io/browser',
      '@nekolog-io/bundler-plugin',
      '@nekolog-io/cli',
      '@nekolog-io/clickhouse',
      '@nekolog-io/config',
      '@nekolog-io/core',
      '@nekolog-io/db',
      '@nekolog-io/express',
      '@nekolog-io/fastify',
      '@nekolog-io/hono',
      '@nekolog-io/nestjs',
      '@nekolog-io/next',
      '@nekolog-io/node',
      '@nekolog-io/pino',
      '@nekolog-io/react',
      '@nekolog-io/winston',
    ])
  })

  it('is covered by the filter the SBOM command uses, in both directions', () => {
    const all = workspaceProjects(ROOT)

    expect(published.filter((project) => !matchesFilter(project.name))).toEqual([])
    expect(
      all.filter((project) => matchesFilter(project.name) && project.private === true),
    ).toEqual([])
  })

  it('ships every package from its build, never from its source tree', () => {
    for (const project of published) {
      const manifest = JSON.parse(readFileSync(join(project.path, 'package.json'), 'utf8')) as {
        files?: string[]
      }

      expect(manifest.files, `${project.name} publishes no files list`).toBeDefined()
      expect(manifest.files).toContain('dist')
    }
  })

  it('carries its own changelog into the tarball, so npm shows what changed', () => {
    for (const project of published) {
      const manifest = JSON.parse(readFileSync(join(project.path, 'package.json'), 'utf8')) as {
        files?: string[]
      }

      expect(manifest.files, `${project.name} leaves CHANGELOG.md out of the tarball`).toContain(
        'CHANGELOG.md',
      )
    }
  })
})

describe('the packages that promise no runtime dependencies', () => {
  it('are exactly the published packages whose manifest declares none', () => {
    const declaresNone = publishedFrom(workspaceProjects(ROOT))
      .filter((project) => {
        const manifest = JSON.parse(readFileSync(join(project.path, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
        }
        return Object.keys(manifest.dependencies ?? {}).length === 0
      })
      .map((project) => project.name)
      .sort()

    expect(declaresNone).toEqual([...DEPENDENCY_FREE].sort())
  })
})

describe('the changesets configuration', () => {
  const CONFIG = JSON.parse(
    readFileSync(join(ROOT, '.changeset', 'config.json'), 'utf8'),
  ) as Record<string, unknown>

  it('versions the private apps, or every mixed changeset is refused', () => {
    expect(CONFIG.privatePackages).toEqual({ version: true, tag: false })
  })

  it('stamps the SDKs right after it versions them, in every version script', () => {
    for (const script of ['version-packages', 'version-packages:dev', 'version-packages:next']) {
      expect(SCRIPTS[script], script).toContain('stamp-sdk-versions')
    }
  })
})

describe('the script that writes the SBOMs', () => {
  it('is the command this package defines, so the two cannot drift', () => {
    expect(SCRIPTS['sbom:write']).toBe(sbomCommand(SBOM_DIR))
  })

  it('is checked right after it is written', () => {
    expect(SCRIPTS['release:sbom']).toBe('pnpm run sbom:write && pnpm run sbom:check')
  })
})
