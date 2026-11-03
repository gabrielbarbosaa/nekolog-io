'use client'

export type { BrowserClient, InitOptions } from '@nekolog-io/browser'
export {
  addBreadcrumb,
  clearBreadcrumbs,
  resetSession,
  resetTrace,
  sessionId,
  setUser,
} from '@nekolog-io/browser'
export type {
  ErrorBoundaryFallback,
  ErrorBoundaryProps,
  NekologProviderProps,
} from '@nekolog-io/react'
export {
  BOUNDARY_ATTRIBUTE,
  COMPONENT_STACK_ATTRIBUTE,
  closeClient,
  currentClient,
  ErrorBoundary,
  NekologProvider,
  nekologClient,
  useLogger,
  withErrorBoundary,
} from '@nekolog-io/react'
export { SDK_NAME, SDK_VERSION } from './version.ts'
