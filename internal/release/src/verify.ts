import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertComplete,
  assertDependencyFree,
  compare,
  documentFrom,
  publishedFrom,
  SBOM_EXTENSION,
  type SbomDocument,
  SbomRefused,
} from './sbom.ts'
import { workspaceProjects } from './workspace.ts'

export function documentsIn(directory: string): SbomDocument[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    throw new SbomRefused(`There is no ${directory}. Write the SBOMs before checking them.`)
  }
  return entries
    .filter((entry) => entry.endsWith(SBOM_EXTENSION))
    .map((entry) => documentFrom(entry, readFileSync(join(directory, entry), 'utf8')))
}

export function verifySboms(root: string, directory: string): readonly SbomDocument[] {
  const published = publishedFrom(workspaceProjects(root))
  const documents = documentsIn(directory)
  assertComplete(compare(published, documents))
  assertDependencyFree(documents)
  return documents
}
