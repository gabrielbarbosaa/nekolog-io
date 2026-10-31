import {
  type BackoffOptions,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_RETRY_DELAY_MS,
  retryPlan,
} from './backoff.ts'
import {
  type BatchErrorCode,
  decisionForCode,
  decisionForStatus,
  isBatchErrorCode,
} from './codes.ts'
import { MAX_BATCH_BYTES, MAX_EVENTS_PER_BATCH, SCHEMA_VERSION } from './limits.ts'
import { type BoundedQueue, boundedQueue, DEFAULT_MAX_QUEUE_EVENTS } from './queue.ts'
import { cancel, schedule, sleepFor, type TimerId } from './timers.ts'
import type { LogEvent, Resource, Sdk, Sink } from './types.ts'
import { uuidv7 } from './uuid.ts'

export const DEFAULT_ENDPOINT = 'https://ingest.nekolog.io'
export const DEFAULT_FLUSH_INTERVAL_MS = 5_000
export const PUBLIC_KEY_PREFIX = 'nekolog_pk_'
export const SECRET_KEY_PREFIX = 'nekolog_sk_'

export type FetchResponseLike = {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    keepalive?: boolean
  },
) => Promise<FetchResponseLike>

export type DropReason =
  | 'queue_full'
  | 'event_too_large'
  | 'retries_exhausted'
  | 'rejected_by_server'
  | 'transport_stopped'

export type RejectedEvent = { index: number; code: string }

export type TransportOptions = {
  apiKey: string
  sdk: Sdk
  resource: Resource
  endpoint?: string
  maxQueueEvents?: number
  maxBatchEvents?: number
  maxBatchBytes?: number
  flushIntervalMs?: number
  maxRetries?: number
  baseRetryDelayMs?: number
  maxRetryDelayMs?: number
  fetch?: FetchLike
  now?: () => number
  random?: () => number
  sleep?: (ms: number) => Promise<void>
  onError?: (error: unknown) => void
  onDrop?: (count: number, reason: DropReason) => void
  onReject?: (rejected: RejectedEvent[]) => void
}

export type Transport = Sink & {
  readonly size: number
  readonly dropped: number
  readonly stopped: boolean
  readonly pausedUntil: number
  flush(): Promise<void>
  close(): Promise<void>
}

export type Envelope = {
  schemaVersion: number
  batchId: string
  sdk: Sdk
  resource: Resource
  events: LogEvent[]
}

type Outcome =
  | { kind: 'ok'; rejected: RejectedEvent[] }
  | { kind: 'retry' }
  | { kind: 'drop'; code: BatchErrorCode | null; status: number }
  | { kind: 'stop'; code: BatchErrorCode | null; status: number }

type DeliveryResult = 'done' | 'paused' | 'stopped'

function globalFetch(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch
}

export function isSecretKey(apiKey: string): boolean {
  return apiKey.startsWith(SECRET_KEY_PREFIX)
}

export function requestUrlFor(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/logs`
}

export function headersFor(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

export function splitBatch(
  events: LogEvent[],
  maxEvents: number,
  maxBytes: number,
  measure: (events: LogEvent[]) => number,
): { batches: LogEvent[][]; oversized: LogEvent[] } {
  const batches: LogEvent[][] = []
  const oversized: LogEvent[] = []

  const emit = (chunk: LogEvent[]): void => {
    if (chunk.length === 0) {
      return
    }
    if (measure(chunk) <= maxBytes) {
      batches.push(chunk)
      return
    }
    if (chunk.length === 1) {
      oversized.push(chunk[0] as LogEvent)
      return
    }
    const middle = Math.floor(chunk.length / 2)
    emit(chunk.slice(0, middle))
    emit(chunk.slice(middle))
  }

  for (let i = 0; i < events.length; i += maxEvents) {
    emit(events.slice(i, i + maxEvents))
  }

  return { batches, oversized }
}

export function readOutcome(status: number, body: string): Outcome {
  let code: BatchErrorCode | null = null
  let rejected: RejectedEvent[] = []

  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown }
      rejected?: unknown
    }
    if (isBatchErrorCode(parsed?.error?.code)) {
      code = parsed.error.code
    }
    if (Array.isArray(parsed?.rejected)) {
      rejected = parsed.rejected as RejectedEvent[]
    }
  } catch {
    code = null
  }

  if (status >= 200 && status < 300) {
    return { kind: 'ok', rejected }
  }

  const decision = code ? decisionForCode(code) : decisionForStatus(status)
  if (decision === 'retry') {
    return { kind: 'retry' }
  }
  if (decision === 'stop') {
    return { kind: 'stop', code, status }
  }
  return { kind: 'drop', code, status }
}

export function createTransport(options: TransportOptions): Transport {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const url = requestUrlFor(endpoint)
  const headers = headersFor(options.apiKey)
  const maxBatchEvents = Math.min(
    options.maxBatchEvents ?? MAX_EVENTS_PER_BATCH,
    MAX_EVENTS_PER_BATCH,
  )
  const maxBatchBytes = Math.min(options.maxBatchBytes ?? MAX_BATCH_BYTES, MAX_BATCH_BYTES)
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const backoff: BackoffOptions = {
    baseDelayMs: options.baseRetryDelayMs,
    maxDelayMs: options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    random: options.random,
  }
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const sleep = options.sleep ?? sleepFor
  const send = options.fetch ?? globalFetch()

  const queue: BoundedQueue<LogEvent> = boundedQueue(
    options.maxQueueEvents ?? DEFAULT_MAX_QUEUE_EVENTS,
  )

  let stopped = false
  let pausedUntil = 0
  let timer: TimerId | null = null
  let inFlight: Promise<void> = Promise.resolve()

  const report = (error: unknown): void => {
    try {
      options.onError?.(error)
    } catch {
      return
    }
  }

  const reportDrop = (count: number, reason: DropReason): void => {
    if (count <= 0) {
      return
    }
    try {
      options.onDrop?.(count, reason)
    } catch (error) {
      report(error)
    }
  }

  const clearTimer = (): void => {
    cancel(timer)
    timer = null
  }

  const envelopeFor = (events: LogEvent[]): Envelope => ({
    schemaVersion: SCHEMA_VERSION,
    batchId: uuidv7(now, random),
    sdk: options.sdk,
    resource: options.resource,
    events,
  })

  const measure = (events: LogEvent[]): number => JSON.stringify(envelopeFor(events)).length

  const stop = (reason: string): void => {
    stopped = true
    clearTimer()
    reportDrop(queue.drain().length, 'transport_stopped')
    report(new Error(`The nekolog transport stopped: ${reason}`))
  }

  const deliver = async (events: LogEvent[]): Promise<DeliveryResult> => {
    if (!send) {
      reportDrop(events.length, 'transport_stopped')
      stop('no fetch implementation is available in this runtime')
      return 'stopped'
    }

    const body = JSON.stringify(envelopeFor(events))

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let outcome: Outcome
      let retryAfter: string | null = null

      try {
        const response = await send(url, { method: 'POST', headers, body, keepalive: true })
        retryAfter = response.headers.get('Retry-After')
        outcome = readOutcome(response.status, await response.text())
      } catch (error) {
        report(error)
        outcome = { kind: 'retry' }
      }

      if (outcome.kind === 'ok') {
        if (outcome.rejected.length > 0) {
          reportDrop(outcome.rejected.length, 'rejected_by_server')
          try {
            options.onReject?.(outcome.rejected)
          } catch (error) {
            report(error)
          }
        }
        return 'done'
      }

      if (outcome.kind === 'stop') {
        reportDrop(events.length, 'transport_stopped')
        stop(`the server answered ${outcome.code ?? outcome.status}`)
        return 'stopped'
      }

      if (outcome.kind === 'drop') {
        reportDrop(events.length, 'rejected_by_server')
        report(new Error(`The server rejected a batch: ${outcome.code ?? outcome.status}`))
        return 'done'
      }

      if (attempt === maxRetries) {
        break
      }

      const plan = retryPlan(attempt, retryAfter, now(), backoff)
      if (plan.kind === 'pause') {
        pausedUntil = now() + plan.delayMs
        return 'paused'
      }
      await sleep(plan.delayMs)
    }

    reportDrop(events.length, 'retries_exhausted')
    return 'done'
  }

  const drainOnce = async (): Promise<void> => {
    if (stopped || now() < pausedUntil) {
      return
    }

    const pending = queue.drain()
    if (pending.length === 0) {
      return
    }

    const { batches, oversized } = splitBatch(pending, maxBatchEvents, maxBatchBytes, measure)
    reportDrop(oversized.length, 'event_too_large')

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i] as LogEvent[]
      const result = stopped ? 'stopped' : await deliver(batch)

      if (result === 'paused') {
        queue.prepend(batches.slice(i).flat())
        return
      }
      if (result === 'stopped') {
        return
      }
    }
  }

  const run = (): Promise<void> => {
    inFlight = inFlight.then(drainOnce).catch(report)
    return inFlight
  }

  const scheduleTimer = (): void => {
    if (timer !== null || stopped || flushIntervalMs <= 0) {
      return
    }
    timer = schedule(() => {
      timer = null
      void run()
    }, flushIntervalMs)
  }

  return {
    get size() {
      return queue.size
    },
    get dropped() {
      return queue.dropped
    },
    get stopped() {
      return stopped
    },
    get pausedUntil() {
      return pausedUntil
    },
    emit(event) {
      if (stopped) {
        reportDrop(1, 'transport_stopped')
        return
      }
      reportDrop(queue.push(event), 'queue_full')
      if (queue.size >= maxBatchEvents) {
        void run()
        return
      }
      scheduleTimer()
    },
    async flush() {
      clearTimer()
      await run()
    },
    async close() {
      clearTimer()
      await run()
      stopped = true
    },
  }
}
