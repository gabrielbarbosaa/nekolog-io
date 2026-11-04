export const MAX_BLOB_KEY_CHARS = 512
export const BLOB_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class UnsafeKey extends Error {
  readonly key: string

  constructor(key: string, why: string) {
    super(`This key cannot become a file name: ${why}`)
    this.name = 'UnsafeKey'
    this.key = key
  }
}

export function blobKeySegments(key: string): readonly string[] {
  if (key === '') {
    throw new UnsafeKey(key, 'it is empty')
  }
  if (key.length > MAX_BLOB_KEY_CHARS) {
    throw new UnsafeKey(key, `it is longer than ${MAX_BLOB_KEY_CHARS} characters`)
  }

  const segments = key.split('/')
  for (const segment of segments) {
    if (!BLOB_KEY_SEGMENT.test(segment)) {
      throw new UnsafeKey(key, `${JSON.stringify(segment)} is not a safe path segment`)
    }
  }

  return segments
}

const KV_KEEP = /^[A-Za-z0-9._-]$/

export function kvFileName(key: string): string {
  if (key === '') {
    throw new UnsafeKey(key, 'it is empty')
  }
  if (key.length > MAX_BLOB_KEY_CHARS) {
    throw new UnsafeKey(key, `it is longer than ${MAX_BLOB_KEY_CHARS} characters`)
  }

  let name = ''
  for (const character of key) {
    name += KV_KEEP.test(character)
      ? character
      : [...new TextEncoder().encode(character)]
          .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
          .join('')
  }

  if (name === '.' || name === '..') {
    throw new UnsafeKey(key, 'it names the directory itself')
  }
  return name
}
