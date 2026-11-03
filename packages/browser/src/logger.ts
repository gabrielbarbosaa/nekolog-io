import {
  type BeforeSend,
  createLogger as createCoreLogger,
  type FetchLike,
  type Logger,
  type LoggerOptions,
  type TransportTuning,
} from '@nekolog-io/core'
import { BEACON_MAX_BYTES, createSender, type SendBeaconLike } from './beacon.ts'
import { browserContext } from './context.ts'
import { publicKeyOnly } from './keys.ts'
import { type OfflineTuning, parkingSender } from './offline.ts'
import type { PageDetail } from './page.ts'
import type { BatchStore } from './store.ts'
import type { TraceTuning } from './tracing.ts'
import { type BreadcrumbTuning, DEFAULT_ATTACH_FROM, withBreadcrumbs } from './trail.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

export type BrowserLoggerOptions = Omit<LoggerOptions, 'runtime' | 'sdk'> & {
  page?: PageDetail
  fetch?: FetchLike
  sendBeacon?: SendBeaconLike | false
  breadcrumbs?: BreadcrumbTuning
  trace?: TraceTuning | false
  offline?: OfflineTuning | false
  offlineStore?: BatchStore
}

function warn(onError: ((error: unknown) => void) | undefined, message: string): void {
  const report = onError ?? defaultWarning
  try {
    report(new Error(message))
  } catch {
    return
  }
}

function defaultWarning(error: unknown): void {
  const target = (globalThis as { console?: { warn?: (...args: unknown[]) => void } }).console
  try {
    target?.warn?.('[nekolog]', error)
  } catch {
    return
  }
}

function beforeSendWith(options: BrowserLoggerOptions): BeforeSend | undefined {
  const attachFrom = options.breadcrumbs?.attachFrom ?? DEFAULT_ATTACH_FROM
  if (attachFrom === false) {
    return options.beforeSend
  }

  const next = options.beforeSend
  return (event) => {
    const enriched = withBreadcrumbs(event, attachFrom)
    return next === undefined ? enriched : next(enriched)
  }
}

function senderFor(options: BrowserLoggerOptions, apiKey: string): FetchLike {
  const beacon = createSender({
    apiKey,
    fetch: options.fetch,
    sendBeacon: options.sendBeacon,
  })

  if (options.offline === false) {
    return beacon
  }

  return parkingSender(beacon, {
    ...options.offline,
    store: options.offlineStore,
    onError: options.onError,
  })
}

export function createLogger(options: BrowserLoggerOptions = {}): Logger {
  const {
    page,
    fetch: _fetch,
    sendBeacon: _sendBeacon,
    breadcrumbs,
    trace: _trace,
    offline,
    offlineStore: _offlineStore,
    ...rest
  } = options
  const { apiKey, refusal } = publicKeyOnly(options.apiKey)

  if (refusal !== undefined) {
    warn(options.onError, refusal)
  }

  let transport: TransportTuning | undefined = options.transport
  if (apiKey !== undefined) {
    transport = {
      ...options.transport,
      maxBatchBytes: Math.min(
        options.transport?.maxBatchBytes ?? BEACON_MAX_BYTES,
        BEACON_MAX_BYTES,
      ),
      fetch: senderFor(options, apiKey),
    }
  }

  return createCoreLogger({
    ...rest,
    apiKey,
    transport,
    runtime: 'browser',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    contextProvider: options.contextProvider ?? browserContext({ page }),
    beforeSend: beforeSendWith(options),
  })
}
