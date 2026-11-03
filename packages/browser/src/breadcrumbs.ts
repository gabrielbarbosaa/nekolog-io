import { MAX_ATTRIBUTE_VALUE_BYTES, utf8ByteLength } from '@nekolog-io/core'

export const BREADCRUMBS_ATTRIBUTE = 'breadcrumbs'
export const DEFAULT_MAX_BREADCRUMBS = 20
export const MAX_BREADCRUMB_MESSAGE_CHARS = 200

export type BreadcrumbKind = 'click' | 'navigation' | 'fetch' | 'custom'

export type BreadcrumbData = Record<string, string | number | boolean>

export type Breadcrumb = {
  at: number
  kind: BreadcrumbKind
  message: string
  data?: BreadcrumbData
}

export type Trail = {
  add(crumb: Breadcrumb): void
  list(): Breadcrumb[]
  clear(): void
}

export function createTrail(max: number = DEFAULT_MAX_BREADCRUMBS): Trail {
  const limit = Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_BREADCRUMBS
  let crumbs: Breadcrumb[] = []

  return {
    add(crumb) {
      crumbs.push({
        ...crumb,
        message: crumb.message.slice(0, MAX_BREADCRUMB_MESSAGE_CHARS),
      })
      if (crumbs.length > limit) {
        crumbs = crumbs.slice(crumbs.length - limit)
      }
    },
    list() {
      return crumbs.slice()
    },
    clear() {
      crumbs = []
    },
  }
}

export function serialiseTrail(
  crumbs: Breadcrumb[],
  maxBytes: number = MAX_ATTRIBUTE_VALUE_BYTES,
): string | undefined {
  if (crumbs.length === 0) {
    return undefined
  }

  for (let start = 0; start < crumbs.length; start++) {
    const text = JSON.stringify(crumbs.slice(start))
    if (utf8ByteLength(text) <= maxBytes) {
      return text
    }
  }
  return undefined
}
