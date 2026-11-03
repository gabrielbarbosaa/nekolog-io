import { DEFAULT_ENDPOINT, requestUrlFor } from '@nekolog-io/core'
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
  if (resolved === undefined) {
    return undefined
  }
  return resolved.startsWith(RELATIVE_BASE) ? resolved.slice(RELATIVE_BASE.length) : resolved
}

export type FetchBreadcrumbOptions = {
  endpoint?: string
  ignore?: (url: string) => boolean
  page?: PageDetail
  href?: () => string | undefined
  now?: () => number
  target?: { fetch?: unknown }
}

export function installFetchBreadcrumbs(
  trail: Trail,
  options: FetchBreadcrumbOptions = {},
): () => void {
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

  const record = (message: string, started: number, status?: number): void => {
    try {
      trail.add({
        at: started,
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

    try {
      const raw = urlOf(args[0])
      const shown = raw === undefined ? undefined : describeRequestUrl(raw, detail, href())
      if (raw !== undefined && shown !== undefined && !ignore(raw) && !ignore(shown)) {
        described = `${methodOf(args[0], args[1])} ${shown}`
        started = now()
      }
    } catch {
      described = undefined
    }

    const answer = previous.apply(this, args)
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
