import { LOG_LEVELS } from './limits.ts'
import type { LogLevel } from './types.ts'

const RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)
}

export function levelRank(level: LogLevel): number {
  return RANK[level]
}

export function passesThreshold(level: LogLevel, minimum: LogLevel): boolean {
  return RANK[level] >= RANK[minimum]
}
