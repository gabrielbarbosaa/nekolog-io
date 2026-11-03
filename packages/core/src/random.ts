type RandomSource = {
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function fillRandom(bytes: Uint8Array, random: () => number = Math.random): void {
  const source = (globalThis as { crypto?: RandomSource }).crypto
  if (source?.getRandomValues) {
    source.getRandomValues(bytes)
    return
  }
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(random() * 256)
  }
}

export function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => HEX[byte] as string).join('')
}

export function randomHex(size: number, random: () => number = Math.random): string {
  const bytes = new Uint8Array(size)
  fillRandom(bytes, random)
  return hexOf(bytes)
}
