import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { assertApiUrl, assertReleaseVersion, assertSecretKey, ReleaseRefused } from './releases.ts'

export const SOURCEMAPS_PATH = '/v1/sourcemaps'
export const MAX_SOURCE_MAP_BYTES: number = 8 * 1024 * 1024
export const SOURCE_MAP_NAME: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]*\.map$/
export const MAX_DEPTH = 8

export type UploadOptions = {
  key?: string | undefined
  version?: string | undefined
  dir?: string | undefined
  apiUrl?: string | undefined
  fetch?: typeof fetch
}

export type UploadedMap = { name: string; bytes: number; total: number }

export type UploadReport = {
  uploaded: UploadedMap[]
  skipped: string[]
}

export function flatName(root: string, file: string): string {
  const inside = relative(root, file).split(sep).join('-')
  return SOURCE_MAP_NAME.test(inside) ? inside : inside.replace(/[^A-Za-z0-9._-]/g, '-')
}

export async function findSourceMaps(root: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) {
    return []
  }

  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    throw new ReleaseRefused(`I cannot read ${root}.`)
  }

  const found: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await findSourceMaps(full, depth + 1)))
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      found.push(full)
    }
  }
  return found.sort()
}

export function uploadRequest(options: UploadOptions, name: string, body: Uint8Array): Request {
  const key = assertSecretKey(options.key)
  const version = assertReleaseVersion(options.version)
  const base = assertApiUrl(options.apiUrl)

  const target = new URL(SOURCEMAPS_PATH, base)
  target.searchParams.set('release', version)
  target.searchParams.set('name', name)

  return new Request(target, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
  })
}

function reasonFrom(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
    if (parsed.error?.message) {
      return `${parsed.error.code ?? String(status)}: ${parsed.error.message}`
    }
  } catch {
    // the server answered something that is not our error shape
  }
  return `HTTP ${status}`
}

export async function uploadSourceMaps(options: UploadOptions): Promise<UploadReport> {
  assertSecretKey(options.key)
  assertReleaseVersion(options.version)
  assertApiUrl(options.apiUrl)

  const root = resolve(options.dir ?? 'dist')
  const stats = await stat(root).catch(() => null)
  if (stats === null || !stats.isDirectory()) {
    throw new ReleaseRefused(`${root} is not a directory. Point --dir at your build output.`)
  }

  const files = await findSourceMaps(root)
  if (files.length === 0) {
    throw new ReleaseRefused(`I found no .map file under ${root}.`)
  }

  const send = options.fetch ?? fetch
  const report: UploadReport = { uploaded: [], skipped: [] }

  for (const file of files) {
    const body = new Uint8Array(await readFile(file))
    const name = flatName(root, file)

    if (body.byteLength > MAX_SOURCE_MAP_BYTES) {
      report.skipped.push(
        `${name} is ${body.byteLength} bytes, over the ${MAX_SOURCE_MAP_BYTES} limit`,
      )
      continue
    }

    const request = uploadRequest(options, name, body)

    let response: Response
    try {
      response = await send(request)
    } catch (error) {
      throw new ReleaseRefused(
        `I could not reach the API while uploading ${name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const text = await response.text()
    if (!response.ok) {
      throw new ReleaseRefused(`${name}: ${reasonFrom(response.status, text)}`)
    }

    let parsed: { sourceMap?: { bytes?: number }; release?: { sourcemapCount?: number } }
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ReleaseRefused(`${name}: the API answered something that is not an upload.`)
    }

    report.uploaded.push({
      name,
      bytes: parsed.sourceMap?.bytes ?? body.byteLength,
      total: parsed.release?.sourcemapCount ?? report.uploaded.length + 1,
    })
  }

  return report
}

export function describeUpload(report: UploadReport, version: string): string[] {
  const lines = [`uploaded ${report.uploaded.length} source map(s) for ${version}`]
  for (const one of report.uploaded) {
    lines.push(`  ${one.name}  ${one.bytes} bytes`)
  }
  for (const one of report.skipped) {
    lines.push(`  skipped ${one}`)
  }
  const last = report.uploaded[report.uploaded.length - 1]
  if (last !== undefined) {
    lines.push(`this release now holds ${last.total} source map(s)`)
  }
  return lines
}
