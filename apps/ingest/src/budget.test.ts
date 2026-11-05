import { CPU_BUDGET_MS, logBatch } from '@internal/load'
import { MAX_EVENTS_PER_BATCH } from '@internal/schema'
import { memoryBlobStore, REDACTION_PATTERNS } from '@nekolog-io/adapters'
import { describe, expect, it, vi } from 'vitest'
import { type Authenticator, createIngestApp, type IngestPrincipal } from './app.ts'
import { countryOf, rowsFor } from './rows.ts'
import { createLogStoreSink } from './sink.ts'

const MAX_US_PER_EVENT = 200
const SUPERLINEAR = 3

const PRINCIPAL: IngestPrincipal = {
  projectId: 'prj_1',
  environmentId: 'env_1',
  retentionDays: 30,
  redaction: { patterns: [...REDACTION_PATTERNS] },
}

function appFor(principal: IngestPrincipal) {
  const allow: Authenticator = () => ({ ok: true, principal })
  return createIngestApp({
    authenticate: allow,
    sink: createLogStoreSink({
      logStore: { insert: async (rows) => ({ accepted: rows.length }) },
      spool: memoryBlobStore(),
    }),
  })
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Response(new TextEncoder().encode(text)).body
  if (stream === null) {
    throw new Error('no stream')
  }
  return new Uint8Array(
    await new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  )
}

function post(body: Uint8Array): Request {
  return new Request('https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body,
  })
}

async function msPerRequest(body: Uint8Array, runs: number): Promise<number> {
  const app = appFor(PRINCIPAL)
  for (let at = 0; at < 20; at += 1) {
    await app.request(post(body))
  }

  const samples: number[] = []
  for (let round = 0; round < 5; round += 1) {
    const began = performance.now()
    for (let at = 0; at < runs; at += 1) {
      await app.request(post(body))
    }
    samples.push((performance.now() - began) / runs)
  }
  samples.sort((a, b) => a - b)
  return samples[2] as number
}

async function worstBatch(events: number): Promise<Uint8Array> {
  return gzip(JSON.stringify(logBatch({ events, distinctErrors: true })))
}

describe('the CPU one ingestion request costs', () => {
  it('keeps its own ceiling a smoke alarm, not a number anybody can raise away', () => {
    const wholeBatchMs = (MAX_US_PER_EVENT * MAX_EVENTS_PER_BATCH) / 1000

    expect(wholeBatchMs).toBeLessThanOrEqual(CPU_BUDGET_MS * 15)
  })

  it('stays far enough under the budget to notice a regression', async () => {
    const body = await worstBatch(MAX_EVENTS_PER_BATCH)
    const ms = await msPerRequest(body, 40)
    const usPerEvent = (ms / MAX_EVENTS_PER_BATCH) * 1000

    process.stderr.write(
      `  worst legal batch: ${ms.toFixed(2)} ms for ${MAX_EVENTS_PER_BATCH} events ` +
        `(${usPerEvent.toFixed(1)} us/event, budget ${CPU_BUDGET_MS} ms)\n`,
    )

    expect(usPerEvent).toBeLessThan(MAX_US_PER_EVENT)
  }, 120_000)

  it('grows with the batch and not with its square', async () => {
    const small = await msPerRequest(await worstBatch(100), 60)
    const large = await msPerRequest(await worstBatch(500), 40)

    process.stderr.write(
      `  100 events ${small.toFixed(2)} ms, 500 events ${large.toFixed(2)} ms ` +
        `(${(large / small).toFixed(1)}x for 5x the work)\n`,
    )

    expect(large / small).toBeLessThan(5 * SUPERLINEAR)
  }, 120_000)
})

describe('what the request spends its CPU on', () => {
  it('hashes a repeated error once, however many times it arrives', async () => {
    const { parseBatch } = await import('@internal/schema')
    const parsed = parseBatch(logBatch({ events: MAX_EVENTS_PER_BATCH }))
    if (!parsed.ok) {
      throw new Error(parsed.message)
    }

    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const rows = await rowsFor(parsed.batch, PRINCIPAL, {
        receivedAt: Date.now(),
        country: countryOf(new Request('https://ingest.nekolog.io/v1/logs')),
      })

      expect(rows).toHaveLength(MAX_EVENTS_PER_BATCH)
      expect(new Set(rows.map((row) => row.fingerprint)).size).toBe(2)
      expect(digest).toHaveBeenCalledTimes(1)
    } finally {
      digest.mockRestore()
    }
  })

  it('hashes once per distinct error, so the memo never merges two issues', async () => {
    const { parseBatch } = await import('@internal/schema')
    const parsed = parseBatch(logBatch({ events: 50, distinctErrors: true }))
    if (!parsed.ok) {
      throw new Error(parsed.message)
    }

    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const rows = await rowsFor(parsed.batch, PRINCIPAL, { receivedAt: Date.now(), country: '' })
      const fingerprints = rows.map((row) => row.fingerprint).filter((one) => one !== '0')

      expect(digest).toHaveBeenCalledTimes(10)
      expect(new Set(fingerprints).size).toBe(10)
    } finally {
      digest.mockRestore()
    }
  })
})
