import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { publishedFrom, SbomRefused, type WorkspaceProject } from './sbom.ts'
import { workspaceProjects } from './workspace.ts'

export const SDK_VERSION_DECLARATION = /(export const SDK_VERSION = ')([^']*)(')/

export type SdkVersion = {
  package: string
  file: string
  declared: string
  expected: string
}

export function declaredIn(source: string): string | null {
  return SDK_VERSION_DECLARATION.exec(source)?.[2] ?? null
}

export function stamp(source: string, version: string): string {
  if (declaredIn(source) === null) {
    throw new SbomRefused('That file declares no SDK_VERSION.')
  }
  return source.replace(SDK_VERSION_DECLARATION, `$1${version}$3`)
}

function sourceFilesIn(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFilesIn(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full)
    }
  }
  return files
}

function declarationsFor(project: WorkspaceProject): SdkVersion[] {
  let files: string[]
  try {
    files = sourceFilesIn(join(project.path, 'src'))
  } catch {
    return []
  }
  const found: SdkVersion[] = []
  for (const file of files) {
    const declared = declaredIn(readFileSync(file, 'utf8'))
    if (declared !== null) {
      found.push({ package: project.name, file, declared, expected: project.version })
    }
  }
  return found
}

export function sdkVersions(root: string): SdkVersion[] {
  const found: SdkVersion[] = []
  for (const project of publishedFrom(workspaceProjects(root))) {
    const declarations = declarationsFor(project)
    if (declarations.length > 1) {
      throw new SbomRefused(
        `${project.name} declares SDK_VERSION in more than one file: ${declarations
          .map((declaration) => declaration.file)
          .join(', ')}`,
      )
    }
    found.push(...declarations)
  }
  return found
}

export function staleFrom(versions: readonly SdkVersion[]): SdkVersion[] {
  return versions.filter((version) => version.declared !== version.expected)
}

export function stampAll(root: string): SdkVersion[] {
  const stale = staleFrom(sdkVersions(root))
  for (const version of stale) {
    writeFileSync(version.file, stamp(readFileSync(version.file, 'utf8'), version.expected), 'utf8')
  }
  return stale
}
