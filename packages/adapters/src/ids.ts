export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const ID_SUFFIX_CHARS = 26

type CryptoLike = { getRandomValues?: (array: Uint8Array) => Uint8Array }

export function crockfordId(prefix: string, what: string): string {
  const source = (globalThis as { crypto?: CryptoLike }).crypto
  if (!source?.getRandomValues) {
    throw new Error(`This runtime has no crypto.getRandomValues, so it cannot mint ${what}`)
  }
  const bytes = source.getRandomValues(new Uint8Array(ID_SUFFIX_CHARS))
  let suffix = ''
  for (const byte of bytes) {
    suffix += CROCKFORD_ALPHABET[byte % 32]
  }
  return `${prefix}${suffix}`
}
