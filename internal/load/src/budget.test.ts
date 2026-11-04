import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  API_P95_MS,
  affordableEvents,
  CPU_HEADROOM,
  INGEST_P95_MS,
  MAX_FAILURE_RATE,
  MIN_CHECK_RATE,
  thresholdsFor,
  WORKER_CPU_BUDGET_MS,
  WORKER_REQUESTS_PER_DAY,
  WORKER_REQUESTS_PER_MINUTE,
} from './budget.ts'

const PLANO = new URL('../../../docs/PLANO.md', import.meta.url)

describe('the platform budget', () => {
  it('is the one the plan writes down, not a number somebody liked', async () => {
    const plan = await readFile(PLANO, 'utf8')
    const row = plan
      .split('\n')
      .find((line) => line.includes('Cloudflare Workers') && line.includes('req/dia'))

    expect(row, 'docs/PLANO.md no longer states the Workers limits').toBeDefined()
    expect(row).toContain('100 mil req/dia')
    expect(row).toContain('1.000 req/min')
    expect(row).toContain('10 ms de CPU')

    expect(WORKER_CPU_BUDGET_MS).toBe(10)
    expect(WORKER_REQUESTS_PER_MINUTE).toBe(1_000)
    expect(WORKER_REQUESTS_PER_DAY).toBe(100_000)
  })

  it('keeps half the CPU budget in reserve, because the measurement is not the edge', () => {
    expect(CPU_HEADROOM).toBeGreaterThan(0)
    expect(CPU_HEADROOM).toBeLessThanOrEqual(0.5)
  })

  it('says how many events a request can afford at a measured cost per event', () => {
    expect(affordableEvents(0.02)).toBe(250)
    expect(affordableEvents(0.01)).toBe(500)
    expect(affordableEvents(0.05)).toBe(100)
  })

  it('does not divide by a cost that is not a cost', () => {
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(affordableEvents(nonsense), String(nonsense)).toBe(WORKER_REQUESTS_PER_MINUTE)
    }
  })
})

describe('the k6 thresholds', () => {
  it('asks more of the ingestion than of the read API, which waits on ClickHouse', () => {
    expect(thresholdsFor('ingest').p95Ms).toBe(INGEST_P95_MS)
    expect(thresholdsFor('api').p95Ms).toBe(API_P95_MS)
    expect(INGEST_P95_MS).toBeLessThan(API_P95_MS)
  })

  it('fails a run that drops even one request in a hundred', () => {
    expect(MAX_FAILURE_RATE).toBeLessThanOrEqual(0.01)
    expect(MIN_CHECK_RATE).toBeGreaterThanOrEqual(0.99)

    for (const target of ['ingest', 'api'] as const) {
      expect(thresholdsFor(target)).toMatchObject({
        failureRate: MAX_FAILURE_RATE,
        checkRate: MIN_CHECK_RATE,
      })
    }
  })
})
