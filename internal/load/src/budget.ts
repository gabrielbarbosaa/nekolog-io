export const CPU_BUDGET_MS = 10

export const MACHINE_VCPUS = 1

export const CPU_HEADROOM = 0.5

export const INGEST_P95_MS = 500
export const API_P95_MS = 2_000
export const MAX_FAILURE_RATE = 0.01
export const MIN_CHECK_RATE = 0.99

export const DEFAULT_VUS = 10
export const DEFAULT_DURATION = '30s'

export function affordableEvents(msPerEvent: number): number {
  if (!Number.isFinite(msPerEvent) || msPerEvent <= 0) {
    return 0
  }
  return Math.floor((CPU_BUDGET_MS * CPU_HEADROOM) / msPerEvent)
}

export type Thresholds = {
  p95Ms: number
  failureRate: number
  checkRate: number
}

export function thresholdsFor(target: 'ingest' | 'api'): Thresholds {
  return {
    p95Ms: target === 'ingest' ? INGEST_P95_MS : API_P95_MS,
    failureRate: MAX_FAILURE_RATE,
    checkRate: MIN_CHECK_RATE,
  }
}
