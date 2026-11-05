import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SbomRefused } from './sbom.ts'
import { declaredIn, sdkVersions, staleFrom, stamp } from './stamp.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('the version an SDK puts in every batch it sends', () => {
  const versions = sdkVersions(ROOT)

  it('is the version of its own package, in every SDK that reports one', () => {
    const stale = staleFrom(versions).map(
      (version) =>
        `${version.package} says ${version.declared}, its package.json says ${version.expected}`,
    )

    expect(stale).toEqual([])
  })

  it('is declared by the eight packages that send batches, and read from their source', () => {
    expect(versions.map((version) => version.package).sort()).toEqual([
      '@nekolog-io/browser',
      '@nekolog-io/core',
      '@nekolog-io/nestjs',
      '@nekolog-io/next',
      '@nekolog-io/node',
      '@nekolog-io/pino',
      '@nekolog-io/react',
      '@nekolog-io/winston',
    ])
  })

  it('does not live in the same file in all of them, which is why it is searched for', () => {
    const files = versions.map((version) => relative(ROOT, version.file).replaceAll('\\', '/'))

    expect(files).toContain('packages/core/src/version.ts')
    expect(files).toContain('packages/pino/src/index.ts')
    expect(files).toContain('packages/nestjs/src/tokens.ts')
  })
})

describe('stamping one', () => {
  it('replaces the version and nothing else', () => {
    const source =
      "export const SDK_NAME = '@nekolog-io/core'\nexport const SDK_VERSION = '0.0.0'\n"

    expect(stamp(source, '1.2.3')).toBe(
      "export const SDK_NAME = '@nekolog-io/core'\nexport const SDK_VERSION = '1.2.3'\n",
    )
  })

  it('reads back what it wrote', () => {
    expect(declaredIn(stamp("export const SDK_VERSION = '0.0.0'", '2.0.0-next.1'))).toBe(
      '2.0.0-next.1',
    )
  })

  it('finds nothing in a file that declares nothing', () => {
    expect(declaredIn("export const SDK_NAME = '@nekolog-io/core'")).toBeNull()
  })

  it('refuses to invent a declaration in a file that has none', () => {
    expect(() => stamp("export const SDK_NAME = 'x'", '1.0.0')).toThrow(SbomRefused)
  })

  it('counts a package as stale only when the two disagree', () => {
    const same = { package: 'a', file: 'a.ts', declared: '1.0.0', expected: '1.0.0' }
    const different = { package: 'b', file: 'b.ts', declared: '1.0.0', expected: '1.1.0' }

    expect(staleFrom([same, different])).toEqual([different])
  })
})
