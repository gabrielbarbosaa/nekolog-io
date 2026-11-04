type CryptoLike = { getRandomValues?: (array: Uint8Array) => Uint8Array }

function fillRandom(bytes: Uint8Array): Uint8Array {
  const source = (globalThis as { crypto?: CryptoLike }).crypto
  if (source?.getRandomValues) {
    return source.getRandomValues(bytes)
  }
  for (let at = 0; at < bytes.length; at += 1) {
    bytes[at] = Math.floor(Math.random() * 256)
  }
  return bytes
}

export function uuidv7(now: () => number = Date.now): string {
  const bytes = fillRandom(new Uint8Array(16))

  const timestamp = Math.max(0, Math.trunc(now()))
  for (let at = 5; at >= 0; at -= 1) {
    bytes[at] = Math.floor(timestamp / 2 ** (8 * (5 - at))) & 0xff
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}
