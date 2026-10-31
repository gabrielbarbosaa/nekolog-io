type RandomSource = {
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

function fillRandom(bytes: Uint8Array, random: () => number): void {
  const source = (globalThis as { crypto?: RandomSource }).crypto
  if (source?.getRandomValues) {
    source.getRandomValues(bytes)
    return
  }
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(random() * 256)
  }
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function uuidv7(now: () => number = Date.now, random: () => number = Math.random): string {
  const bytes = new Uint8Array(16)
  fillRandom(bytes, random)

  const timestamp = Math.max(0, Math.trunc(now()))
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Math.floor(timestamp / 2 ** (8 * (5 - i))) & 0xff
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => HEX[byte] as string)
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
