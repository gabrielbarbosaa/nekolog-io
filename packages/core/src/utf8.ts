const SURROGATE_START = 0xd800
const SURROGATE_END = 0xdbff

function codeUnitBytes(code: number): number {
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  return 3
}

export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= SURROGATE_START && code <= SURROGATE_END && i + 1 < value.length) {
      bytes += 4
      i++
      continue
    }
    bytes += codeUnitBytes(code)
  }
  return bytes
}

export function truncateToUtf8Bytes(
  value: string,
  limit: number,
): { value: string; truncated: boolean } {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    const isSurrogatePair = code >= SURROGATE_START && code <= SURROGATE_END && i + 1 < value.length
    const size = isSurrogatePair ? 4 : codeUnitBytes(code)

    if (bytes + size > limit) {
      return { value: value.slice(0, i), truncated: true }
    }

    bytes += size
    if (isSurrogatePair) i++
  }
  return { value, truncated: false }
}
