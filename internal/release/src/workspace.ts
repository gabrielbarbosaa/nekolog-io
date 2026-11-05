import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SbomRefused, type WorkspaceProject } from './sbom.ts'

const GLOB_LINE = /^\s*-\s*"?([^"\s]+)"?\s*$/

export function workspaceGlobsFrom(yaml: string): string[] {
  const globs: string[] = []
  let inside = false
  for (const line of yaml.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inside = true
      continue
    }
    if (inside && /^\S/.test(line)) {
      break
    }
    const found = inside ? GLOB_LINE.exec(line) : null
    if (found?.[1] !== undefined) {
      globs.push(found[1])
    }
  }
  if (globs.length === 0) {
    throw new SbomRefused('pnpm-workspace.yaml lists no packages, so nothing can be described.')
  }
  return globs
}

export function directoriesFor(root: string, globs: readonly string[]): string[] {
  const directories: string[] = []
  for (const glob of globs) {
    if (!glob.endsWith('/*')) {
      throw new SbomRefused(
        `I only understand workspace globs of the "dir/*" shape, and ${JSON.stringify(glob)} is not one.`,
      )
    }
    const parent = join(root, glob.slice(0, -2))
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        directories.push(join(parent, entry.name))
      }
    }
  }
  return directories
}

export function projectIn(directory: string): WorkspaceProject | null {
  let text: string
  try {
    text = readFileSync(join(directory, 'package.json'), 'utf8')
  } catch {
    return null
  }
  const parsed = JSON.parse(text) as Partial<WorkspaceProject>
  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new SbomRefused(`${directory} has a package.json with no name or no version.`)
  }
  return {
    name: parsed.name,
    version: parsed.version,
    path: directory,
    ...(parsed.private === undefined ? {} : { private: parsed.private }),
  }
}

export function workspaceProjects(root: string): WorkspaceProject[] {
  const globs = workspaceGlobsFrom(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  const projects: WorkspaceProject[] = []
  for (const directory of directoriesFor(root, globs)) {
    const project = projectIn(directory)
    if (project !== null) {
      projects.push(project)
    }
  }
  return projects
}
