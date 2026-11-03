const WILDCARD_PREFIX = '*.'

export function normaliseOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') {
    return null
  }
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.+)$/.exec(trimmed)
  if (match === null) {
    return null
  }
  const [, scheme = '', host = ''] = match
  return host === '' ? null : `${scheme.toLowerCase()}://${host.toLowerCase()}`
}

function split(origin: string): { scheme: string; host: string } | null {
  const index = origin.indexOf('://')
  if (index <= 0) {
    return null
  }
  return { scheme: origin.slice(0, index), host: origin.slice(index + 3) }
}

export function originMatches(pattern: string, origin: string): boolean {
  const wanted = normaliseOrigin(origin)
  if (wanted === null) {
    return false
  }

  const trimmed = pattern.trim().toLowerCase().replace(/\/+$/, '')
  if (trimmed === '*') {
    return true
  }

  const target = split(wanted)
  if (target === null) {
    return false
  }

  const index = trimmed.indexOf('://')
  if (index <= 0) {
    return false
  }
  const patternScheme = trimmed.slice(0, index)
  const patternHost = trimmed.slice(index + 3)

  if (patternScheme !== target.scheme || patternHost === '') {
    return false
  }

  if (!patternHost.startsWith(WILDCARD_PREFIX)) {
    return patternHost === target.host
  }

  const suffix = patternHost.slice(WILDCARD_PREFIX.length - 1)
  return suffix.length > 1 && target.host.endsWith(suffix) && target.host.length > suffix.length
}

export function originAllowed(
  allowlist: ReadonlyArray<string> | null,
  origin: string | null,
): boolean {
  if (allowlist === null) {
    return true
  }
  if (origin === null) {
    return false
  }
  return allowlist.some((pattern) => originMatches(pattern, origin))
}
