import {
  createLogger as createCoreLogger,
  type FetchLike,
  type Logger,
  type LoggerOptions,
  type TransportTuning,
} from '@nekolog-io/core'
import { BEACON_MAX_BYTES, createSender, type SendBeaconLike } from './beacon.ts'
import { browserContext } from './context.ts'
import { publicKeyOnly } from './keys.ts'
import type { PageDetail } from './page.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

export type BrowserLoggerOptions = Omit<LoggerOptions, 'runtime' | 'sdk'> & {
  page?: PageDetail
  fetch?: FetchLike
  sendBeacon?: SendBeaconLike | false
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

export function createLogger(options: BrowserLoggerOptions = {}): Logger {
  const { page, fetch: fetchLike, sendBeacon, ...rest } = options
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
      fetch: createSender({ apiKey, fetch: fetchLike, sendBeacon }),
    }
  }

  return createCoreLogger({
    ...rest,
    apiKey,
    transport,
    runtime: 'browser',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    contextProvider: options.contextProvider ?? browserContext({ page }),
  })
}
