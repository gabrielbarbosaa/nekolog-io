const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.-]+)(?:deg)?\s*\)$/i

function channel(value: number): number {
  const gamma = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255)
}

function part(text: string, full: number): number {
  return text.endsWith('%') ? (Number.parseFloat(text) / 100) * full : Number.parseFloat(text)
}

export function parseOklch(value: string): { l: number; c: number; h: number } | undefined {
  const found = OKLCH.exec(value.trim())
  if (found === null) {
    return undefined
  }

  const l = part(found[1] as string, 1)
  const c = part(found[2] as string, 0.4)
  const h = Number.parseFloat(found[3] as string)

  return Number.isNaN(l) || Number.isNaN(c) || Number.isNaN(h) ? undefined : { l, c, h }
}

export function oklchToHex(value: string): string | undefined {
  const found = parseOklch(value)
  if (found === undefined) {
    return undefined
  }

  const radians = (found.h * Math.PI) / 180
  const a = found.c * Math.cos(radians)
  const b = found.c * Math.sin(radians)

  const long = (found.l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (found.l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (found.l - 0.0894841775 * a - 1.291485548 * b) ** 3

  const red = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
  const green = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
  const blue = -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short

  return `#${[red, green, blue].map((one) => channel(one).toString(16).padStart(2, '0')).join('')}`
}

export function asPaintable(value: string): string {
  return oklchToHex(value) ?? value.trim()
}

export function withAlpha(hex: string, alpha: number): string {
  const amount = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${amount.toString(16).padStart(2, '0')}` : hex
}
