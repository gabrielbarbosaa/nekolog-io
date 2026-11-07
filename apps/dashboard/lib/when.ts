const CLOCK: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

const WITH_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit', ...CLOCK }

export function zoneOf(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

export function clockText(ms: number, locale: string, withDay = false): string {
  if (Number.isNaN(ms)) {
    return '—'
  }

  const when = new Date(ms)
  const shown = new Intl.DateTimeFormat(locale, withDay ? WITH_DAY : CLOCK).format(when)
  const millis = String(when.getMilliseconds()).padStart(3, '0')

  return `${shown}.${millis}`
}

export function fullText(ms: number, locale: string): string {
  if (Number.isNaN(ms)) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(ms))
}
