import type { Logger } from '@nekolog-io/core'
import { type EventTargetLike, globalWindow } from './globals.ts'

export const ERROR_KIND_ATTRIBUTE = 'error.kind'
export const ERROR_SOURCE_ATTRIBUTE = 'error.source'
export const ERROR_LINE_ATTRIBUTE = 'error.line'
export const ERROR_COLUMN_ATTRIBUTE = 'error.column'

export const UNCAUGHT = 'uncaught'
export const UNHANDLED_REJECTION = 'unhandledrejection'

export type GlobalHandlerOptions = {
  target?: EventTargetLike
}

type ErrorEventLike = {
  error?: unknown
  message?: unknown
  filename?: unknown
  lineno?: unknown
  colno?: unknown
}

type RejectionEventLike = {
  reason?: unknown
}

function subjectOf(error: unknown, message: unknown, fallback: string): unknown {
  if (error !== undefined && error !== null) {
    return error
  }
  if (typeof message === 'string' && message.trim() !== '') {
    return message
  }
  return fallback
}

export function installGlobalHandlers(
  logger: Logger,
  options: GlobalHandlerOptions = {},
): () => void {
  const target = options.target ?? globalWindow()
  if (target === undefined) {
    return () => undefined
  }

  let inside = false
  const report = (subject: unknown, attributes: Record<string, unknown>): void => {
    if (inside) {
      return
    }
    inside = true
    try {
      logger.error(subject, attributes)
    } finally {
      inside = false
    }
  }

  const onError = (event: Event): void => {
    const detail = event as unknown as ErrorEventLike
    const attributes: Record<string, unknown> = { [ERROR_KIND_ATTRIBUTE]: UNCAUGHT }

    if (typeof detail.filename === 'string' && detail.filename !== '') {
      attributes[ERROR_SOURCE_ATTRIBUTE] = detail.filename
    }
    if (typeof detail.lineno === 'number' && detail.lineno > 0) {
      attributes[ERROR_LINE_ATTRIBUTE] = detail.lineno
    }
    if (typeof detail.colno === 'number' && detail.colno > 0) {
      attributes[ERROR_COLUMN_ATTRIBUTE] = detail.colno
    }

    report(subjectOf(detail.error, detail.message, 'Uncaught error'), attributes)
  }

  const onRejection = (event: Event): void => {
    const detail = event as unknown as RejectionEventLike
    report(subjectOf(detail.reason, undefined, 'Unhandled promise rejection'), {
      [ERROR_KIND_ATTRIBUTE]: UNHANDLED_REJECTION,
    })
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)

  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
