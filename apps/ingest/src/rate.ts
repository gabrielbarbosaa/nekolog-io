export const DEFAULT_EVENTS_PER_MINUTE = 2_000

export function eventsPerMinuteFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_EVENTS_PER_MINUTE
  }
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `INGEST_EVENTS_PER_MINUTE must be a positive whole number, got ${JSON.stringify(value)}`,
    )
  }
  return limit
}
