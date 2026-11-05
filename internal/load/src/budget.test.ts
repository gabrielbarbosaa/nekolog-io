import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  API_P95_MS,
  affordableEvents,
  CPU_BUDGET_MS,
  CPU_HEADROOM,
  INGEST_P95_MS,
  MACHINE_VCPUS,
  MAX_FAILURE_RATE,
  MIN_CHECK_RATE,
  thresholdsFor,
} from './budget.ts'

const PLANO = new URL('../../../docs/PLANO.md', import.meta.url)

describe('the CPU budget', () => {
  it('is the one the plan writes down, not a number somebody liked', async () => {
    const plan = await readFile(PLANO, 'utf8')
    const row = plan
      .split('\n')
      .find((line) => line.includes('Ingestão, API e jobs') && line.includes('ms de CPU'))

    expect(row, 'docs/PLANO.md no longer states the CPU budget').toBeDefined()
    expect(row).toContain('1 vCPU')
    expect(row).toContain('10 ms de CPU')

    expect(CPU_BUDGET_MS).toBe(10)
    expect(MACHINE_VCPUS).toBe(1)
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

  it('refuses to answer on a cost that is not a cost, instead of inventing a ceiling', () => {
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(affordableEvents(nonsense), String(nonsense)).toBe(0)
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
