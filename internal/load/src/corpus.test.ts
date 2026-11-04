import { MAX_BATCH_BYTES, MAX_EVENTS_PER_BATCH, parseBatch } from '@internal/schema'
import { describe, expect, it } from 'vitest'
import {
  batchBytes,
  CORPUS_STACK,
  corpusBatchId,
  DEFAULT_CORPUS_EVENTS,
  ERROR_EVERY_NTH,
  logBatch,
} from './corpus.ts'

describe('the corpus the load test sends', () => {
  it('is accepted by the real parser, so the run measures work and not a 400', () => {
    const parsed = parseBatch(logBatch())

    expect(parsed.ok, parsed.ok ? '' : parsed.message).toBe(true)
    expect(parsed.ok && parsed.batch.accepted).toHaveLength(DEFAULT_CORPUS_EVENTS)
    expect(parsed.ok && parsed.batch.rejected).toEqual([])
  })

  it('is accepted at the contract limit too, which is the shape that hurts', () => {
    const parsed = parseBatch(logBatch({ events: MAX_EVENTS_PER_BATCH, distinctErrors: true }))

    expect(parsed.ok, parsed.ok ? '' : parsed.message).toBe(true)
    expect(parsed.ok && parsed.batch.accepted).toHaveLength(MAX_EVENTS_PER_BATCH)
    expect(batchBytes(logBatch({ events: MAX_EVENTS_PER_BATCH }))).toBeLessThan(MAX_BATCH_BYTES)
  })

  it('carries errors, because an error costs more than a line of text', () => {
    const batch = logBatch({ events: 20 })
    const failing = batch.events.filter((event) => 'error' in event)

    expect(failing).toHaveLength(20 / ERROR_EVERY_NTH)
    expect(failing[0]).toMatchObject({ level: 'error' })
    expect(JSON.stringify(failing[0])).toContain('resolveOrder')
  })

  it('carries a stack with a frame the fingerprint keeps and one it skips', () => {
    expect(CORPUS_STACK).toContain('/srv/app/dist/orders.js')
    expect(CORPUS_STACK).toContain('node_modules')
  })

  it('repeats one error by default and makes them distinct when asked', () => {
    const repeating = logBatch({ events: 20 }).events.filter((event) => 'error' in event)
    const distinct = logBatch({ events: 20, distinctErrors: true }).events.filter(
      (event) => 'error' in event,
    )

    const stacks = (events: Array<Record<string, unknown>>) =>
      new Set(events.map((event) => (event.error as { stack: string }).stack))

    expect(stacks(repeating).size).toBe(1)
    expect(stacks(distinct).size).toBe(distinct.length)
  })

  it('can be asked for no errors at all', () => {
    expect(logBatch({ events: 10, errorEveryNth: 0 }).events.some((one) => 'error' in one)).toBe(
      false,
    )
  })

  it('mints a batch id the parser accepts, and a different one per seed', () => {
    expect(parseBatch(logBatch({ batchId: corpusBatchId(7) })).ok).toBe(true)
    expect(corpusBatchId(7)).not.toBe(corpusBatchId(8))
    expect(corpusBatchId(7).slice(0, 13)).not.toBe(corpusBatchId(8).slice(0, 13))
  })

  it('measures its own size in bytes, not in characters', () => {
    const batch = logBatch({ events: 1, errorEveryNth: 0, service: 'café' })

    expect(batchBytes(batch)).toBe(JSON.stringify(batch).length + 1)
  })
})
