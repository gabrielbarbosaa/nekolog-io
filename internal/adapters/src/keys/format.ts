export const PUBLIC_KEY_PREFIX = 'nekolog_pk_'
export const SECRET_KEY_PREFIX = 'nekolog_sk_'

export const MIN_KEY_SECRET_CHARS = 16
export const MAX_KEY_SECRET_CHARS = 128
export const GENERATED_KEY_SECRET_CHARS = 32

const SECRET_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${MIN_KEY_SECRET_CHARS},${MAX_KEY_SECRET_CHARS}}$`,
)

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export type ApiKeyKind = 'public' | 'secret'

export type ApiKey = {
  kind: ApiKeyKind
  value: string
}

export function parseApiKey(value: unknown): ApiKey | null {
  if (typeof value !== 'string') {
    return null
  }

  const kind: ApiKeyKind | null = value.startsWith(PUBLIC_KEY_PREFIX)
    ? 'public'
    : value.startsWith(SECRET_KEY_PREFIX)
      ? 'secret'
      : null

  if (kind === null) {
    return null
  }

  const secret = value.slice(PUBLIC_KEY_PREFIX.length)
  return SECRET_PATTERN.test(secret) ? { kind, value } : null
}

export function prefixFor(kind: ApiKeyKind): string {
  return kind === 'public' ? PUBLIC_KEY_PREFIX : SECRET_KEY_PREFIX
}

export function generateApiKey(
  kind: ApiKeyKind,
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(GENERATED_KEY_SECRET_CHARS)
  let secret = ''
  for (const byte of bytes) {
    secret += ALPHABET[byte % ALPHABET.length]
  }
  return `${prefixFor(kind)}${secret}`
}

type CryptoLike = {
  getRandomValues?: (array: Uint8Array) => Uint8Array
  subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> }
}

type TextEncoderLike = { encode(input: string): Uint8Array }

function globalCrypto(): CryptoLike | undefined {
  return (globalThis as { crypto?: CryptoLike }).crypto
}

function encodeUtf8(value: string): Uint8Array {
  const Encoder = (globalThis as { TextEncoder?: new () => TextEncoderLike }).TextEncoder
  if (!Encoder) {
    throw new Error('This runtime has no TextEncoder, so it cannot hash a key')
  }
  return new Encoder().encode(value)
}

function defaultRandomBytes(size: number): Uint8Array {
  const source = globalCrypto()
  if (!source?.getRandomValues) {
    throw new Error('This runtime has no crypto.getRandomValues, so it cannot mint a key')
  }
  return source.getRandomValues(new Uint8Array(size))
}

export async function hashApiKey(value: string): Promise<string> {
  const subtle = globalCrypto()?.subtle
  if (!subtle) {
    throw new Error('This runtime has no crypto.subtle, so it cannot hash a key')
  }
  const digest = await subtle.digest('SHA-256', encodeUtf8(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
