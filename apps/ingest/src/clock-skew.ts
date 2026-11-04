export const CLOCK_SKEW_WARNING_MS: number = 5 * 60 * 1000
export const MAX_CLOCK_AHEAD_MS: number = 5 * 60 * 1000
export const CLOCK_FLOOR_MARGIN_MS: number = 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

export function clockSkewMs(clientAt: number, receivedAt: number): number {
  if (!Number.isFinite(clientAt) || !Number.isFinite(receivedAt)) {
    return 0
  }
  return receivedAt - clientAt
}

export function isClockSkewed(skewMs: number): boolean {
  return Math.abs(skewMs) > CLOCK_SKEW_WARNING_MS
}

export function earliestStorableMs(receivedAt: number, retentionDays: number): number {
  const retention = Number.isFinite(retentionDays) ? Math.max(0, retentionDays) : 0
  return receivedAt - Math.max(0, retention * DAY_MS - CLOCK_FLOOR_MARGIN_MS)
}

export function latestStorableMs(receivedAt: number): number {
  return receivedAt + MAX_CLOCK_AHEAD_MS
}

export function boundedTimestampMs(
  clientAt: number,
  receivedAt: number,
  retentionDays: number,
): number {
  if (!Number.isFinite(clientAt)) {
    return receivedAt
  }
  const floor = earliestStorableMs(receivedAt, retentionDays)
  const ceiling = latestStorableMs(receivedAt)
  if (clientAt < floor) {
    return floor
  }
  if (clientAt > ceiling) {
    return ceiling
  }
  return clientAt
}
