import { isoTimestamp } from '@nekolog-io/core'
import type { Trail } from './breadcrumbs.ts'
import { type EventTargetLike, globalHref, globalWindow } from './globals.ts'
import { DEFAULT_PAGE_DETAIL, type PageDetail, pageUrl } from './page.ts'

type HistoryLike = {
  pushState: (...args: unknown[]) => unknown
  replaceState: (...args: unknown[]) => unknown
}

function globalHistory(): HistoryLike | undefined {
  const history = (globalThis as { history?: Partial<HistoryLike> }).history
  return typeof history?.pushState === 'function' && typeof history.replaceState === 'function'
    ? (history as HistoryLike)
    : undefined
}

export type NavigationBreadcrumbOptions = {
  target?: EventTargetLike
  history?: HistoryLike | false
  href?: () => string | undefined
  page?: PageDetail
  now?: () => number
}

export function installNavigationBreadcrumbs(
  trail: Trail,
  options: NavigationBreadcrumbOptions = {},
): () => void {
  const target = options.target ?? globalWindow()
  const history = options.history === false ? undefined : (options.history ?? globalHistory())
  if (target === undefined && history === undefined) {
    return () => undefined
  }

  const now = options.now ?? Date.now
  const href = options.href ?? globalHref
  const detail = options.page ?? DEFAULT_PAGE_DETAIL

  let from = pageUrl(href(), detail)

  const record = (): void => {
    try {
      const to = pageUrl(href(), detail)
      if (to === undefined || to === from) {
        return
      }
      trail.add({
        at: isoTimestamp(now()),
        kind: 'navigation',
        message: to,
        ...(from === undefined ? {} : { data: { from } }),
      })
      from = to
    } catch {
      return
    }
  }

  const onNavigate = (): void => record()

  target?.addEventListener('popstate', onNavigate)
  target?.addEventListener('hashchange', onNavigate)

  const original = history
    ? { pushState: history.pushState, replaceState: history.replaceState }
    : undefined

  const watching = (method: (...args: unknown[]) => unknown) =>
    function watched(this: unknown, ...args: unknown[]) {
      const result = method.apply(this, args)
      record()
      return result
    }

  const installed = original
    ? { pushState: watching(original.pushState), replaceState: watching(original.replaceState) }
    : undefined

  if (history && installed) {
    history.pushState = installed.pushState
    history.replaceState = installed.replaceState
  }

  return () => {
    target?.removeEventListener('popstate', onNavigate)
    target?.removeEventListener('hashchange', onNavigate)
    if (history && original && installed) {
      if (history.pushState === installed.pushState) {
        history.pushState = original.pushState
      }
      if (history.replaceState === installed.replaceState) {
        history.replaceState = original.replaceState
      }
    }
  }
}
