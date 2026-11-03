export type { BrowserClient, InitOptions } from '@nekolog-io/browser'
export {
  addBreadcrumb,
  clearBreadcrumbs,
  resetSession,
  sessionId,
  setUser,
} from '@nekolog-io/browser'
export type {
  AttributeInput,
  Attributes,
  AttributeValue,
  LogContext,
  LogEvent,
  Logger,
  LogLevel,
} from '@nekolog-io/core'
export type { ErrorBoundaryFallback, ErrorBoundaryProps } from './boundary.tsx'
export {
  BOUNDARY_ATTRIBUTE,
  COMPONENT_STACK_ATTRIBUTE,
  componentStackOf,
  ErrorBoundary,
  MAX_COMPONENT_STACK_CHARS,
  withErrorBoundary,
} from './boundary.tsx'
export { closeClient, currentClient, nekologClient } from './client.ts'
export { fallbackLogger, LoggerContext, NO_PROVIDER, resetFallback, useLogger } from './context.ts'
export type { NekologProviderProps } from './provider.tsx'
export { NekologProvider } from './provider.tsx'
export { SDK_NAME, SDK_VERSION } from './version.ts'
