export const SBOM_FORMAT = 'cyclonedx'
export const SBOM_SPEC_VERSION = '1.7'
export const SBOM_SUPPLIER = 'NekoLog'
export const SBOM_EXTENSION = '.cdx.json'
export const SBOM_DIR = 'sbom'
export const SBOM_FILTER = '@nekolog-io/*'

export const DEPENDENCY_FREE: readonly string[] = [
  '@nekolog-io/adapters',
  '@nekolog-io/cli',
  '@nekolog-io/core',
]

export class SbomRefused extends Error {}

export type WorkspaceProject = {
  name: string
  version: string
  path: string
  private?: boolean
}

export type SbomDocument = {
  file: string
  name: string
  version: string
  components: readonly string[]
}

export function publishedFrom(projects: readonly WorkspaceProject[]): WorkspaceProject[] {
  return projects.filter((project) => project.private !== true)
}

export function matchesFilter(name: string): boolean {
  return name.startsWith(SBOM_FILTER.slice(0, -1))
}

export function sbomArgs(outDir: string = SBOM_DIR): string[] {
  return [
    'sbom',
    '--sbom-format',
    SBOM_FORMAT,
    '--sbom-spec-version',
    SBOM_SPEC_VERSION,
    '--sbom-type',
    'library',
    '--sbom-supplier',
    SBOM_SUPPLIER,
    '--prod',
    '--lockfile-only',
    '--exclude-peers',
    '--split',
    '--filter',
    SBOM_FILTER,
    '--out',
    `${outDir}/%s${SBOM_EXTENSION}`,
  ]
}

export function sbomCommand(outDir: string = SBOM_DIR): string {
  return ['pnpm', ...sbomArgs(outDir)]
    .map((part) => (part.includes('*') ? `"${part}"` : part))
    .join(' ')
}

type Component = { group?: unknown; name?: unknown; version?: unknown }

function fullNameOf(component: Component): string {
  const name = typeof component.name === 'string' ? component.name : ''
  const group = typeof component.group === 'string' ? component.group : ''
  return group === '' ? name : `${group}/${name}`
}

export function documentFrom(file: string, text: string): SbomDocument {
  let parsed: { metadata?: { component?: Component }; components?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SbomRefused(`${file} is not JSON, so it describes nothing.`)
  }
  const component = parsed.metadata?.component
  if (component === undefined) {
    throw new SbomRefused(`${file} names no component of its own.`)
  }
  const name = fullNameOf(component)
  const version = typeof component.version === 'string' ? component.version : ''
  if (name === '' || version === '') {
    throw new SbomRefused(`${file} names no package or no version.`)
  }
  const components = Array.isArray(parsed.components) ? parsed.components : []
  return {
    file,
    name,
    version,
    components: components.map((entry) => fullNameOf(entry as Component)),
  }
}

export type SbomReport = {
  missing: string[]
  unexpected: string[]
  mismatched: string[]
}

export function compare(
  expected: readonly WorkspaceProject[],
  found: readonly SbomDocument[],
): SbomReport {
  const byName = new Map(found.map((document) => [document.name, document]))
  const wanted = new Set(expected.map((project) => project.name))
  return {
    missing: expected.filter((project) => !byName.has(project.name)).map((project) => project.name),
    unexpected: found
      .filter((document) => !wanted.has(document.name))
      .map((document) => document.name),
    mismatched: expected
      .filter((project) => {
        const document = byName.get(project.name)
        return document !== undefined && document.version !== project.version
      })
      .map((project) => project.name),
  }
}

export function assertComplete(report: SbomReport): void {
  const problems: string[] = []
  if (report.missing.length > 0) {
    problems.push(`no SBOM was written for ${report.missing.join(', ')}`)
  }
  if (report.unexpected.length > 0) {
    problems.push(`an SBOM appeared for ${report.unexpected.join(', ')}, which is not published`)
  }
  if (report.mismatched.length > 0) {
    problems.push(`the SBOM of ${report.mismatched.join(', ')} names another version`)
  }
  if (problems.length > 0) {
    throw new SbomRefused(`The SBOMs do not describe this release: ${problems.join('; ')}.`)
  }
}

export function assertDependencyFree(documents: readonly SbomDocument[]): void {
  const broken = documents
    .filter((document) => DEPENDENCY_FREE.includes(document.name))
    .filter((document) => document.components.length > 0)
  if (broken.length > 0) {
    const named = broken
      .map((document) => `${document.name} now brings ${document.components.join(', ')}`)
      .join('; ')
    throw new SbomRefused(
      `A package that promises no runtime dependencies has gained one: ${named}.`,
    )
  }
  const absent = DEPENDENCY_FREE.filter(
    (name) => !documents.some((document) => document.name === name),
  )
  if (absent.length > 0) {
    throw new SbomRefused(
      `No SBOM describes ${absent.join(', ')}, so the promise could not be checked.`,
    )
  }
}
