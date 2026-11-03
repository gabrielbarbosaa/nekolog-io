import type { Logger } from '@nekolog-io/core'
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { fallbackLogger, LoggerContext } from './context.ts'

export const COMPONENT_STACK_ATTRIBUTE = 'react.component_stack'
export const BOUNDARY_ATTRIBUTE = 'react.boundary'
export const MAX_COMPONENT_STACK_CHARS = 2_000

export type ErrorBoundaryFallback = (state: { error: unknown; reset: () => void }) => ReactNode

export type ErrorBoundaryProps = {
  children?: ReactNode
  fallback?: ReactNode | ErrorBoundaryFallback
  name?: string
  onError?: (error: unknown, info: ErrorInfo) => void
}

type ErrorBoundaryState = { error: unknown; caught: boolean }

export function componentStackOf(info: ErrorInfo): string | undefined {
  const stack = info.componentStack
  if (typeof stack !== 'string') {
    return undefined
  }
  const trimmed = stack.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, MAX_COMPONENT_STACK_CHARS)
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static override contextType: typeof LoggerContext = LoggerContext
  declare context: Logger | null

  override state: ErrorBoundaryState = { error: undefined, caught: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, caught: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const logger = this.context ?? fallbackLogger()
    const attributes: Record<string, unknown> = {}

    const stack = componentStackOf(info)
    if (stack !== undefined) {
      attributes[COMPONENT_STACK_ATTRIBUTE] = stack
    }
    if (typeof this.props.name === 'string' && this.props.name !== '') {
      attributes[BOUNDARY_ATTRIBUTE] = this.props.name
    }

    try {
      logger.error(error, attributes)
    } catch {
      return
    } finally {
      this.report(error, info)
    }
  }

  private report(error: unknown, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info)
    } catch {
      return
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: undefined, caught: false })
  }

  override render(): ReactNode {
    if (!this.state.caught) {
      return this.props.children ?? null
    }

    const { fallback } = this.props
    if (typeof fallback === 'function') {
      return (fallback as ErrorBoundaryFallback)({ error: this.state.error, reset: this.reset })
    }
    return fallback ?? null
  }
}

export function withErrorBoundary<P extends object>(
  Wrapped: (props: P) => ReactNode,
  boundary: Omit<ErrorBoundaryProps, 'children'> = {},
): (props: P) => ReactElement {
  return function Guarded(props: P): ReactElement {
    return (
      <ErrorBoundary {...boundary}>
        <Wrapped {...props} />
      </ErrorBoundary>
    )
  }
}
