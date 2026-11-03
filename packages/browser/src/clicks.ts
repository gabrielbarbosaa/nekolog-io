import { isoTimestamp } from '@nekolog-io/core'
import type { Breadcrumb, Trail } from './breadcrumbs.ts'
import { type DocumentLike, globalDocument } from './globals.ts'

export const MAX_CLASSES_IN_SELECTOR = 3
export const MAX_SELECTOR_PART_CHARS = 40

type ElementLike = {
  tagName?: unknown
  id?: unknown
  classList?: { value?: unknown }
  className?: unknown
  getAttribute?: (name: string) => unknown
}

function part(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, MAX_SELECTOR_PART_CHARS)
}

function classesOf(element: ElementLike): string[] {
  const raw = part(element.classList?.value) ?? part(element.className)
  if (raw === null) {
    return []
  }
  return raw.split(/\s+/).filter(Boolean).slice(0, MAX_CLASSES_IN_SELECTOR)
}

function testId(element: ElementLike): string | null {
  try {
    return part(element.getAttribute?.('data-testid'))
  } catch {
    return null
  }
}

export function describeElement(target: unknown): string | null {
  if (typeof target !== 'object' || target === null) {
    return null
  }

  const element = target as ElementLike
  const tag = part(element.tagName)
  if (tag === null) {
    return null
  }

  const id = part(element.id)
  const marker = testId(element)

  return [
    tag.toLowerCase(),
    id === null ? '' : `#${id}`,
    classesOf(element)
      .map((name) => `.${name}`)
      .join(''),
    marker === null ? '' : `[data-testid=${marker}]`,
  ].join('')
}

export type ClickBreadcrumbOptions = {
  document?: DocumentLike | false
  now?: () => number
}

export function installClickBreadcrumbs(
  trail: Trail,
  options: ClickBreadcrumbOptions = {},
): () => void {
  const page = options.document === false ? undefined : (options.document ?? globalDocument())
  if (page === undefined) {
    return () => undefined
  }

  const now = options.now ?? Date.now

  const onClick = (event: Event): void => {
    try {
      const message = describeElement((event as { target?: unknown }).target)
      if (message === null) {
        return
      }
      const crumb: Breadcrumb = { at: isoTimestamp(now()), kind: 'click', message }
      trail.add(crumb)
    } catch {
      return
    }
  }

  page.addEventListener('click', onClick, { capture: true, passive: true })

  return () => {
    page.removeEventListener('click', onClick, { capture: true })
  }
}
