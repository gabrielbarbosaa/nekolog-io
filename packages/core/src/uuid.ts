import { fillRandom, hexOf } from './random.ts'

export function uuidv7(now: () => number = Date.now, random: () => number = Math.random): string {
  const bytes = new Uint8Array(16)
  fillRandom(bytes, random)

  const timestamp = Math.max(0, Math.trunc(now()))
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Math.floor(timestamp / 2 ** (8 * (5 - i))) & 0xff
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  const hex = hexOf(bytes)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}
