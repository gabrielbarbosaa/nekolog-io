import { isoTimestamp, type LogEvent, type LogLevel, passesThreshold } from '@nekolog-io/core'
import {
  BREADCRUMBS_ATTRIBUTE,
  type Breadcrumb,
  type BreadcrumbData,
  type BreadcrumbKind,
  createTrail,
  serialiseTrail,
  type Trail,
} from './breadcrumbs.ts'
import { type ClickBreadcrumbOptions, installClickBreadcrumbs } from './clicks.ts'
import { installNavigationBreadcrumbs, type NavigationBreadcrumbOptions } from './navigation.ts'
import { type FetchBreadcrumbOptions, installFetchPatch, type TracePatch } from './network.ts'
import type { PageDetail } from './page.ts'

export const DEFAULT_ATTACH_FROM: LogLevel = 'error'

export type BreadcrumbTuning = {
  max?: number
  attachFrom?: LogLevel | false
  clicks?: boolean
  navigation?: boolean
  fetch?: boolean
}

let shared: Trail | undefined

export function breadcrumbTrail(): Trail {
  if (shared === undefined) {
    shared = createTrail()
  }
  return shared
}

export function configureBreadcrumbs(tuning: BreadcrumbTuning = {}): Trail {
  shared = createTrail(tuning.max)
  return shared
}

export function addBreadcrumb(
  message: string,
  data?: BreadcrumbData,
  kind: BreadcrumbKind = 'custom',
): void {
  if (typeof message !== 'string' || message === '') {
    return
  }
  const crumb: Breadcrumb = { at: isoTimestamp(Date.now()), kind, message }
  breadcrumbTrail().add(data === undefined ? crumb : { ...crumb, data })
}

export function clearBreadcrumbs(): void {
  breadcrumbTrail().clear()
}

export function withBreadcrumbs(event: LogEvent, attachFrom: LogLevel): LogEvent {
  if (!passesThreshold(event.level, attachFrom)) {
    return event
  }

  const text = serialiseTrail(breadcrumbTrail().list())
  if (text === undefined) {
    return event
  }

  return { ...event, attributes: { ...event.attributes, [BREADCRUMBS_ATTRIBUTE]: text } }
}

export type InstallBreadcrumbOptions = BreadcrumbTuning & {
  page?: PageDetail
  endpoint?: string
  trace?: TracePatch
  clickOptions?: ClickBreadcrumbOptions
  navigationOptions?: NavigationBreadcrumbOptions
  fetchOptions?: FetchBreadcrumbOptions
}

export function installBreadcrumbs(options: InstallBreadcrumbOptions = {}): () => void {
  const trail = breadcrumbTrail()
  const installed: Array<() => void> = []

  if (options.clicks !== false) {
    installed.push(installClickBreadcrumbs(trail, options.clickOptions))
  }
  if (options.navigation !== false) {
    installed.push(
      installNavigationBreadcrumbs(trail, { page: options.page, ...options.navigationOptions }),
    )
  }
  if (options.fetch !== false || options.trace !== undefined) {
    installed.push(
      installFetchPatch({
        page: options.page,
        endpoint: options.endpoint,
        trail: options.fetch === false ? undefined : trail,
        trace: options.trace,
        ...options.fetchOptions,
      }),
    )
  }

  return () => {
    for (const uninstall of installed.splice(0).reverse()) {
      uninstall()
    }
  }
}
