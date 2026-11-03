import type { LogContext } from '@nekolog-io/core'
import { globalHref } from './globals.ts'
import { DEFAULT_PAGE_DETAIL, type PageDetail, pageUrl } from './page.ts'
import { createSessionStore, type SessionOptions, type SessionStore } from './session.ts'

export const PAGE_URL_ATTRIBUTE = 'page.url'

let shared: SessionStore | undefined
let user: string | undefined

export function sessionStore(): SessionStore {
  if (shared === undefined) {
    shared = createSessionStore()
  }
  return shared
}

export function configureSession(options: SessionOptions): SessionStore {
  shared = createSessionStore(options)
  return shared
}

export function sessionId(): string {
  return sessionStore().current()
}

export function resetSession(): string {
  return sessionStore().reset()
}

export function setUser(id: string | null | undefined): void {
  user = typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
}

export function clearUser(): void {
  user = undefined
}

export function currentUser(): string | undefined {
  return user
}

export type ContextOptions = {
  page?: PageDetail
  session?: SessionStore
  href?: () => string | undefined
}

export function browserContext(options: ContextOptions = {}): () => LogContext {
  const detail = options.page ?? DEFAULT_PAGE_DETAIL
  const href = options.href ?? globalHref

  return () => {
    const store = options.session ?? sessionStore()
    const context: LogContext = { session: { id: store.current() } }

    const id = currentUser()
    if (id !== undefined) {
      context.session = { ...context.session, userId: id }
    }

    const url = pageUrl(href(), detail)
    if (url !== undefined) {
      context.attributes = { [PAGE_URL_ATTRIBUTE]: url }
    }

    return context
  }
}
