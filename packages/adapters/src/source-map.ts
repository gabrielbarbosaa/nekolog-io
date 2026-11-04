export const MAX_SOURCE_MAP_BYTES: number = 8 * 1024 * 1024
export const MAX_SOURCE_MAP_NAME_CHARS = 200
export const SOURCE_MAP_NAME: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]*\.map$/
export const SOURCE_MAP_PREFIX = 'sourcemaps'
export const SOURCE_MAP_CONTENT_TYPE = 'application/json'
export const SOURCE_MAP_HEAD_BYTES = 4096
export const MAX_SOURCE_MAPS_PER_RELEASE = 200

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HEAD_CHUNK = 512

export class InvalidSourceMap extends Error {
  readonly field: string
  readonly oversize: boolean

  constructor(field: string, message: string, oversize = false) {
    super(message)
    this.name = 'InvalidSourceMap'
    this.field = field
    this.oversize = oversize
  }
}

export function assertSourceMapName(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new InvalidSourceMap('name', 'A source map needs a file name.')
  }
  if (raw.length > MAX_SOURCE_MAP_NAME_CHARS) {
    throw new InvalidSourceMap(
      'name',
      `A file name is at most ${MAX_SOURCE_MAP_NAME_CHARS} characters.`,
    )
  }
  if (!SOURCE_MAP_NAME.test(raw)) {
    throw new InvalidSourceMap(
      'name',
      'A file name is letters, digits, dot, dash and underscore, starts with a letter or digit, and ends in .map. No directories.',
    )
  }
  return raw
}

export type SourceMapShape = {
  bytes: number
  declaredVersion: number | null
}

export const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf]

export function withoutBom(body: Uint8Array): Uint8Array {
  return UTF8_BOM.every((byte, at) => body[at] === byte) ? body.subarray(UTF8_BOM.length) : body
}

export function headOf(body: Uint8Array): string {
  const bytes = withoutBom(body)
  const end = Math.min(bytes.length, SOURCE_MAP_HEAD_BYTES)
  let head = ''
  for (let at = 0; at < end; at += HEAD_CHUNK) {
    head += String.fromCharCode(...bytes.subarray(at, Math.min(at + HEAD_CHUNK, end)))
  }
  return head
}

export function assertSourceMapBody(body: Uint8Array): SourceMapShape {
  if (body.length === 0) {
    throw new InvalidSourceMap('body', 'That source map is empty.')
  }
  if (body.length > MAX_SOURCE_MAP_BYTES) {
    throw new InvalidSourceMap(
      'body',
      `A source map is at most ${MAX_SOURCE_MAP_BYTES} bytes, and that one is ${body.length}.`,
      true,
    )
  }

  const head = headOf(body)
  if (head.trimStart().charAt(0) !== '{') {
    throw new InvalidSourceMap('body', 'That is not a source map: it does not open a JSON object.')
  }
  if (!head.includes('"mappings"') && !head.includes('"sections"')) {
    throw new InvalidSourceMap(
      'body',
      'That is not a source map: no "mappings" or "sections" in the first kilobytes.',
    )
  }

  const declared = /"version"\s*:\s*(\d{1,3})/.exec(head)
  const declaredVersion = declared?.[1] === undefined ? null : Number(declared[1])
  if (declaredVersion !== null && declaredVersion !== 3) {
    throw new InvalidSourceMap('body', `This is a version ${declaredVersion} source map, not a 3.`)
  }

  return { bytes: body.length, declaredVersion }
}

export function sourceMapKey(projectId: string, releaseId: string, name: string): string {
  for (const [field, value] of [
    ['projectId', projectId],
    ['releaseId', releaseId],
  ] as const) {
    if (!SAFE_ID.test(value)) {
      throw new InvalidSourceMap(field, `${JSON.stringify(value)} cannot become a path segment.`)
    }
  }
  return `${SOURCE_MAP_PREFIX}/${projectId}/${releaseId}/${assertSourceMapName(name)}`
}
