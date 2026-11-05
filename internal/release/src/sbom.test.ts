import { describe, expect, it } from 'vitest'
import {
  assertComplete,
  assertDependencyFree,
  compare,
  DEPENDENCY_FREE,
  documentFrom,
  matchesFilter,
  publishedFrom,
  SBOM_FILTER,
  SBOM_SPEC_VERSION,
  type SbomDocument,
  SbomRefused,
  sbomArgs,
  sbomCommand,
  type WorkspaceProject,
} from './sbom.ts'

function project(name: string, version = '1.0.0', isPrivate?: boolean): WorkspaceProject {
  return {
    name,
    version,
    path: `/w/${name}`,
    ...(isPrivate === undefined ? {} : { private: isPrivate }),
  }
}

function document(name: string, version = '1.0.0', components: string[] = []): SbomDocument {
  return { file: `${name}.cdx.json`, name, version, components }
}

function bomText(name: string, version: string, components: unknown[] = []): string {
  const [group, bare] = name.split('/')
  return JSON.stringify({
    bomFormat: 'CycloneDX',
    metadata: { component: { type: 'library', group, name: bare, version } },
    components,
  })
}

describe('which packages an SBOM is owed', () => {
  it('leaves out everything private, because nothing private is ever published', () => {
    const projects = [project('@nekolog-io/core'), project('@apps/ingest', '1.0.0', true)]

    expect(publishedFrom(projects).map((found) => found.name)).toEqual(['@nekolog-io/core'])
  })

  it('counts a package with no private field as published, the way npm does', () => {
    expect(publishedFrom([project('@nekolog-io/core')])).toHaveLength(1)
  })

  it('matches the filter the command is given against the published names', () => {
    expect(matchesFilter('@nekolog-io/core')).toBe(true)
    expect(matchesFilter('@internal/release')).toBe(false)
    expect(matchesFilter('@nekolog-io-evil/core')).toBe(false)
  })
})

describe('the command that writes them', () => {
  it('asks for CycloneDX at a pinned specification version', () => {
    const args = sbomArgs()

    expect(args).toContain('--sbom-format')
    expect(args[args.indexOf('--sbom-format') + 1]).toBe('cyclonedx')
    expect(args[args.indexOf('--sbom-spec-version') + 1]).toBe(SBOM_SPEC_VERSION)
  })

  it('describes what the package brings, not what the application already has', () => {
    const args = sbomArgs()

    expect(args).toContain('--prod')
    expect(args).toContain('--exclude-peers')
  })

  it('writes one document per package rather than one for the workspace', () => {
    expect(sbomArgs()).toContain('--split')
    expect(sbomArgs('out')).toContain('out/%s.cdx.json')
  })

  it('quotes the filter, because a bare glob is the shell every time', () => {
    expect(sbomCommand()).toContain(`--filter "${SBOM_FILTER}"`)
  })
})

describe('reading a document back', () => {
  it('puts the scope back on the name, which CycloneDX keeps apart', () => {
    const read = documentFrom('a.cdx.json', bomText('@nekolog-io/core', '1.0.0'))

    expect(read.name).toBe('@nekolog-io/core')
    expect(read.version).toBe('1.0.0')
  })

  it('counts the components it carries', () => {
    const read = documentFrom(
      'a.cdx.json',
      bomText('@nekolog-io/node', '1.0.0', [{ group: '@nekolog-io', name: 'core' }]),
    )

    expect(read.components).toEqual(['@nekolog-io/core'])
  })

  it('refuses a document that is not JSON', () => {
    expect(() => documentFrom('a.cdx.json', 'not json')).toThrow(SbomRefused)
  })

  it('refuses a document that names no component of its own', () => {
    expect(() => documentFrom('a.cdx.json', JSON.stringify({ components: [] }))).toThrow(
      SbomRefused,
    )
  })

  it('refuses a document whose component has no version', () => {
    const text = JSON.stringify({ metadata: { component: { name: 'core', group: '@nekolog-io' } } })

    expect(() => documentFrom('a.cdx.json', text)).toThrow(SbomRefused)
  })
})

describe('checking the set against the release', () => {
  it('passes when every published package has a document at its own version', () => {
    const report = compare([project('@nekolog-io/core')], [document('@nekolog-io/core')])

    expect(report).toEqual({ missing: [], unexpected: [], mismatched: [] })
    expect(() => assertComplete(report)).not.toThrow()
  })

  it('names the package whose document was never written', () => {
    const report = compare(
      [project('@nekolog-io/core'), project('@nekolog-io/node')],
      [document('@nekolog-io/core')],
    )

    expect(report.missing).toEqual(['@nekolog-io/node'])
    expect(() => assertComplete(report)).toThrow(/@nekolog-io\/node/)
  })

  it('names a document that describes something this release does not publish', () => {
    const report = compare(
      [project('@nekolog-io/core')],
      [document('@nekolog-io/core'), document('@apps/ingest')],
    )

    expect(report.unexpected).toEqual(['@apps/ingest'])
    expect(() => assertComplete(report)).toThrow(/@apps\/ingest/)
  })

  it('refuses a document left over from the version before, which is the whole risk', () => {
    const report = compare(
      [project('@nekolog-io/core', '1.1.0')],
      [document('@nekolog-io/core', '1.0.0')],
    )

    expect(report.mismatched).toEqual(['@nekolog-io/core'])
    expect(() => assertComplete(report)).toThrow(/another version/)
  })

  it('says nothing when there is nothing to say', () => {
    expect(() => assertComplete({ missing: [], unexpected: [], mismatched: [] })).not.toThrow()
  })
})

describe('the packages that promise no runtime dependencies', () => {
  const all = DEPENDENCY_FREE.map((name) => document(name))

  it('pass while they bring nothing', () => {
    expect(() => assertDependencyFree(all)).not.toThrow()
  })

  it('fail the moment one of them gains a dependency', () => {
    const broken = [document('@nekolog-io/core', '1.0.0', ['valibot']), ...all.slice(1)]

    expect(() => assertDependencyFree(broken)).toThrow(/@nekolog-io\/core now brings valibot/)
  })

  it('fail when one of them has no document at all, rather than passing vacuously', () => {
    expect(() => assertDependencyFree(all.slice(1))).toThrow(/could not be checked/)
  })

  it('do not care what the other packages bring', () => {
    expect(() =>
      assertDependencyFree([...all, document('@nekolog-io/winston', '1.0.0', ['logform'])]),
    ).not.toThrow()
  })
})
