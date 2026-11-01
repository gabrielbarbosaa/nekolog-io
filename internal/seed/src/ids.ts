const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const TIME_CHARS = 10
export const RANDOM_CHARS = 16
export const ULID_CHARS = TIME_CHARS + RANDOM_CHARS
export const MAX_ULID_TIME = 2 ** 48 - 1

export const ORGANIZATION_PREFIX = 'org_'
export const PROJECT_PREFIX = 'prj_'
export const ENVIRONMENT_PREFIX = 'env_'
export const KEY_PREFIX = 'key_'

export type RandomBytes = (size: number) => Uint8Array

type CryptoLike = {
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

export function defaultRandomBytes(size: number): Uint8Array {
  const source = (globalThis as { crypto?: CryptoLike }).crypto
  if (source?.getRandomValues === undefined) {
    throw new Error('This runtime has no crypto.getRandomValues, so it cannot mint an id')
  }
  return source.getRandomValues(new Uint8Array(size))
}

export function encodeTime(at: number): string {
  if (!Number.isInteger(at) || at < 0 || at > MAX_ULID_TIME) {
    throw new Error(`A ULID cannot carry the instant ${at}`)
  }

  let remaining = at
  let encoded = ''
  for (let position = 0; position < TIME_CHARS; position += 1) {
    encoded = `${CROCKFORD[remaining % 32]}${encoded}`
    remaining = Math.floor(remaining / 32)
  }
  return encoded
}

export function ulid(at: number, randomBytes: RandomBytes = defaultRandomBytes): string {
  const bytes = randomBytes(RANDOM_CHARS)
  if (bytes.length !== RANDOM_CHARS) {
    throw new Error(`A ULID needs ${RANDOM_CHARS} random bytes, got ${bytes.length}`)
  }

  let random = ''
  for (const byte of bytes) {
    random += CROCKFORD[byte % 32]
  }
  return `${encodeTime(at)}${random}`
}

export function id(prefix: string, at: number, randomBytes?: RandomBytes): string {
  return `${prefix}${ulid(at, randomBytes)}`
}
