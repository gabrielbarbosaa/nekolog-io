import {
  DEFAULT_ENDPOINT,
  isoTimestamp,
  requestUrlFor,
  TRACEPARENT_HEADER,
  type TraceContext,
  type TraceTargetMatcher,
  traceparentOf,
} from '@nekolog-io/core'
import type { Trail } from './breadcrumbs.ts'
import { globalHref } from './globals.ts'
import { DEFAULT_PAGE_DETAIL, type PageDetail, pageUrl } from './page.ts'

export const STATUS_DATA_KEY = 'status'
export const DURATION_DATA_KEY = 'ms'
export const FAILED_MESSAGE_SUFFIX = 'failed'

type FetchArgs = [unknown, unknown?]
type AnyFetch = (this: unknown, ...args: FetchArgs) => Promise<unknown>

export function urlOf(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  const url = (input as { url?: unknown } | null)?.url
  return typeof url === 'string' ? url : undefined
}

export function methodOf(input: unknown, init: unknown): string {
  const fromInit = (init as { method?: unknown } | null | undefined)?.method
  if (typeof fromInit === 'string' && fromInit !== '') {
    return fromInit.toUpperCase()
  }
  const fromRequest = (input as { method?: unknown } | null | undefined)?.method
  return typeof fromRequest === 'string' && fromRequest !== '' ? fromRequest.toUpperCase() : 'GET'
}

export const RELATIVE_BASE = 'https://relative.invalid'

export function ingestMatcher(endpoint: string = DEFAULT_ENDPOINT): (url: string) => boolean {
  const ours = requestUrlFor(endpoint)
  return (url) => url.startsWith(ours)
}

export function describeRequestUrl(
  raw: string,
  detail: PageDetail,
  base: string | undefined,
): string | undefined {
  const resolved = pageUrl(raw, detail, base ?? RELATIVE_BASE)
  if (resolved === undefined || base !== undefined) {
    return resolved
  }

  try {
    const { origin } = new URL(resolved)
    return origin === RELATIVE_BASE ? resolved.slice(origin.length) : resolved
  } catch {
    return resolved
  }
}

export type FetchBreadcrumbOptions = {
  endpoint?: string
  ignore?: (url: string) => boolean
  page?: PageDetail
  href?: () => string | undefined
  now?: () => number
  target?: { fetch?: unknown }
}

export type TracePatch = {
  matches: TraceTargetMatcher
  spanFor: () => TraceContext
}

export type FetchPatchOptions = FetchBreadcrumbOptions & {
  trail?: Trail
  trace?: TracePatch
}

export function withTraceparent(args: FetchArgs, header: string): FetchArgs {
  const [input, init] = args
  const existing = (init as { headers?: unknown } | undefined)?.headers

  if (existing instanceof Headers) {
    const headers = new Headers(existing)
    headers.set(TRACEPARENT_HEADER, header)
    return [input, { ...(init as object), headers }]
  }
  if (Array.isArray(existing)) {
    return [input, { ...(init as object), headers: [...existing, [TRACEPARENT_HEADER, header]] }]
  }
  if (existing !== undefined && existing !== null) {
    return [
      input,
      { ...(init as object), headers: { ...(existing as object), [TRACEPARENT_HEADER]: header } },
    ]
  }
  if (typeof input === 'object' && input !== null && 'headers' in input) {
    const request = input as Request
    const headers = new Headers(request.headers)
    headers.set(TRACEPARENT_HEADER, header)
    return [new Request(request, { headers }), init]
  }
  return [input, { ...(init as object), headers: { [TRACEPARENT_HEADER]: header } }]
}

export function installFetchPatch(options: FetchPatchOptions = {}): () => void {
  const target = options.target ?? (globalThis as { fetch?: unknown })
  const original = target.fetch
  if (typeof original !== 'function') {
    return () => undefined
  }

  const now = options.now ?? Date.now
  const href = options.href ?? globalHref
  const detail = options.page ?? DEFAULT_PAGE_DETAIL
  const ignore = options.ignore ?? ingestMatcher(options.endpoint)
  const previous = original as AnyFetch
  const trail = options.trail
  const trace = options.trace

  const record = (message: string, started: number, status?: number): void => {
    if (trail === undefined) {
      return
    }
    try {
      trail.add({
        at: isoTimestamp(started),
        kind: 'fetch',
        message,
        data:
          status === undefined
            ? { [DURATION_DATA_KEY]: Math.round(now() - started) }
            : { [STATUS_DATA_KEY]: status, [DURATION_DATA_KEY]: Math.round(now() - started) },
      })
    } catch {
      return
    }
  }

  const installed: AnyFetch = function nekologFetch(this: unknown, ...args: FetchArgs) {
    let described: string | undefined
    let started = 0
    let outgoing = args

    try {
      const raw = urlOf(args[0])
      const shown = raw === undefined ? undefined : describeRequestUrl(raw, detail, href())
      if (trail !== undefined && raw !== undefined && shown !== undefined) {
        if (!ignore(raw) && !ignore(shown)) {
          described = `${methodOf(args[0], args[1])} ${shown}`
          started = now()
        }
      }
      if (trace !== undefined && raw !== undefined && !ignore(raw) && trace.matches(raw)) {
        outgoing = withTraceparent(args, traceparentOf(trace.spanFor()))
      }
    } catch {
      described = undefined
    }

    const answer = previous.apply(this, outgoing)
    if (described === undefined) {
      return answer
    }

    const message = described
    return answer.then(
      (response) => {
        record(message, started, (response as { status?: number } | null)?.status)
        return response
      },
      (error: unknown) => {
        record(`${message} ${FAILED_MESSAGE_SUFFIX}`, started)
        throw error
      },
    )
  }

  target.fetch = installed

  return () => {
    if (target.fetch === installed) {
      target.fetch = previous
    }
  }
}

export function installFetchBreadcrumbs(
  trail: Trail,
  options: FetchBreadcrumbOptions = {},
): () => void {
  return installFetchPatch({ ...options, trail })
}
