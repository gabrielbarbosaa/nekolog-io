import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createRelease,
  findSourceMaps,
  flatName,
  type RecordedRelease,
  uploadSourceMaps,
} from '@nekolog-io/cli'
import type { ResolvedUpload } from './options.ts'

export const DEFAULT_OUT_DIR = 'dist'

export type PublishDeps = {
  createRelease: typeof createRelease
  uploadSourceMaps: typeof uploadSourceMaps
  findSourceMaps: typeof findSourceMaps
  flatName: typeof flatName
  remove: (file: string) => Promise<void>
  log: (line: string) => void
}

export type PublishReport = {
  release: RecordedRelease
  dir: string
  uploaded: string[]
  skipped: string[]
  deleted: string[]
}

export const defaultDeps: PublishDeps = {
  createRelease,
  uploadSourceMaps,
  findSourceMaps,
  flatName,
  remove: (file) => rm(file, { force: true }),
  log: (line) => {
    process.stdout.write(`${line}\n`)
  },
}

export async function publishBuild(
  upload: ResolvedUpload,
  outDir: string | undefined,
  deps: PublishDeps = defaultDeps,
): Promise<PublishReport> {
  const dir = resolve(upload.dir ?? outDir ?? DEFAULT_OUT_DIR)

  const release = await deps.createRelease({
    key: upload.key,
    version: upload.release,
    commit: upload.commit ?? undefined,
    apiUrl: upload.apiUrl,
  })

  const uploads = await deps.uploadSourceMaps({
    key: upload.key,
    version: upload.release,
    dir,
    apiUrl: upload.apiUrl,
  })

  const names = new Set(uploads.uploaded.map((one) => one.name))
  const deleted: string[] = []

  if (upload.deleteAfterUpload) {
    for (const file of await deps.findSourceMaps(dir)) {
      if (names.has(deps.flatName(dir, file))) {
        await deps.remove(file)
        deleted.push(file)
      }
    }
  }

  const report: PublishReport = {
    release,
    dir,
    uploaded: [...names],
    skipped: uploads.skipped,
    deleted,
  }

  if (!upload.silent) {
    for (const line of describePublish(report)) {
      deps.log(line)
    }
  }

  return report
}

export function describePublish(report: PublishReport): string[] {
  const version = report.release.release.version
  const lines = [
    report.release.created
      ? `nekolog: recorded ${version} and uploaded ${report.uploaded.length} source map(s) from ${report.dir}`
      : `nekolog: ${version} was already recorded; uploaded ${report.uploaded.length} source map(s) from ${report.dir}`,
  ]
  for (const one of report.skipped) {
    lines.push(`nekolog: skipped ${one}`)
  }
  if (report.deleted.length > 0) {
    lines.push(`nekolog: deleted ${report.deleted.length} uploaded source map(s) from the build`)
  }
  return lines
}
